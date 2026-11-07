/** ChartML (c:chartSpace) → ChartSpec, read from the cached values PowerPoint stores in the part. */
import type { ChartSpec } from "@/lib/deck/schema";
import { attr, boolAttr, child, children, find, findAll, numAttr, path, type XNode } from "../xml";
import { resolveColor, type ColorContext } from "../color";

const TYPES: Record<string, (node: XNode) => ChartSpec["type"]> = {
  barChart: (n) => (attr(child(n, "barDir"), "val") === "bar" ? "bar" : "column"),
  bar3DChart: (n) => (attr(child(n, "barDir"), "val") === "bar" ? "bar" : "column"),
  lineChart: () => "line",
  line3DChart: () => "line",
  stockChart: () => "line",
  radarChart: () => "line",
  areaChart: () => "area",
  area3DChart: () => "area",
  pieChart: () => "pie",
  pie3DChart: () => "pie",
  ofPieChart: () => "pie",
  doughnutChart: () => "donut",
  scatterChart: () => "scatter",
  bubbleChart: () => "scatter",
};

/** Values from a strRef/numRef/strLit/numLit cache, indexed by c:pt idx. */
function cacheValues(node: XNode | undefined): { values: (string | undefined)[]; count: number } {
  const cache = node && (find(node, "strCache") ?? find(node, "numCache") ?? find(node, "strLit") ?? find(node, "numLit") ?? find(node, "multiLvlStrCache"));
  if (!cache) return { values: [], count: 0 };
  // Multi-level categories: use the innermost level.
  const src = cache.name === "multiLvlStrCache" ? (children(cache, "lvl")[0] ?? cache) : cache;
  const count = numAttr(child(cache, "ptCount"), "val") ?? 0;
  const values: (string | undefined)[] = [];
  for (const pt of children(src, "pt")) values[numAttr(pt, "idx") ?? values.length] = child(pt, "v")?.text;
  return { values, count: Math.max(count, values.length) };
}

function richText(node: XNode | undefined): string | undefined {
  if (!node) return undefined;
  const parts = findAll(node, "t").map((t) => t.text);
  if (parts.length) return parts.join("").trim() || undefined;
  const cached = cacheValues(child(child(node, "tx"), "strRef")).values.filter(Boolean);
  return cached.length ? cached.join(" ") : undefined;
}

export type ParsedChart = { spec: ChartSpec; warnings: string[] };

export function parseChart(root: XNode, color: ColorContext): ParsedChart | null {
  const warnings: string[] = [];
  const chart = child(root, "chart");
  const plot = child(chart, "plotArea");
  const typeNodes = children(plot).filter((n) => n.name in TYPES);
  if (typeNodes.length === 0) return null;
  if (typeNodes.length > 1) warnings.push("Combination charts were imported using their first chart type only.");
  const typeNode = typeNodes[0];
  const type = TYPES[typeNode.name](typeNode);
  if (typeNode.name.includes("3D")) warnings.push("3-D charts were imported as flat charts.");

  let categories: string[] = [];
  const series: ChartSpec["series"] = [];
  for (const ser of children(typeNode, "ser")) {
    const name = richText(ser) ?? `Series ${series.length + 1}`;
    const catNode = child(ser, "cat") ?? child(ser, "xVal");
    const valNode = child(ser, "val") ?? child(ser, "yVal");
    const cats = cacheValues(catNode);
    const vals = cacheValues(valNode);
    const n = Math.max(cats.count, vals.count);
    if (categories.length === 0 && n) categories = Array.from({ length: n }, (_, i) => cats.values[i] ?? String(i + 1));
    const values = Array.from({ length: Math.max(n, categories.length) }, (_, i) => {
      const v = vals.values[i];
      const num = v === undefined ? NaN : Number(v);
      return Number.isFinite(num) ? num : null;
    });
    const fill = resolveColor(path(ser, "spPr", "solidFill"), color) ?? resolveColor(path(ser, "spPr", "ln", "solidFill"), color);
    series.push(fill ? { name, values, color: fill.slice(0, 7) } : { name, values });
  }
  if (series.length === 0) return null;
  if (categories.length === 0) categories = series[0].values.map((_, i) => String(i + 1));
  // Pie slices: when the series has per-point colors (c:dPt) we keep the theme palette instead.

  const grouping = attr(child(typeNode, "grouping"), "val");
  const legendNode = child(chart, "legend");
  const pos = attr(child(legendNode, "legendPos"), "val");
  const legend: ChartSpec["legend"] = !legendNode ? "none" : pos === "t" ? "top" : pos === "l" ? "left" : pos === "r" || pos === "tr" ? "right" : "bottom";
  const showVal = (n: XNode | undefined) => boolAttr(child(child(n, "dLbls"), "showVal"), "val") ?? boolAttr(child(child(n, "dLbls"), "showPercent"), "val");
  const dataLabels = showVal(typeNode) || children(typeNode, "ser").some((s) => showVal(s));
  const autoDeleted = boolAttr(child(chart, "autoTitleDeleted"), "val");
  let title = richText(child(chart, "title"));
  // PowerPoint shows the series name as the title of single-series charts unless the title was deleted.
  if (!title && series.length === 1 && (child(chart, "title") || !autoDeleted)) title = series[0].name;

  const axisTitle = (axName: string) => richText(child(children(plot, axName)[0], "title"));
  const xTitle = axisTitle("catAx") ?? axisTitle("dateAx");
  const yTitle = axisTitle("valAx");

  const spec: ChartSpec = { type, categories, series, legend };
  if (title) spec.title = title;
  if (grouping === "stacked" || grouping === "percentStacked") spec.stacked = true;
  if (grouping === "percentStacked") warnings.push("100% stacked charts were imported as stacked charts.");
  if (dataLabels) spec.dataLabels = true;
  if (xTitle || yTitle) spec.axes = { ...(xTitle ? { xTitle } : {}), ...(yTitle ? { yTitle } : {}) };
  return { spec, warnings };
}

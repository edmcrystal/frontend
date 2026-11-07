import { describe, expect, it } from "vitest";
import PptxGenJS from "pptxgenjs";
import {
  buildPresentation,
  chartToPptx,
  fixChartXml,
  fixSlideXml,
  flattenElements,
  inches,
  normalizeRotation,
  paragraphsToRuns,
  postProcess,
  pptxFileName,
  shapeTypeFor,
  toPptxColor,
} from "./pptx";
import { getFixtureDeck } from "@/lib/deck/fixtures";
import { locate, ungroupElements } from "@/lib/deck/commands";
import type { ChartSpec, Element, Paragraph } from "@/lib/deck/schema";
import { produce } from "immer";

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const stubs = {
  rasterize: async () => PNG_1PX,
  loadAsset: async () => "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
};
const run = { font: "Arial", size: 20, color: "#112233" };
const opt = (r: PptxGenJS.TextProps) => r.options as Record<string, unknown>;

describe("units and colors", () => {
  it("converts points to inches", () => {
    expect(inches(72)).toBe(1);
    expect(inches(960)).toBeCloseTo(13.3333, 4);
  });

  it("strips '#' and turns alpha into transparency", () => {
    expect(toPptxColor("#2563eb")).toEqual({ color: "2563EB" });
    expect(toPptxColor("#00000080")).toEqual({ color: "000000", transparency: 50 });
  });

  it("normalizes rotation into 0..360", () => {
    expect(normalizeRotation(-12)).toBe(348);
    expect(normalizeRotation(720)).toBe(0);
  });

  it("maps presets and file names", () => {
    expect(shapeTypeFor("arrow-right")).toBe("rightArrow");
    expect(shapeTypeFor("round-rect")).toBe("roundRect");
    expect(pptxFileName('Q3: "Review"/draft')).toBe("Q3 Review draft.pptx");
    expect(pptxFileName("  ")).toBe("Presentation.pptx");
  });
});

describe("paragraphsToRuns", () => {
  const ps: Paragraph[] = [
    { align: "left", level: 0, bullet: { type: "char", char: "•" }, spaceAfter: 10, runs: [{ text: "Bold ", ...run, bold: true }, { text: "plain", ...run }] },
    { align: "center", level: 1, bullet: { type: "number", format: "roman-upper", startAt: 3 }, lineHeight: 1.5, runs: [{ text: "a\nb", ...run, link: "https://example.com" }] },
    { align: "right", level: 0, runs: [{ text: "", ...run }] },
  ];
  const runs = paragraphsToRuns(ps);

  it("puts paragraph props on the first run only and breaks lines between paragraphs", () => {
    expect(runs.map((r) => r.text)).toEqual(["Bold ", "plain", "a", "b", ""]);
    expect(opt(runs[0])).toMatchObject({ align: "left", paraSpaceAfter: 10, bold: true, fontFace: "Arial", fontSize: 20, color: "112233" });
    expect(opt(runs[1]).bullet).toBeUndefined();
    expect(opt(runs[1]).align).toBeUndefined();
    expect(opt(runs[1]).breakLine).toBe(true);
    expect(opt(runs[3]).breakLine).toBe(true);
    expect(opt(runs[4]).breakLine).toBeUndefined();
  });

  it("maps char bullets and numbering", () => {
    expect(opt(runs[0]).bullet).toEqual({ characterCode: "2022", indent: 22 });
    expect(opt(runs[2]).bullet).toMatchObject({ type: "number", style: "romanUcPeriod", numberStartAt: 3 });
    expect(opt(runs[2]).indentLevel).toBe(1);
    expect(opt(runs[2]).lineSpacingMultiple).toBe(1.25);
  });

  it("turns \\n into soft breaks and keeps hyperlinks on every piece", () => {
    expect(opt(runs[3]).softBreakBefore).toBe(true);
    expect(opt(runs[2]).softBreakBefore).toBeUndefined();
    expect(opt(runs[3]).hyperlink).toEqual({ url: "https://example.com" });
  });

  it("applies element opacity as run transparency", () => {
    expect(opt(paragraphsToRuns([ps[2]], 0.25)[0]).transparency).toBe(75);
  });
});

describe("flattenElements", () => {
  it("matches ungrouping for rotated groups and multiplies opacity", () => {
    const deck = produce(getFixtureDeck("sample")!, (d) => {
      const g = locate(d.slides[1].elements, "s2-card")!.el;
      g.frame.rotation = 30;
      g.opacity = 0.5;
      const child = locate(d.slides[1].elements, "s2-card-img")!.el;
      child.frame.rotation = 10;
      child.opacity = 0.5;
    });
    const flat = flattenElements(deck.slides[1].elements);
    const ungrouped = produce(deck, (d) => {
      ungroupElements(d, "s2", ["s2-card"]);
    });
    for (const id of ["s2-card-bg", "s2-card-img", "s2-card-text"]) {
      const a = flat.find((f) => f.el.id === id)!;
      const b = locate(ungrouped.slides[1].elements, id)!.el as Element;
      for (const k of ["x", "y", "w", "h", "rotation"] as const) expect(a.frame[k]).toBeCloseTo(b.frame[k], 6);
    }
    expect(flat.find((f) => f.el.id === "s2-card-img")!.opacity).toBeCloseTo(0.25);
    expect(flat.some((f) => f.el.type === ("group" as string))).toBe(false);
  });

  it("skips hidden elements and keeps z-order", () => {
    const deck = produce(getFixtureDeck("sample")!, (d) => {
      d.slides[0].elements[1].hidden = true;
    });
    expect(flattenElements(deck.slides[0].elements).map((f) => f.el.id)).toEqual(["s1-title", "s1-bar"]);
  });
});

describe("chartToPptx", () => {
  const theme = getFixtureDeck("sample")!.theme;
  const spec: ChartSpec = { type: "column", categories: ["A", "B"], series: [{ name: "S1", values: [1, null], color: "#ff0000" }, { name: "S2", values: [2, 3] }], legend: "bottom", dataLabels: true, axes: { yTitle: "$M" } };

  it("maps columns, bars and stacking", () => {
    const c = chartToPptx(spec, theme);
    expect(c.type).toBe("bar");
    expect(c.options).toMatchObject({ barDir: "col", barGrouping: "clustered", showLegend: true, legendPos: "b", showValue: true, showValAxisTitle: true, valAxisTitle: "$M" });
    expect(c.options.chartColors).toEqual(["FF0000", "F59E0B"]);
    expect(c.data[0]).toEqual({ name: "S1", labels: ["A", "B"], values: [1, null] });
    expect(chartToPptx({ ...spec, type: "bar", stacked: true }, theme).options).toMatchObject({ barDir: "bar", barGrouping: "stacked" });
  });

  it("maps pie, donut, line, area and scatter", () => {
    const donut = chartToPptx({ ...spec, type: "donut" }, theme);
    expect(donut.type).toBe("doughnut");
    expect(donut.data).toHaveLength(1);
    expect((donut.options.chartColors as string[]).every((c) => !c.startsWith("#"))).toBe(true);
    expect(chartToPptx({ ...spec, type: "line" }, theme).type).toBe("line");
    expect(chartToPptx({ ...spec, type: "area" }, theme).type).toBe("area");
    const scatter = chartToPptx({ ...spec, type: "scatter", categories: ["1", "x"] }, theme);
    expect(scatter.data[0].values).toEqual([1, 1]);
    expect(scatter.data).toHaveLength(3);
  });

  it("hides the legend", () => {
    expect(chartToPptx({ ...spec, legend: "none" }, theme).options.showLegend).toBe(false);
  });
});

describe("XML fixes", () => {
  it("keeps one pPr per paragraph and lays out bullet margins like the renderer", () => {
    const xml =
      '<a:p><a:pPr algn="l" lvl="1" marL="0" indent="-279400"><a:buChar char="x"/></a:pPr><a:r><a:t>a</a:t></a:r><a:pPr indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:t>b</a:t></a:r></a:p>' +
      '<a:p><a:pPr lvl="2" indent="0" marL="0"><a:buNone/></a:pPr><a:r><a:t>c</a:t></a:r></a:p>';
    const out = fixSlideXml(xml);
    expect(out.match(/<a:pPr/g)).toHaveLength(2);
    expect(out).toContain('marL="622300"'); // 27pt*12700 + 279400
    expect(out).toContain('marL="685800"'); // 2 * 27pt
  });

  it("drops empty chart points", () => {
    expect(fixChartXml('<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v></c:v></c:pt>')).toBe('<c:pt idx="0"><c:v>1</c:v></c:pt>');
  });
});

describe("buildPresentation (sample deck)", () => {
  it("produces a valid package with native charts, tables, notes and no duplicate pPr", async () => {
    const deck = produce(getFixtureDeck("sample")!, (d) => {
      d.slides[0].notes = "Opening remarks";
    });
    const pptx = new PptxGenJS();
    const { warnings } = await buildPresentation(deck, pptx, stubs);
    const zip = await postProcess((await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer);
    const names = Object.keys(zip.files);
    expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(4);
    expect(names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))).toHaveLength(1);
    const slides = await Promise.all([1, 2, 3, 4].map((i) => zip.file(`ppt/slides/slide${i}.xml`)!.async("string")));
    expect(slides[0]).toContain("Quarterly Business Review");
    expect(slides[1]).toContain("<a:buChar");
    expect(slides[1]).toContain('<a:buClr><a:srgbClr val="2563EB"/></a:buClr>');
    expect(slides.join("")).not.toContain("x-bu-");
    const chartXml = await zip.file(names.find((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))!)!.async("string");
    expect(chartXml).toContain('formatCode="General"');
    expect(slides[1]).toContain('<a:buAutoNum type="arabicPeriod" startAt="3"/>');
    expect(slides[2]).toContain("<a:tbl>");
    for (const xml of slides) for (const p of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) expect((p.match(/<a:pPr\b/g) ?? []).length).toBeLessThanOrEqual(1);
    const notes = names.find((n) => /notesSlide1\.xml$/.test(n))!;
    expect(await zip.file(notes)!.async("string")).toContain("Opening remarks");
    expect(warnings).toContain("Icons were exported as images.");
  });
});

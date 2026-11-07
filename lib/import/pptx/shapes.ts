/** p:spTree → deck elements (shapes, text, pictures, groups, tables, charts, SmartArt drawings). */
import type {
  ChartElement,
  Element,
  Fill,
  Frame,
  GroupElement,
  ImageElement,
  Paragraph,
  PresetShape,
  ShapeElement,
  Stroke,
  TableElement,
  TextElement,
} from "@/lib/deck/schema";
import { newId } from "@/lib/deck/commands";
import { attr, boolAttr, child, children, find, numAttr, path, relAttr, type XNode } from "../xml";
import { applyModifiers, emuToPt, pct, resolveColor } from "../color";
import {
  count,
  mediaAsset,
  parseFill,
  parseLine,
  resolveFont,
  styleRefFill,
  styleRefLine,
  warn,
  type SlideContext,
} from "./context";
import { hasVisibleText, parseBodyProps, parseParagraphs, type StyleSource, type TextDefaults } from "./text";
import { parseChart } from "./chart";

/** Maps EMU coordinates of a container's children into parent-local points. */
export type Mapper = { ox: number; oy: number; kx: number; ky: number };
export const ROOT_MAPPER: Mapper = { ox: 0, oy: 0, kx: 1 / 12700, ky: 1 / 12700 };

const PRESETS: Record<string, PresetShape> = {
  rect: "rect",
  roundRect: "round-rect",
  snipRoundRect: "round-rect",
  round2SameRect: "round-rect",
  ellipse: "ellipse",
  triangle: "triangle",
  rtTriangle: "triangle",
  diamond: "diamond",
  chevron: "chevron",
  homePlate: "chevron",
  rightArrow: "arrow-right",
  line: "line",
  straightConnector1: "line",
  bentConnector2: "line",
  bentConnector3: "line",
  curvedConnector3: "line",
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function normalizeRotation(deg: number) {
  const r = ((deg % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

type Xfrm = { x: number; y: number; cx: number; cy: number; rot: number; flipH: boolean; flipV: boolean; node: XNode };

function readXfrm(xfrm: XNode | undefined): Xfrm | undefined {
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  if (!xfrm || !off || !ext) return undefined;
  return {
    x: numAttr(off, "x") ?? 0,
    y: numAttr(off, "y") ?? 0,
    cx: numAttr(ext, "cx") ?? 0,
    cy: numAttr(ext, "cy") ?? 0,
    rot: (numAttr(xfrm, "rot") ?? 0) / 60000,
    flipH: !!boolAttr(xfrm, "flipH"),
    flipV: !!boolAttr(xfrm, "flipV"),
    node: xfrm,
  };
}

function toFrame(x: Xfrm, m: Mapper): Frame {
  return {
    x: r2((x.x - m.ox) * m.kx),
    y: r2((x.y - m.oy) * m.ky),
    w: r2(Math.max(0, x.cx * m.kx)),
    h: r2(Math.max(0, x.cy * m.ky)),
    rotation: r2(normalizeRotation(x.rot)),
  };
}

// ---------- Placeholders ----------

type Ph = { type: string; idx?: string };

function phOf(el: XNode): Ph | undefined {
  const nv = el.children.find((c) => c.name.startsWith("nv"));
  const ph = path(nv, "nvPr", "ph");
  if (!ph) return undefined;
  return { type: attr(ph, "type") ?? "obj", idx: attr(ph, "idx") };
}

const masterType = (t: string) => (t === "ctrTitle" ? "title" : t === "subTitle" || t === "obj" ? "body" : t);

/** Finds the matching placeholder shape in a layout (by idx, then type) or master (by type). */
function findPlaceholder(root: XNode | undefined, ph: Ph, isMaster: boolean): XNode | undefined {
  const tree = path(root, "cSld", "spTree");
  const candidates = children(tree).filter((c) => c.name === "sp" || c.name === "pic");
  const withPh = candidates.map((c) => ({ c, p: phOf(c) })).filter((x): x is { c: XNode; p: Ph } => !!x.p);
  if (!isMaster && ph.idx !== undefined) {
    const byIdx = withPh.find((x) => x.p.idx === ph.idx);
    if (byIdx) return byIdx.c;
  }
  const want = isMaster ? masterType(ph.type) : ph.type;
  return withPh.find((x) => (isMaster ? masterType(x.p.type) : x.p.type) === want)?.c ?? (isMaster ? undefined : withPh.find((x) => masterType(x.p.type) === masterType(ph.type))?.c);
}

function txStyleFor(ph: Ph | undefined, ctx: SlideContext): StyleSource {
  const styles = path(ctx.master?.root, "txStyles");
  if (!ph) return child(styles, "otherStyle");
  const t = masterType(ph.type);
  if (t === "title") return child(styles, "titleStyle");
  if (t === "dt" || t === "ftr" || t === "sldNum") return child(styles, "otherStyle");
  return child(styles, "bodyStyle");
}

// ---------- Geometry ----------

/** Converts a:custGeom paths into one SVG path in EMU units of the shape box. */
function customPath(geom: XNode, cx: number, cy: number, flipH: boolean, flipV: boolean): string | undefined {
  const out: string[] = [];
  for (const p of children(child(geom, "pathLst"), "path")) {
    const w = numAttr(p, "w") || cx || 1;
    const h = numAttr(p, "h") || cy || 1;
    const sx = (cx || 1) / w;
    const sy = (cy || 1) / h;
    const X = (v: number) => r2(flipH ? cx - v * sx : v * sx);
    const Y = (v: number) => r2(flipV ? cy - v * sy : v * sy);
    let cur = { x: 0, y: 0 };
    const pt = (n: XNode | undefined) => ({ x: numAttr(n, "x") ?? 0, y: numAttr(n, "y") ?? 0 });
    for (const cmd of p.children) {
      if (cmd.name === "moveTo") {
        cur = pt(child(cmd, "pt"));
        out.push(`M${X(cur.x)} ${Y(cur.y)}`);
      } else if (cmd.name === "lnTo") {
        cur = pt(child(cmd, "pt"));
        out.push(`L${X(cur.x)} ${Y(cur.y)}`);
      } else if (cmd.name === "cubicBezTo") {
        const [a, b, c] = children(cmd, "pt").map(pt);
        if (!c) continue;
        out.push(`C${X(a.x)} ${Y(a.y)} ${X(b.x)} ${Y(b.y)} ${X(c.x)} ${Y(c.y)}`);
        cur = c;
      } else if (cmd.name === "quadBezTo") {
        const [a, b] = children(cmd, "pt").map(pt);
        if (!b) continue;
        out.push(`Q${X(a.x)} ${Y(a.y)} ${X(b.x)} ${Y(b.y)}`);
        cur = b;
      } else if (cmd.name === "arcTo") {
        const wR = numAttr(cmd, "wR") ?? 0;
        const hR = numAttr(cmd, "hR") ?? 0;
        const st = ((numAttr(cmd, "stAng") ?? 0) / 60000) * (Math.PI / 180);
        const sw = ((numAttr(cmd, "swAng") ?? 0) / 60000) * (Math.PI / 180);
        const cxE = cur.x - wR * Math.cos(st);
        const cyE = cur.y - hR * Math.sin(st);
        const end = { x: cxE + wR * Math.cos(st + sw), y: cyE + hR * Math.sin(st + sw) };
        const large = Math.abs(sw) > Math.PI ? 1 : 0;
        let sweep = sw > 0 ? 1 : 0;
        if (flipH !== flipV) sweep = 1 - sweep;
        out.push(`A${r2(wR * sx)} ${r2(hR * sy)} 0 ${large} ${sweep} ${X(end.x)} ${Y(end.y)}`);
        cur = end;
      } else if (cmd.name === "close") {
        out.push("Z");
      }
    }
  }
  return out.length ? out.join("") : undefined;
}

// ---------- Element parsers ----------

type Parsed = Element | null;

async function linkRels(ctx: SlideContext): Promise<Map<string, string>> {
  const rels = await ctx.pkg.rels(ctx.part);
  return new Map(rels.filter((r) => r.type === "hyperlink" && r.external).map((r) => [r.id, r.target]));
}

function baseProps(el: XNode) {
  const nv = el.children.find((c) => c.name.startsWith("nv"));
  const c = child(nv, "cNvPr");
  const props: { name?: string; hidden?: boolean } = {};
  const name = attr(c, "name");
  if (name) props.name = name;
  if (boolAttr(c, "hidden")) props.hidden = true;
  return props;
}

async function parseSp(sp: XNode, ctx: SlideContext, m: Mapper, inherited: boolean): Promise<Parsed> {
  const ph = phOf(sp);
  // Placeholders on layouts/masters are prompts, not content.
  if (inherited && ph) return null;
  const layoutPh = ph ? findPlaceholder(ctx.layout?.root, ph, false) : undefined;
  const masterPh = ph ? findPlaceholder(ctx.master?.root, ph, true) : undefined;
  const spPr = child(sp, "spPr");
  const own = readXfrm(child(spPr, "xfrm"));
  const xf = own ?? readXfrm(path(layoutPh, "spPr", "xfrm")) ?? readXfrm(path(masterPh, "spPr", "xfrm"));
  if (!xf) {
    if (ph) return null;
    warn(ctx, "A shape without a position was skipped.");
    return null;
  }
  const frame = toFrame(xf, own ? m : ROOT_MAPPER);
  const style = child(sp, "style");

  // Geometry
  const geomOwner = [spPr, child(layoutPh, "spPr"), child(masterPh, "spPr")].find((n) => child(n, "prstGeom") || child(n, "custGeom"));
  const prst = attr(child(geomOwner, "prstGeom"), "prst");
  const cust = child(geomOwner, "custGeom");
  let approximated = false;

  // Fill & line
  let fill: Fill | undefined;
  for (const src of [spPr, child(layoutPh, "spPr"), child(masterPh, "spPr")]) {
    fill = await parseFill(src, ctx);
    if (fill) break;
  }
  fill ??= await styleRefFill(child(style, "fillRef"), ctx, ctx.theme.fillStyles);
  let line: Stroke | null | undefined;
  for (const src of [spPr, child(layoutPh, "spPr"), child(masterPh, "spPr")]) {
    line = parseLine(child(src, "ln"), ctx);
    if (line !== undefined) break;
  }
  if (line === undefined) line = styleRefLine(child(style, "lnRef"), ctx);

  // Text
  const txBody = child(sp, "txBody");
  let paragraphs: Paragraph[] = [];
  const body = parseBodyProps([child(txBody, "bodyPr"), path(layoutPh, "txBody", "bodyPr"), path(masterPh, "txBody", "bodyPr")]);
  if (txBody) {
    const fontRef = child(style, "fontRef");
    const d: TextDefaults = {
      sources: [
        child(txBody, "lstStyle"),
        path(layoutPh, "txBody", "lstStyle"),
        path(masterPh, "txBody", "lstStyle"),
        ph ? txStyleFor(ph, ctx) : ctx.defaultTextStyle,
        ph ? ctx.defaultTextStyle : txStyleFor(undefined, ctx),
      ],
      styleColor: resolveColor(fontRef, ctx.color),
      styleFont: fontRef ? resolveFont(attr(fontRef, "idx") === "major" ? "+mj-lt" : "+mn-lt", ctx.theme) : undefined,
      fontScale: body.fontScale,
      lnSpcReduction: body.lnSpcReduction,
    };
    paragraphs = parseParagraphs(txBody, d, ctx, await linkRels(ctx));
  }
  const hasText = hasVisibleText(paragraphs);
  const isTextBox = !!boolAttr(path(sp, "nvSpPr", "cNvSpPr"), "txBox");
  const visibleFill = fill && fill.type !== "none";
  const role = ph ? roleFor(ph.type) : undefined;
  const base = { id: newId(ph || isTextBox ? "text" : "shape"), ...baseProps(sp), frame, provenance: { source: "native" as const } };

  const plainRect = !cust && (!prst || prst === "rect");
  if (plainRect && !line && (ph || isTextBox || hasText || !visibleFill)) {
    if (!hasText && !visibleFill) return null; // empty placeholder or empty text box
    const el: TextElement = {
      ...base,
      type: "text",
      autofit: body.autofit,
      padding: body.padding,
      verticalAlign: body.verticalAlign,
      paragraphs: hasText ? paragraphs : [],
    };
    if (role) el.role = role;
    if (visibleFill) el.fill = fill;
    count(ctx, "text");
    return el;
  }

  let geometry: ShapeElement["geometry"];
  if (cust) {
    const d = customPath(cust, xf.cx, xf.cy, xf.flipH, xf.flipV);
    if (!d) return null;
    geometry = { path: d, viewBox: [0, 0, Math.max(1, xf.cx), Math.max(1, xf.cy)] };
  } else {
    let preset = PRESETS[prst ?? "rect"];
    if (!preset) {
      preset = "rect";
      approximated = true;
      warn(ctx, `Shape type "${prst}" isn't supported yet and was drawn as a rectangle.`);
    }
    if (preset === "line" && xf.flipH !== xf.flipV && xf.cx > 0 && xf.cy > 0) {
      geometry = { path: `M${xf.cx} 0L0 ${xf.cy}`, viewBox: [0, 0, xf.cx, xf.cy] };
    } else {
      geometry = { preset };
      if ((xf.flipH || xf.flipV) && preset !== "rect" && preset !== "ellipse" && preset !== "line" && preset !== "round-rect") approximated = true;
    }
  }
  const isLine = "preset" in geometry ? geometry.preset === "line" : !!prst && PRESETS[prst] === "line";
  const el: ShapeElement = {
    ...base,
    type: "shape",
    geometry,
    fill: isLine ? { type: "none" } : (fill ?? { type: "none" }),
    verticalAlign: body.verticalAlign,
  };
  if (line) el.stroke = line;
  else if (isLine) el.stroke = { color: "#000000", width: 0.75, dash: "solid" };
  if (hasText) el.paragraphs = paragraphs;
  if (approximated) el.provenance = { source: "native", approximated: true };
  count(ctx, "shape");
  return el;
}

function roleFor(type: string): TextElement["role"] {
  if (type === "title" || type === "ctrTitle") return "title";
  if (type === "subTitle") return "subtitle";
  if (type === "ftr" || type === "dt" || type === "sldNum") return "footer";
  return "body";
}

async function parsePic(pic: XNode, ctx: SlideContext, m: Mapper, inherited: boolean): Promise<Parsed> {
  const ph = phOf(pic);
  if (inherited && ph) return null;
  const layoutPh = ph ? findPlaceholder(ctx.layout?.root, ph, false) : undefined;
  const own = readXfrm(path(pic, "spPr", "xfrm"));
  const xf = own ?? readXfrm(path(layoutPh, "spPr", "xfrm"));
  if (!xf) return null;
  const blipFill = child(pic, "blipFill");
  const blip = child(blipFill, "blip");
  const assetId = await mediaAsset(ctx, relAttr(blip, "embed"));
  if (!assetId) return null;
  const el: ImageElement = {
    id: newId("image"),
    ...baseProps(pic),
    type: "image",
    assetId,
    frame: toFrame(xf, own ? m : ROOT_MAPPER),
    mask: "rect",
    provenance: { source: "native" },
  };
  const src = child(blipFill, "srcRect");
  if (src) {
    const crop = { l: pct(numAttr(src, "l") ?? 0), t: pct(numAttr(src, "t") ?? 0), r: pct(numAttr(src, "r") ?? 0), b: pct(numAttr(src, "b") ?? 0) };
    if (crop.l || crop.t || crop.r || crop.b) el.crop = crop;
  }
  const prst = attr(path(pic, "spPr", "prstGeom"), "prst");
  if (prst === "ellipse") el.mask = "ellipse";
  else if (prst === "roundRect") el.mask = "rounded";
  const alt = attr(path(pic, "nvPicPr", "cNvPr"), "descr");
  if (alt) el.alt = alt;
  const alpha = numAttr(child(blip, "alphaModFix"), "amt");
  if (alpha !== undefined) el.opacity = pct(alpha);
  if (xf.flipH || xf.flipV) {
    el.provenance = { source: "native", approximated: true };
    warn(ctx, "Flipped pictures were imported unflipped.");
  }
  count(ctx, "image");
  return el;
}

async function parseGroup(grp: XNode, ctx: SlideContext, m: Mapper, inherited: boolean): Promise<Parsed> {
  const xf = readXfrm(path(grp, "grpSpPr", "xfrm"));
  const chOff = child(xf?.node, "chOff");
  const chExt = child(xf?.node, "chExt");
  if (!xf) return null;
  const frame = toFrame(xf, m);
  const cw = numAttr(chExt, "cx") || xf.cx || 1;
  const ch = numAttr(chExt, "cy") || xf.cy || 1;
  const inner: Mapper = {
    ox: numAttr(chOff, "x") ?? xf.x,
    oy: numAttr(chOff, "y") ?? xf.y,
    kx: m.kx * ((xf.cx || cw) / cw),
    ky: m.ky * ((xf.cy || ch) / ch),
  };
  const kids = await parseTree(grp, ctx, inner, inherited);
  if (kids.length === 0) return null;
  if (xf.flipH || xf.flipV) warn(ctx, "Flipped groups were imported unflipped.");
  const el: GroupElement = { id: newId("group"), ...baseProps(grp), type: "group", frame, children: kids, provenance: { source: "native" } };
  count(ctx, "group");
  return el;
}

function tint(hex: string, amount: number): string {
  return applyModifiers(hex, [{ qname: "a:tint", name: "tint", attrs: { val: String(Math.round(amount * 100000)) }, children: [], text: "" }]);
}

async function parseTable(frameNode: XNode, tbl: XNode, ctx: SlideContext, frame: Frame, m: Mapper): Promise<Parsed> {
  const tblPr = child(tbl, "tblPr");
  const styled = !!find(tblPr, "tableStyleId") || !!child(tblPr, "tableStyle");
  const firstRow = !!boolAttr(tblPr, "firstRow");
  const bandRow = !!boolAttr(tblPr, "bandRow");
  const accent = ctx.color.scheme.accent1 ?? "#4472C4";
  const columns = children(child(tbl, "tblGrid"), "gridCol").map((c) => r2((numAttr(c, "w") ?? 0) * m.kx));
  const rels = await linkRels(ctx);
  const rows: TableElement["rows"] = [];
  const trs = children(tbl, "tr");
  let usedStyle = false;
  for (let ri = 0; ri < trs.length; ri++) {
    const tr = trs[ri];
    const header = firstRow && ri === 0;
    const cells: TableElement["rows"][number]["cells"] = [];
    for (const tc of children(tr, "tc")) {
      // Cells covered by a merge are left out; the spanning cell's colSpan/rowSpan covers them.
      if (boolAttr(tc, "hMerge") || boolAttr(tc, "vMerge")) continue;
      const tcPr = child(tc, "tcPr");
      let fill = await parseFill(tcPr, ctx);
      const styleText: TextDefaults = {
        sources: [child(child(tc, "txBody"), "lstStyle"), ctx.defaultTextStyle, txStyleFor(undefined, ctx)],
      };
      if (!fill && styled) {
        usedStyle = true;
        fill = header ? { type: "solid", color: accent } : { type: "solid", color: tint(accent, bandRow && (ri - (firstRow ? 1 : 0)) % 2 === 1 ? 0.2 : 0.4) };
        if (header) styleText.styleColor = ctx.color.scheme[ctx.color.map.bg1] ?? "#FFFFFF";
      }
      const txBody = child(tc, "txBody");
      let paragraphs = txBody ? parseParagraphs(txBody, styleText, ctx, rels) : [];
      if (header && styled) paragraphs = paragraphs.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r, bold: r.bold ?? true })) }));
      const cell: TableElement["rows"][number]["cells"][number] = { paragraphs };
      if (fill) cell.fill = fill;
      const gs = numAttr(tc, "gridSpan");
      const rs = numAttr(tc, "rowSpan");
      if (gs && gs > 1) cell.colSpan = gs;
      if (rs && rs > 1) cell.rowSpan = rs;
      cells.push(cell);
    }
    rows.push({ height: Math.max(1, r2((numAttr(tr, "h") ?? 0) * m.ky)), cells });
  }
  if (rows.length === 0 || columns.length === 0) return null;
  // Scale rows up to the frame height (PowerPoint grows rows to fit text; the frame reflects that).
  const total = rows.reduce((s, r) => s + r.height, 0);
  if (total < frame.h - 1) rows.forEach((r) => (r.height = r2((r.height * frame.h) / total)));
  frame.h = r2(rows.reduce((s, r) => s + r.height, 0));
  frame.w = r2(columns.reduce((s, c) => s + c, 0));
  const firstBorder = parseLine(path(child(children(trs[0], "tc")[0], "tcPr"), "lnB"), ctx);
  const el: TableElement = {
    id: newId("table"),
    ...baseProps(frameNode),
    type: "table",
    frame,
    columns,
    rows,
    provenance: usedStyle ? { source: "native", approximated: true } : { source: "native" },
  };
  if (usedStyle) el.border = { color: "#FFFFFF", width: 1, dash: "solid" };
  else if (firstBorder) el.border = firstBorder;
  if (usedStyle) warn(ctx, "Built-in table styles were approximated with the theme's accent color.");
  count(ctx, "table");
  return el;
}

async function parseGraphicFrame(gf: XNode, ctx: SlideContext, m: Mapper, inherited: boolean): Promise<Parsed> {
  const xf = readXfrm(child(gf, "xfrm"));
  if (!xf) return null;
  const frame = toFrame(xf, m);
  const data = path(gf, "graphic", "graphicData");
  const uri = attr(data, "uri") ?? "";
  if (uri.endsWith("/table")) {
    const tbl = child(data, "tbl");
    return tbl ? parseTable(gf, tbl, ctx, frame, m) : null;
  }
  if (uri.endsWith("/chart")) {
    const rel = await ctx.pkg.rel(ctx.part, relAttr(child(data, "chart"), "id"));
    const root = rel && (await ctx.pkg.xml(rel.target));
    const parsed = root && parseChart(root, ctx.color);
    if (!parsed) {
      warn(ctx, "A chart type that isn't supported was skipped.");
      return null;
    }
    parsed.warnings.forEach((w) => warn(ctx, w));
    const el: ChartElement = { id: newId("chart"), ...baseProps(gf), type: "chart", frame, spec: parsed.spec, provenance: { source: "native" } };
    count(ctx, "chart");
    return el;
  }
  if (uri.endsWith("/diagram")) return parseSmartArt(gf, data, ctx, xf, m, inherited);
  // OLE objects and others: use a fallback picture when there is one.
  const fallbackPic = find(gf, "pic");
  if (fallbackPic) {
    const pic = await parsePic(fallbackPic, ctx, m, inherited);
    if (pic) {
      pic.frame = frame;
      pic.provenance = { source: "native", approximated: true };
      warn(ctx, "Embedded objects were imported as their preview picture.");
      return pic;
    }
  }
  warn(ctx, "An embedded object without a preview was skipped.");
  return null;
}

/** SmartArt: PowerPoint stores a pre-rendered drawing (dsp:spTree); import it as a group of editable shapes. */
async function parseSmartArt(gf: XNode, data: XNode | undefined, ctx: SlideContext, xf: Xfrm, m: Mapper, inherited: boolean): Promise<Parsed> {
  const dmRel = await ctx.pkg.rel(ctx.part, relAttr(child(data, "relIds"), "dm"));
  const dm = dmRel && (await ctx.pkg.xml(dmRel.target));
  const drawingRelId = attr(find(dm, "dataModelExt"), "relId");
  const drawingRel = await ctx.pkg.rel(ctx.part, drawingRelId);
  const drawing = drawingRel && (await ctx.pkg.xml(drawingRel.target));
  const tree = drawing && find(drawing, "spTree");
  if (!tree || !drawingRel) {
    warn(ctx, "A SmartArt graphic without a saved drawing was skipped.");
    return null;
  }
  // Drawing shapes are positioned relative to the graphic frame; media rels belong to the drawing part.
  const inner: Mapper = { ox: 0, oy: 0, kx: m.kx, ky: m.ky };
  const kids = await parseTree(tree, { ...ctx, part: drawingRel.target }, inner, inherited);
  if (kids.length === 0) return null;
  warn(ctx, "SmartArt was imported as a group of shapes.");
  count(ctx, "smartart");
  return {
    id: newId("group"),
    ...baseProps(gf),
    type: "group",
    frame: toFrame(xf, m),
    children: kids,
    provenance: { source: "native", approximated: true },
  };
}

/** Parses the shape children of an spTree / grpSp in order (= z-order). */
export async function parseTree(container: XNode, ctx: SlideContext, m: Mapper, inherited = false): Promise<Element[]> {
  const out: Element[] = [];
  for (const node of container.children) {
    if (node.name === "AlternateContent") {
      // Prefer the standard Fallback; otherwise take the Choice.
      const branch = child(node, "Fallback") ?? child(node, "Choice");
      if (!branch) continue;
      out.push(...(await parseTree(branch, ctx, m, inherited)));
      continue;
    }
    let el: Parsed = null;
    try {
      if (node.name === "sp" || node.name === "cxnSp") el = await parseSp(node, ctx, m, inherited);
      else if (node.name === "pic") el = await parsePic(node, ctx, m, inherited);
      else if (node.name === "grpSp") el = await parseGroup(node, ctx, m, inherited);
      else if (node.name === "graphicFrame") el = await parseGraphicFrame(node, ctx, m, inherited);
      else if (node.name === "contentPart") warn(ctx, "Ink drawings were skipped.");
    } catch (e) {
      // Keep going with the next element.
      warn(ctx, `An element couldn't be imported (${e instanceof Error ? e.message : String(e)}).`);
    }
    if (el) out.push(el);
  }
  return out;
}

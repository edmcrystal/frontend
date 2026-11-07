/**
 * Client-side PPTX export: Deck → native, editable PowerPoint objects via
 * pptxgenjs, then a small post-processing pass over the generated XML to fix
 * pptxgenjs quirks (see fixSlideXml / fixChartXml).
 *
 * What maps natively: text (runs, bullets, numbering, levels, spacing), preset
 * shapes, images (crop, ellipse mask), tables, charts (real chart parts with
 * data), speaker notes. Approximated: gradient backgrounds and icons/custom
 * paths/SVG images are rasterized to PNG; gradient/image fills on shapes use
 * the first color; rounded image masks export square; groups are flattened.
 */
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import type {
  Bullet,
  ChartElement,
  ChartSpec,
  Deck,
  Element,
  Fill,
  Frame,
  ImageElement,
  Paragraph,
  ShapeElement,
  Slide,
  Stroke,
  TableElement,
  TextElement,
  Theme,
} from "@/lib/deck/schema";
import { DEFAULT_TEXT_PADDING } from "@/lib/deck/schema";
import { center, rotate } from "@/lib/deck/geometry";
import { bulletIndent, gradientVector, LEVEL_INDENT, presetPath, strokeDashArray } from "@/lib/deck/render-utils";
import { themePalette } from "@/lib/charts/toEcharts";

// Text inside shapes uses the default insets; pptxgenjs order is left, right, bottom, top.
const shapeTextMargin: [number, number, number, number] = [
  DEFAULT_TEXT_PADDING[3],
  DEFAULT_TEXT_PADDING[1],
  DEFAULT_TEXT_PADDING[2],
  DEFAULT_TEXT_PADDING[0],
];

type Pptx = InstanceType<typeof PptxGenJS>;
type PptxSlide = ReturnType<Pptx["addSlide"]>;
type TextRun = PptxGenJS.TextProps;

export const PT_PER_IN = 72;
/** Temporary `lang` value carrying a bullet color through pptxgenjs (removed in fixSlideXml). */
const BULLET_COLOR_TAG = "x-bu-";
/** EMU per point (OOXML unit). */
const EMU_PT = 12700;
/** Our renderer's default line height; PowerPoint "single" spacing is roughly the same. */
const BASE_LINE_HEIGHT = 1.2;
/** Icons and other vectors are rasterized at this multiple of their slide size. */
const RASTER_SCALE = 4;

/** Points → inches, rounded below EMU precision (1 EMU ≈ 1.1e-6 in). */
export const inches = (pt: number) => Math.round((pt / PT_PER_IN) * 1e6) / 1e6;

// ---------- Colors ----------

/** "#RRGGBB[AA]" → pptxgenjs color (no '#') plus transparency 0–100 from the alpha channel. */
export function toPptxColor(hex: string): { color: string; transparency?: number } {
  const h = hex.replace(/^#/, "").toUpperCase();
  if (h.length === 8) {
    const alpha = parseInt(h.slice(6), 16) / 255;
    return { color: h.slice(0, 6), transparency: Math.round((1 - alpha) * 100) };
  }
  return { color: h.slice(0, 6) };
}

/** Combines a color's own alpha with element opacity into a pptxgenjs transparency. */
function transparencyOf(hex: string, opacity: number): number | undefined {
  const own = toPptxColor(hex).transparency ?? 0;
  const t = Math.round(100 - (100 - own) * opacity);
  return t > 0 ? Math.min(100, t) : undefined;
}

function fillColor(fill: Fill | undefined): string | null {
  if (!fill) return null;
  if (fill.type === "solid") return fill.color;
  if (fill.type === "linear-gradient") return fill.stops[0].color;
  return null;
}

export const normalizeRotation = (deg: number) => {
  const r = ((deg % 360) + 360) % 360;
  return Math.round(r * 100) / 100;
};

// ---------- Groups ----------

export type FlatElement = { el: Exclude<Element, { type: "group" }>; frame: Frame; opacity: number };

/**
 * Flattens groups into slide space. Child frames are group-local; the group's
 * rotation turns children around the group center and adds to their own.
 */
export function flattenElements(elements: Element[], parent?: { frame: Frame; opacity: number }): FlatElement[] {
  const out: FlatElement[] = [];
  for (const el of elements) {
    if (el.hidden) continue;
    let frame = el.frame;
    let opacity = el.opacity ?? 1;
    if (parent) {
      const g = parent.frame;
      const gc = center(g);
      const local = { x: el.frame.x + el.frame.w / 2 - g.w / 2, y: el.frame.y + el.frame.h / 2 - g.h / 2 };
      const r = rotate(local, g.rotation);
      frame = {
        x: gc.x + r.x - el.frame.w / 2,
        y: gc.y + r.y - el.frame.h / 2,
        w: el.frame.w,
        h: el.frame.h,
        rotation: el.frame.rotation + g.rotation,
      };
      opacity *= parent.opacity;
    }
    if (el.type === "group") out.push(...flattenElements(el.children, { frame, opacity }));
    else out.push({ el, frame, opacity });
  }
  return out;
}

const position = (f: Frame) => ({
  x: inches(f.x),
  y: inches(f.y),
  w: inches(Math.max(f.w, 0)),
  h: inches(Math.max(f.h, 0)),
  ...(f.rotation ? { rotate: normalizeRotation(f.rotation) } : {}),
});

// ---------- Text ----------

const NUMBER_STYLES: Record<Extract<Bullet, { type: "number" }>["format"], string> = {
  "arabic-period": "arabicPeriod",
  "arabic-paren": "arabicParenR",
  "alpha-lower": "alphaLcPeriod",
  "alpha-upper": "alphaUcPeriod",
  "roman-lower": "romanLcPeriod",
  "roman-upper": "romanUcPeriod",
};

/** pptxgenjs bullet options. `indent` is the hanging indent in pt (our renderer: size × 1.1). */
type BulletProps = NonNullable<PptxGenJS.TextPropsOptions["bullet"]>;

export function bulletOptions(bullet: Bullet | undefined, size: number): BulletProps {
  if (!bullet) return false;
  const indent = Math.round(bulletIndent(size) * 100) / 100;
  if (bullet.type === "number") {
    const style = NUMBER_STYLES[bullet.format];
    // pptxgenjs reads `style` (its types say `numberType`); pass both.
    return { type: "number", style, numberType: style, numberStartAt: bullet.startAt, indent } as BulletProps;
  }
  const code = (bullet.char.codePointAt(0) ?? 0x2022).toString(16).toUpperCase().padStart(4, "0");
  return { characterCode: code.length === 4 ? code : "2022", indent };
}

/**
 * Paragraphs → pptxgenjs text runs. Paragraph properties go on each
 * paragraph's first run (pptxgenjs emits a pPr per run; the extra ones are
 * stripped in fixSlideXml). "\n" inside a run becomes a soft line break.
 */
export function paragraphsToRuns(paragraphs: Paragraph[], opacity = 1): TextRun[] {
  const runs: TextRun[] = [];
  paragraphs.forEach((p, pi) => {
    const size = p.runs[0]?.size ?? 18;
    const paraOpts: Record<string, unknown> = { align: p.align };
    if (p.lineHeight) paraOpts.lineSpacingMultiple = Math.round((p.lineHeight / BASE_LINE_HEIGHT) * 100) / 100;
    if (p.spaceBefore) paraOpts.paraSpaceBefore = p.spaceBefore;
    if (p.spaceAfter) paraOpts.paraSpaceAfter = p.spaceAfter;
    if (p.level) paraOpts.indentLevel = p.level;
    if (p.bullet) paraOpts.bullet = bulletOptions(p.bullet, size);

    const pieces: TextRun[] = [];
    const source = p.runs.length ? p.runs : [{ text: "", font: "Arial", size, color: "#000000" }];
    for (const run of source) {
      const color = toPptxColor(run.color);
      const transparency = transparencyOf(run.color, opacity);
      const base: Record<string, unknown> = {
        fontFace: run.font,
        fontSize: Math.round(run.size * 100) / 100,
        color: color.color,
        ...(transparency ? { transparency } : {}),
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.underline ? { underline: { style: "sng" } } : {}),
        ...(run.strike ? { strike: "sngStrike" } : {}),
        ...(run.highlight ? { highlight: toPptxColor(run.highlight).color } : {}),
        ...(run.link ? { hyperlink: { url: run.link } } : {}),
        ...(run.letterSpacing ? { charSpacing: run.letterSpacing } : {}),
      };
      run.text.split("\n").forEach((part, i) => {
        pieces.push({ text: part, options: { ...base, ...(i > 0 ? { softBreakBefore: true } : {}) } as TextRun["options"] });
      });
    }
    pieces[0].options = { ...paraOpts, ...pieces[0].options } as TextRun["options"];
    // pptxgenjs has no bullet color; tag the paragraph's first run and add <a:buClr> in fixSlideXml.
    if (p.bullet?.type === "char" && p.bullet.color) {
      pieces[0].options = { ...pieces[0].options, lang: `${BULLET_COLOR_TAG}${toPptxColor(p.bullet.color).color}` } as TextRun["options"];
    }
    if (pi < paragraphs.length - 1) {
      const last = pieces[pieces.length - 1];
      last.options = { ...last.options, breakLine: true } as TextRun["options"];
    }
    runs.push(...pieces);
  });
  return runs;
}

// ---------- Shapes ----------

const SHAPE_TYPES: Record<string, string> = {
  rect: "rect",
  "round-rect": "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  chevron: "chevron",
  "arrow-right": "rightArrow",
  line: "line",
};

export function shapeTypeFor(preset: string): string {
  return SHAPE_TYPES[preset] ?? "rect";
}

const DASH: Record<Stroke["dash"], "solid" | "dash" | "sysDot" | "dashDot"> = {
  solid: "solid",
  dash: "dash",
  dot: "sysDot",
  "dash-dot": "dashDot",
};

function lineOptions(stroke: Stroke | undefined, opacity: number) {
  if (!stroke || stroke.width <= 0) return { type: "none" as const };
  const t = transparencyOf(stroke.color, opacity);
  return { color: toPptxColor(stroke.color).color, width: stroke.width, dashType: DASH[stroke.dash], ...(t ? { transparency: t } : {}) };
}

function shapeFillOptions(fill: Fill, opacity: number) {
  const c = fillColor(fill);
  if (!c) return { type: "none" as const };
  const t = transparencyOf(c, opacity);
  return { type: "solid" as const, color: toPptxColor(c).color, ...(t ? { transparency: t } : {}) };
}

// ---------- Charts ----------

export type PptxChart = { type: string; data: { name: string; labels?: string[]; values: (number | null)[] }[]; options: Record<string, unknown> };

const LEGEND_POS = { top: "t", bottom: "b", left: "l", right: "r" } as const;

/** Maps a ChartSpec to a native pptxgenjs chart (type, data series and options). */
export function chartToPptx(spec: ChartSpec, theme: Theme): PptxChart {
  const palette = themePalette(theme).map((c) => toPptxColor(c).color);
  const font = theme.fonts.body;
  const textColor = toPptxColor(theme.colors.text).color;
  const pie = spec.type === "pie" || spec.type === "donut";
  const seriesColors = spec.series.map((s, i) => toPptxColor(s.color ?? theme.colors[`accent${(i % 6) + 1}` as "accent1"]).color);

  const options: Record<string, unknown> = {
    chartColors: pie ? spec.categories.map((_, i) => palette[i % palette.length]) : seriesColors,
    showLegend: spec.legend !== "none",
    ...(spec.legend !== "none" ? { legendPos: LEGEND_POS[spec.legend], legendFontFace: font, legendFontSize: 10, legendColor: textColor } : {}),
    showValue: !!spec.dataLabels,
    dataLabelFormatCode: "General", // pptxgenjs defaults to "#,##0", which rounds 1.2 to 1
    dataLabelFontFace: font,
    dataLabelFontSize: 10,
    dataLabelColor: textColor,
    ...(spec.title ? { showTitle: true, title: spec.title, titleFontFace: font, titleFontSize: 14, titleColor: textColor } : {}),
  };
  if (!pie) {
    Object.assign(options, {
      catAxisLabelFontFace: font,
      catAxisLabelFontSize: 10,
      catAxisLabelColor: textColor,
      valAxisLabelFontFace: font,
      valAxisLabelFontSize: 10,
      valAxisLabelColor: textColor,
      valGridLine: { color: "E5E7EB", size: 0.75 },
      ...(spec.axes?.xTitle ? { showCatAxisTitle: true, catAxisTitle: spec.axes.xTitle } : {}),
      ...(spec.axes?.yTitle ? { showValAxisTitle: true, valAxisTitle: spec.axes.yTitle } : {}),
    });
  }

  const series = spec.series.map((s) => ({ name: s.name, labels: spec.categories, values: s.values }));

  switch (spec.type) {
    case "column":
    case "bar":
      return {
        type: "bar",
        data: series,
        options: { ...options, barDir: spec.type === "bar" ? "bar" : "col", barGrouping: spec.stacked ? "stacked" : "clustered", ...(spec.stacked ? { barOverlap: 100 } : {}), ...(spec.type === "bar" ? { catAxisOrientation: "maxMin" } : {}) },
      };
    case "line":
      return { type: "line", data: series, options: { ...options, lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 6 } };
    case "area":
      return { type: "area", data: series, options: { ...options, barGrouping: spec.stacked ? "stacked" : "standard" } };
    case "pie":
    case "donut":
      return {
        type: spec.type === "donut" ? "doughnut" : "pie",
        data: [{ name: spec.series[0].name, labels: spec.categories, values: spec.series[0].values }],
        options: { ...options, showPercent: false, ...(spec.type === "donut" ? { holeSize: 64 } : {}) },
      };
    case "scatter": {
      // pptxgenjs scatter: first entry holds X values, the rest are Y series.
      const xs = spec.categories.map((c, i) => (Number.isFinite(Number(c)) ? Number(c) : i));
      return {
        type: "scatter",
        data: [{ name: "X", values: xs }, ...spec.series.map((s) => ({ name: s.name, values: s.values }))],
        options: { ...options, lineSize: 0, lineDataSymbol: "circle", lineDataSymbolSize: 7 },
      };
    }
  }
}

// ---------- Raster helpers ----------

/** Turns SVG markup into a PNG data URL of the given pixel size. Injectable so tests can stub it. */
export type Rasterizer = (svg: string, width: number, height: number) => Promise<string>;
/** Fetches an asset URL and returns a data URL. */
export type AssetLoader = (url: string) => Promise<string>;

export type ExportOptions = {
  rasterize?: Rasterizer;
  loadAsset?: AssetLoader;
};

export type ExportResult = { warnings: string[] };

const svgDoc = (inner: string, viewBox: string, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}" preserveAspectRatio="none" ${extra}>${inner}</svg>`;

function gradientSvg(fill: Extract<Fill, { type: "linear-gradient" }>, w: number, h: number): string {
  const v = gradientVector(fill.angle);
  const stops = fill.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color.slice(0, 7)}"${s.color.length === 9 ? ` stop-opacity="${(parseInt(s.color.slice(7), 16) / 255).toFixed(3)}"` : ""}/>`).join("");
  return svgDoc(`<defs><linearGradient id="g" x1="${v.x1}" y1="${v.y1}" x2="${v.x2}" y2="${v.y2}">${stops}</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`, `0 0 ${w} ${h}`);
}

function isSvgUrl(url: string) {
  return /^data:image\/svg\+xml/i.test(url) || /\.svg(\?|#|$)/i.test(url);
}

/** pptxgenjs wants "image/png;base64,…" (it also accepts the "data:" prefix). */
function asImageData(dataUrl: string) {
  return dataUrl.replace(/^data:/, "");
}

// ---------- Builder ----------

/**
 * Adds every slide of `deck` to a pptxgenjs presentation. Pure apart from the
 * injected rasterizer/asset loader, so it runs in node for tests.
 */
export async function buildPresentation(deck: Deck, pptx: Pptx, opts: ExportOptions = {}): Promise<ExportResult> {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };
  const assetCache = new Map<string, Promise<string>>();
  const load = (url: string) => {
    if (url.startsWith("data:")) return Promise.resolve(url);
    if (!opts.loadAsset) return Promise.reject(new Error(`No asset loader for ${url}`));
    if (!assetCache.has(url)) assetCache.set(url, opts.loadAsset(url));
    return assetCache.get(url)!;
  };
  const raster = async (svg: string, w: number, h: number) => {
    if (!opts.rasterize) throw new Error("No rasterizer available");
    return opts.rasterize(svg, Math.max(1, Math.round(w * RASTER_SCALE)), Math.max(1, Math.round(h * RASTER_SCALE)));
  };

  pptx.defineLayout({ name: "DECK", width: inches(deck.size.width), height: inches(deck.size.height) });
  pptx.layout = "DECK";
  pptx.title = deck.title;
  pptx.theme = { headFontFace: deck.theme.fonts.heading, bodyFontFace: deck.theme.fonts.body };

  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    await addBackground(s, slide, deck, { load, raster, warn });
    for (const item of flattenElements(slide.elements)) {
      try {
        await addElement(s, item, deck, { load, raster, warn });
      } catch (err) {
        warn(`Skipped ${item.el.type} "${item.el.name ?? item.el.id}": ${(err as Error).message}`);
      }
    }
    if (slide.notes) s.addNotes(slide.notes);
  }
  return { warnings };
}

type Ctx = {
  load: (url: string) => Promise<string>;
  raster: (svg: string, w: number, h: number) => Promise<string>;
  warn: (msg: string) => void;
};

async function addBackground(s: PptxSlide, slide: Slide, deck: Deck, ctx: Ctx) {
  const bg = slide.background;
  if (bg.type === "solid") {
    s.background = { color: toPptxColor(bg.color).color, ...(toPptxColor(bg.color).transparency ? { transparency: toPptxColor(bg.color).transparency } : {}) };
  } else if (bg.type === "linear-gradient") {
    try {
      s.background = { data: asImageData(await ctx.raster(gradientSvg(bg, deck.size.width, deck.size.height), deck.size.width, deck.size.height)) };
    } catch {
      s.background = { color: toPptxColor(bg.stops[0].color).color };
      ctx.warn("Gradient backgrounds were exported as a solid color.");
    }
  } else if (bg.type === "image") {
    const url = deck.assets[bg.assetId]?.url;
    if (url) s.background = { data: asImageData(await imageData(url, deck.size.width, deck.size.height, ctx)) };
  }
}

/** Loads an image as a data URL; SVGs are rasterized so every PowerPoint version shows them. */
async function imageData(url: string, w: number, h: number, ctx: Ctx): Promise<string> {
  const data = await ctx.load(url);
  if (!isSvgUrl(url) && !/^data:image\/svg/i.test(data)) return data;
  const svg = decodeSvgDataUrl(data);
  return ctx.raster(svg, w, h);
}

function decodeSvgDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = typeof atob === "function" ? atob(body) : Buffer.from(body, "base64").toString("binary");
    return decodeURIComponent(escape(bin));
  }
  return decodeURIComponent(body);
}

async function addElement(s: PptxSlide, item: FlatElement, deck: Deck, ctx: Ctx) {
  const { el, frame, opacity } = item;
  const name = el.name ?? el.id;
  switch (el.type) {
    case "text":
      return addTextBox(s, el, frame, opacity, name);
    case "shape":
      return addShape(s, el, frame, opacity, name, ctx);
    case "image":
      return addImage(s, el, frame, opacity, name, deck, ctx);
    case "table":
      return addTable(s, el, frame, opacity, name);
    case "chart":
      return addChart(s, el, frame, name, deck.theme);
    case "icon": {
      const svg = svgDoc(el.svg, el.viewBox.join(" "), `style="color:${el.color}" color="${el.color}"`).replace('preserveAspectRatio="none" ', "");
      const png = await ctx.raster(svg, frame.w, frame.h);
      const t = opacity < 1 ? Math.round((1 - opacity) * 100) : undefined;
      s.addImage({ data: asImageData(png), ...position(frame), ...(t ? { transparency: t } : {}), altText: el.name ?? el.iconId ?? "icon", objectName: name });
      ctx.warn("Icons were exported as images.");
      return;
    }
  }
}

const VALIGN = { top: "top", middle: "middle", bottom: "bottom" } as const;

function addTextBox(s: PptxSlide, el: TextElement, frame: Frame, opacity: number, name: string) {
  const [t, r, b, l] = el.padding;
  const fill = fillColor(el.fill);
  s.addText(paragraphsToRuns(el.paragraphs, opacity), {
    ...position(frame),
    margin: [l, r, b, t], // pptxgenjs order: left, right, bottom, top (points)
    valign: VALIGN[el.verticalAlign],
    fit: el.autofit === "shrink" ? "shrink" : el.autofit === "resize" ? "resize" : "none",
    wrap: true,
    ...(fill ? { fill: { color: toPptxColor(fill).color, ...(transparencyOf(fill, opacity) ? { transparency: transparencyOf(fill, opacity) } : {}) } } : {}),
    objectName: name,
  });
}

async function addShape(s: PptxSlide, el: ShapeElement, frame: Frame, opacity: number, name: string, ctx: Ctx) {
  if (!("preset" in el.geometry)) {
    // Custom paths: rasterize the vector (keeps the look; not editable as a shape).
    const { path, viewBox } = el.geometry;
    const c = fillColor(el.fill);
    const stroke = el.stroke;
    const inner = `<path d="${path}" fill="${c ? c.slice(0, 7) : "none"}"${stroke ? ` stroke="${stroke.color.slice(0, 7)}" stroke-width="${stroke.width}" vector-effect="non-scaling-stroke"${strokeDashArray(stroke.dash, stroke.width) ? ` stroke-dasharray="${strokeDashArray(stroke.dash, stroke.width)}"` : ""}` : ""}/>`;
    const png = await ctx.raster(svgDoc(inner, viewBox.join(" "), 'overflow="visible"'), frame.w, frame.h);
    s.addImage({ data: asImageData(png), ...position(frame), ...(opacity < 1 ? { transparency: Math.round((1 - opacity) * 100) } : {}), objectName: name });
    ctx.warn("Custom-path shapes were exported as images.");
    if (el.paragraphs?.some((p) => p.runs.some((r) => r.text))) {
      s.addText(paragraphsToRuns(el.paragraphs, opacity), { ...position(frame), valign: VALIGN[el.verticalAlign], margin: shapeTextMargin, objectName: `${name} text` });
    }
    return;
  }
  const preset = el.geometry.preset;
  if (el.fill.type === "image" || el.fill.type === "linear-gradient") ctx.warn("Gradient and image fills on shapes were exported as a solid color.");
  const shape = shapeTypeFor(preset) as PptxGenJS.SHAPE_NAME;
  const common = {
    ...position(frame),
    fill: preset === "line" ? undefined : shapeFillOptions(el.fill, opacity),
    line: lineOptions(el.stroke ?? (preset === "line" ? { color: "#000000", width: 1, dash: "solid" } : undefined), opacity),
    // Our round-rect radius is 10% of the short side; pptxgenjs takes the radius in inches.
    ...(preset === "round-rect" ? { rectRadius: inches(Math.min(frame.w, frame.h) * 0.1) } : {}),
    objectName: name,
  };
  const hasText = el.paragraphs?.some((p) => p.runs.some((r) => r.text));
  if (hasText) {
    s.addText(paragraphsToRuns(el.paragraphs!, opacity), {
      ...common,
      shape,
      valign: VALIGN[el.verticalAlign],
      margin: shapeTextMargin,
      fit: "none",
      wrap: true,
    } as PptxGenJS.TextPropsOptions);
  } else {
    s.addShape(shape, common as PptxGenJS.ShapeProps);
  }
}

async function addImage(s: PptxSlide, el: ImageElement, frame: Frame, opacity: number, name: string, deck: Deck, ctx: Ctx) {
  const asset = deck.assets[el.assetId];
  if (!asset) throw new Error(`missing asset ${el.assetId}`);
  const { l = 0, t = 0, r = 0, b = 0 } = el.crop ?? {};
  const visW = Math.max(1 - l - r, 0.01);
  const visH = Math.max(1 - t - b, 0.01);
  // Full (uncropped) image size on the slide, so the crop box maps 1:1.
  const fullW = frame.w / visW;
  const fullH = frame.h / visH;
  const data = await imageData(asset.url, fullW, fullH, ctx);
  if (el.mask === "rounded") ctx.warn("Rounded image corners were exported square.");
  const cropped = !!el.crop && (l || t || r || b);
  s.addImage({
    data: asImageData(data),
    x: inches(frame.x),
    y: inches(frame.y),
    w: inches(cropped ? fullW : frame.w),
    h: inches(cropped ? fullH : frame.h),
    ...(cropped ? { sizing: { type: "crop", x: inches(l * fullW), y: inches(t * fullH), w: inches(frame.w), h: inches(frame.h) } } : {}),
    ...(frame.rotation ? { rotate: normalizeRotation(frame.rotation) } : {}),
    ...(el.mask === "ellipse" ? { rounding: true } : {}),
    ...(opacity < 1 ? { transparency: Math.round((1 - opacity) * 100) } : {}),
    altText: el.alt ?? "",
    objectName: name,
  });
}

function addTable(s: PptxSlide, el: TableElement, frame: Frame, opacity: number, name: string) {
  const border = el.border
    ? { type: el.border.dash === "solid" ? ("solid" as const) : ("dash" as const), pt: el.border.width, color: toPptxColor(el.border.color).color }
    : { type: "none" as const };
  const rows = el.rows.map((row) =>
    row.cells.map((cell) => {
      const fill = fillColor(cell.fill);
      return {
        text: paragraphsToRuns(cell.paragraphs.length ? cell.paragraphs : [{ align: "left", level: 0, runs: [] }], opacity),
        options: {
          valign: "middle" as const,
          margin: [inches(4), inches(6), inches(4), inches(6)], // inches, TRBL (matches renderer cell padding)
          border: [border, border, border, border],
          ...(fill ? { fill: { color: toPptxColor(fill).color } } : {}),
          ...(cell.colSpan && cell.colSpan > 1 ? { colspan: cell.colSpan } : {}),
          ...(cell.rowSpan && cell.rowSpan > 1 ? { rowspan: cell.rowSpan } : {}),
        },
      };
    }),
  );
  // Scale columns/rows to the element frame (the table can be resized on the slide).
  const colTotal = el.columns.reduce((a, c) => a + c, 0) || 1;
  const rowTotal = el.rows.reduce((a, r) => a + r.height, 0) || 1;
  s.addTable(rows as PptxGenJS.TableRow[], {
    x: inches(frame.x),
    y: inches(frame.y),
    w: inches(frame.w),
    colW: el.columns.map((c) => inches((c / colTotal) * frame.w)),
    rowH: el.rows.map((r) => inches((r.height / rowTotal) * frame.h)),
    objectName: name,
  } as PptxGenJS.TableProps);
}

function addChart(s: PptxSlide, el: ChartElement, frame: Frame, name: string, theme: Theme) {
  const chart = chartToPptx(el.spec, theme);
  s.addChart(chart.type as PptxGenJS.CHART_NAME, chart.data as never, { ...position(frame), ...chart.options, objectName: name } as PptxGenJS.IChartOpts);
}

// ---------- XML post-processing ----------

const PPR = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g;
const BULLET_COLOR_RE = new RegExp(`lang="${BULLET_COLOR_TAG}([0-9A-F]{6})"`);
const BULLET_TAG_ATTR = new RegExp(`lang="${BULLET_COLOR_TAG}[0-9A-F]{6}"(?: altLang="en-US")?`, "g");

/**
 * Fixes pptxgenjs text output:
 * - it emits an <a:pPr> before every run; only the first is valid, so drop the rest;
 * - bullet colors (tagged on the first run's `lang`) become <a:buClr>;
 * - bullet margins: make the hanging indent sit inside the level indent
 *   (marL = level × 27pt + bullet width), and indent non-bulleted levels,
 *   matching the editor's renderer.
 */
export function fixSlideXml(xml: string): string {
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_m, body: string) => {
    const bulletColor = BULLET_COLOR_RE.exec(body)?.[1];
    let seen = 0;
    const cleaned = body
      .replace(PPR, (ppr) => {
        if (seen++ > 0) return "";
        const out = fixParagraphMargins(ppr);
        return bulletColor ? out.replace(/<a:buSzPct\b/, `<a:buClr><a:srgbClr val="${bulletColor}"/></a:buClr><a:buSzPct`) : out;
      })
      .replace(BULLET_TAG_ATTR, 'lang="en-US"');
    return `<a:p>${cleaned}</a:p>`;
  });
}

function fixParagraphMargins(ppr: string): string {
  const lvl = Number(/\blvl="(\d+)"/.exec(ppr)?.[1] ?? 0);
  const indent = Number(/\bindent="(-?\d+)"/.exec(ppr)?.[1] ?? 0);
  const hasBullet = /<a:bu(Char|AutoNum)\b/.test(ppr);
  const marL = lvl * LEVEL_INDENT * EMU_PT + (hasBullet ? Math.abs(indent) : 0);
  if (!hasBullet && lvl === 0) return ppr;
  return ppr.replace(/\bmarL="\d+"/, `marL="${Math.round(marL)}"`);
}

/** Drops empty data points (null values) that pptxgenjs writes as <c:v></c:v>. */
export function fixChartXml(xml: string): string {
  return xml.replace(/<c:pt idx="\d+"><c:v><\/c:v><\/c:pt>/g, "");
}

export async function postProcess(zipData: ArrayBuffer | Uint8Array | Blob): Promise<JSZip> {
  const zip = await JSZip.loadAsync(zipData);
  const files = Object.keys(zip.files);
  await Promise.all(
    files.map(async (f) => {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(f)) zip.file(f, fixSlideXml(await zip.file(f)!.async("string")));
      else if (/^ppt\/charts\/chart\d+\.xml$/.test(f)) zip.file(f, fixChartXml(await zip.file(f)!.async("string")));
    }),
  );
  return zip;
}

// ---------- Browser entry point ----------

/** Rasterizes SVG markup with an <img> + canvas (browser only). */
export const browserRasterize: Rasterizer = (svg, width, height) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return reject(new Error("Canvas unavailable"));
      ctx2d.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Could not render SVG"));
    const withSize = svg.replace(/^<svg\b/, `<svg width="${width}" height="${height}"`);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withSize)}`;
  });

/** Fetches a URL (relative URLs resolve against the page) as a data URL (browser only). */
export const browserLoadAsset: AssetLoader = async (url) => {
  const res = await fetch(new URL(url, window.location.origin));
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

/** Builds a .pptx for the deck. Defaults to browser rasterizing/fetching. */
export async function exportDeckToPptx(deck: Deck, opts: ExportOptions = {}): Promise<{ blob: Blob; warnings: string[] }> {
  const pptx = new PptxGenJS();
  const { warnings } = await buildPresentation(deck, pptx, {
    rasterize: opts.rasterize ?? (typeof document !== "undefined" ? browserRasterize : undefined),
    loadAsset: opts.loadAsset ?? (typeof window !== "undefined" ? browserLoadAsset : undefined),
  });
  const raw = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  const zip = await postProcess(raw);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", compression: "DEFLATE" });
  return { blob, warnings };
}

/** Safe file name for a deck title. */
export function pptxFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${base || "Presentation"}.pptx`;
}

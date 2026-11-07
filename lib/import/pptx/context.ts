/** State shared while importing one deck/slide, plus fill and line resolution. */
import type { Asset, Fill, Stroke } from "@/lib/deck/schema";
import { newId } from "@/lib/deck/commands";
import type { ImportWarning } from "../types";
import { attr, child, children, numAttr, path, relAttr, type XNode } from "../xml";
import { emuToPt, pct, resolveColor, type ColorContext } from "../color";
import { imageSize, UNRENDERABLE_MIME, type Package } from "./package";

export type ThemeInfo = {
  colors: ColorContext["scheme"];
  majorFont: string;
  minorFont: string;
  /** a:fmtScheme lists, for style references (fillRef/lnRef/bgRef idx). */
  fillStyles: XNode[];
  bgFillStyles: XNode[];
  lineStyles: XNode[];
};

/** A source part (slide, layout, master) with its parsed root. */
export type PartRef = { part: string; root: XNode };

export type DeckContext = {
  pkg: Package;
  theme: ThemeInfo;
  assets: Record<string, Asset>;
  /** media part path -> asset id, so repeated images share one asset. */
  assetByPath: Map<string, string>;
  warnings: ImportWarning[];
  counts: Record<string, number>;
  /** presentation.xml defaultTextStyle. */
  defaultTextStyle?: XNode;
};

export type SlideContext = DeckContext & {
  slideNo: number;
  slide: PartRef;
  layout?: PartRef;
  master?: PartRef;
  color: ColorContext;
  /** The part whose rels resolve r:id references of the element being parsed. */
  part: string;
};

export function warn(ctx: SlideContext | DeckContext, message: string) {
  const slide = "slideNo" in ctx ? ctx.slideNo : undefined;
  if (!ctx.warnings.some((w) => w.slide === slide && w.message === message)) ctx.warnings.push({ slide, message });
}

export function count(ctx: DeckContext, kind: string) {
  ctx.counts[kind] = (ctx.counts[kind] ?? 0) + 1;
}

/** Resolves "+mj-lt"/"+mn-lt" theme font references. */
export function resolveFont(typeface: string | undefined, theme: ThemeInfo): string | undefined {
  if (!typeface) return undefined;
  if (typeface.startsWith("+mj")) return theme.majorFont;
  if (typeface.startsWith("+mn")) return theme.minorFont;
  return typeface;
}

/** Loads a media part as an asset (deduplicated). Returns undefined for formats browsers can't show. */
export async function mediaAsset(ctx: SlideContext, rId: string | undefined): Promise<string | undefined> {
  const rel = await ctx.pkg.rel(ctx.part, rId);
  if (!rel || rel.external) {
    if (rel?.external) warn(ctx, "Linked (external) images aren't imported.");
    return undefined;
  }
  const existing = ctx.assetByPath.get(rel.target);
  if (existing) return existing;
  const media = await ctx.pkg.media(rel.target);
  if (!media) return undefined;
  if (UNRENDERABLE_MIME.has(media.mime)) {
    warn(ctx, `An image in ${media.mime.replace("image/", "").toUpperCase()} format can't be shown in the browser and was skipped.`);
    return undefined;
  }
  const bytes = await ctx.pkg.bytes(rel.target);
  const size = bytes ? imageSize(bytes) : null;
  const id = newId("asset");
  ctx.assets[id] = { id, kind: "image", url: media.dataUrl, mime: media.mime, ...(size ?? {}) };
  ctx.assetByPath.set(rel.target, id);
  return id;
}

// ---------- Fills ----------

/** Resolves a fill-bearing node (spPr, bgPr, tcPr…). undefined = no fill specified (inherit). */
export async function parseFill(node: XNode | undefined, ctx: SlideContext, phColor?: string): Promise<Fill | undefined> {
  if (!node) return undefined;
  const color = { ...ctx.color, placeholder: phColor ?? ctx.color.placeholder };
  for (const c of node.children) {
    switch (c.name) {
      case "noFill":
        return { type: "none" };
      case "solidFill": {
        const hex = resolveColor(c, color);
        return hex ? { type: "solid", color: hex } : undefined;
      }
      case "gradFill": {
        const stops = children(child(c, "gsLst"), "gs")
          .map((gs) => ({ offset: Math.min(1, Math.max(0, pct(numAttr(gs, "pos") ?? 0))), color: resolveColor(gs, color) }))
          .filter((s): s is { offset: number; color: string } => !!s.color)
          .sort((a, b) => a.offset - b.offset);
        if (stops.length === 0) return undefined;
        if (stops.length === 1) return { type: "solid", color: stops[0].color };
        // DrawingML lin ang: 0 = left→right, clockwise. CSS: 90deg = to right.
        const ang = numAttr(child(c, "lin"), "ang");
        if (!child(c, "lin")) warn(ctx, "Radial/path gradients were approximated as linear.");
        return { type: "linear-gradient", angle: Math.round(((ang ?? 0) / 60000 + 90) % 360), stops };
      }
      case "blipFill": {
        const assetId = await mediaAsset(ctx, relAttr(child(c, "blip"), "embed"));
        if (!assetId) return undefined;
        return { type: "image", assetId, fit: child(c, "tile") ? "cover" : "stretch" };
      }
      case "pattFill": {
        const hex = resolveColor(child(c, "fgClr"), color);
        warn(ctx, "Pattern fills were approximated as solid colors.");
        return hex ? { type: "solid", color: hex } : undefined;
      }
      case "grpFill":
        return undefined;
    }
  }
  return undefined;
}

/** Fill from a theme style reference (p:style/a:fillRef or bgRef). */
export async function styleRefFill(ref: XNode | undefined, ctx: SlideContext, list: XNode[], base = 1): Promise<Fill | undefined> {
  const idx = numAttr(ref, "idx");
  if (!ref || !idx) return undefined;
  const refColor = resolveColor(ref, ctx.color);
  const style = list[idx - base];
  if (!style) return refColor ? { type: "solid", color: refColor } : undefined;
  return parseFill({ ...style, children: [style] }, ctx, refColor);
}

const DASH: Record<string, Stroke["dash"]> = {
  solid: "solid",
  dash: "dash",
  lgDash: "dash",
  sysDash: "dash",
  dot: "dot",
  sysDot: "dot",
  dashDot: "dash-dot",
  lgDashDot: "dash-dot",
  lgDashDotDot: "dash-dot",
  sysDashDot: "dash-dot",
  sysDashDotDot: "dash-dot",
};

/** Resolves <a:ln>. null = explicitly no line; undefined = not specified. */
export function parseLine(ln: XNode | undefined, ctx: SlideContext, phColor?: string): Stroke | null | undefined {
  if (!ln) return undefined;
  if (child(ln, "noFill")) return null;
  const color = resolveColor(child(ln, "solidFill"), { ...ctx.color, placeholder: phColor ?? ctx.color.placeholder });
  const w = numAttr(ln, "w");
  if (!color && w === undefined) return undefined;
  return {
    color: color ?? "#000000",
    width: w !== undefined ? Math.max(0.25, emuToPt(w)) : 0.75,
    dash: DASH[attr(child(ln, "prstDash"), "val") ?? "solid"] ?? "solid",
  };
}

export function styleRefLine(ref: XNode | undefined, ctx: SlideContext): Stroke | null | undefined {
  const idx = numAttr(ref, "idx");
  if (!ref || !idx) return undefined;
  const refColor = resolveColor(ref, ctx.color);
  const ln = ctx.theme.lineStyles[idx - 1];
  const parsed = parseLine(ln, ctx, refColor);
  if (parsed) return parsed;
  return refColor ? { color: refColor, width: 0.75, dash: "solid" } : undefined;
}

/** Background of a slide/layout/master: <p:bg> with bgPr or bgRef. */
export async function parseBackground(root: XNode | undefined, ctx: SlideContext): Promise<Fill | undefined> {
  const bg = path(root, "cSld", "bg");
  if (!bg) return undefined;
  const bgPr = child(bg, "bgPr");
  if (bgPr) return parseFill(bgPr, ctx);
  const ref = child(bg, "bgRef");
  const idx = numAttr(ref, "idx") ?? 0;
  if (idx >= 1001) return styleRefFill(ref, ctx, ctx.theme.bgFillStyles, 1001);
  if (idx > 0) return styleRefFill(ref, ctx, ctx.theme.fillStyles, 1);
  const c = resolveColor(ref, ctx.color);
  return c ? { type: "solid", color: c } : undefined;
}

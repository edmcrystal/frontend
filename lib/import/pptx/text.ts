/**
 * Text bodies: paragraphs and runs with PowerPoint's style inheritance
 * (run → paragraph → shape lstStyle → layout/master placeholder lstStyle →
 * master txStyles → presentation defaultTextStyle).
 */
import type { Bullet, Paragraph, Run } from "@/lib/deck/schema";
import { attr, boolAttr, child, children, numAttr, relAttr, type XNode } from "../xml";
import { emuToPt, pct, resolveColor } from "../color";
import { resolveFont, type SlideContext } from "./context";

/** One inheritance level: the lvlNpPr nodes of a list style (lstStyle / titleStyle / bodyStyle…). */
export type StyleSource = XNode | undefined;

export type TextDefaults = {
  /** List styles from most to least specific. */
  sources: StyleSource[];
  /** Text color from the shape's p:style fontRef, used before list-style colors. */
  styleColor?: string;
  /** Font from the shape's p:style fontRef. */
  styleFont?: string;
  /** normAutofit fontScale (1 = none). */
  fontScale?: number;
  lnSpcReduction?: number;
};

const ALIGN: Record<string, Paragraph["align"]> = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify", justLow: "justify" };

const AUTONUM: Record<string, Extract<Bullet, { type: "number" }>["format"]> = {
  arabicPeriod: "arabic-period",
  arabicParenR: "arabic-paren",
  arabicParenBoth: "arabic-paren",
  arabicPlain: "arabic-period",
  alphaLcPeriod: "alpha-lower",
  alphaLcParenR: "alpha-lower",
  alphaLcParenBoth: "alpha-lower",
  alphaUcPeriod: "alpha-upper",
  alphaUcParenR: "alpha-upper",
  alphaUcParenBoth: "alpha-upper",
  romanLcPeriod: "roman-lower",
  romanLcParenR: "roman-lower",
  romanUcPeriod: "roman-upper",
  romanUcParenR: "roman-upper",
};

/** Symbol-font bullet characters → Unicode look-alikes. */
const SYMBOL_BULLETS: Record<string, string> = { "§": "▪", "Ø": "➢", "ü": "✓", q: "❑", v: "❖", n: "■", l: "●", o: "○", "\uF0A7": "▪", "\uF0B7": "•", "\uF0D8": "➢", "\uF0FC": "✓", "Ÿ": "•", "Ü": "➔", "à": "➔" };

const DEFAULT_SIZE = 18;

function levelNode(source: StyleSource, level: number): XNode | undefined {
  return child(source, `lvl${level + 1}pPr`);
}

/** First defined value of `get` over the paragraph's pPr and then each source's level node. */
function inherit<T>(pPr: XNode | undefined, level: number, d: TextDefaults, get: (n: XNode) => T | undefined): T | undefined {
  if (pPr) {
    const v = get(pPr);
    if (v !== undefined) return v;
  }
  for (const s of d.sources) {
    const n = levelNode(s, level);
    if (!n) continue;
    const v = get(n);
    if (v !== undefined) return v;
  }
  return undefined;
}

type RunStyle = Omit<Run, "text">;

function runStyle(rPr: XNode | undefined, pPr: XNode | undefined, level: number, d: TextDefaults, ctx: SlideContext, rels: Map<string, string>): RunStyle {
  const chain: (XNode | undefined)[] = [rPr, child(pPr, "defRPr"), ...d.sources.map((s) => child(levelNode(s, level), "defRPr"))];
  const first = <T>(get: (n: XNode) => T | undefined, from = chain): T | undefined => {
    for (const n of from) {
      if (!n) continue;
      const v = get(n);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const sz = first((n) => numAttr(n, "sz"));
  const size = ((sz ?? DEFAULT_SIZE * 100) / 100) * (d.fontScale ?? 1);
  const latin = first((n) => attr(child(n, "latin"), "typeface"));
  // Explicit run/paragraph color beats the shape style color, which beats list-style defaults.
  const ownColor = first((n) => resolveColor(child(n, "solidFill") ?? child(child(n, "gradFill"), "gsLst")?.children[0], ctx.color), chain.slice(0, 2));
  const inherited = first((n) => resolveColor(child(n, "solidFill"), ctx.color), chain.slice(2));
  const color = ownColor ?? d.styleColor ?? inherited ?? ctx.color.scheme[ctx.color.map.tx1] ?? "#000000";
  const u = first((n) => attr(n, "u"));
  const strike = first((n) => attr(n, "strike"));
  const style: RunStyle = {
    font: resolveFont(latin, ctx.theme) ?? d.styleFont ?? ctx.theme.minorFont,
    size: Math.round(size * 100) / 100,
    color,
  };
  if (first((n) => boolAttr(n, "b"))) style.bold = true;
  if (first((n) => boolAttr(n, "i"))) style.italic = true;
  if (u && u !== "none") style.underline = true;
  if (strike && strike !== "noStrike") style.strike = true;
  const hl = resolveColor(child(rPr, "highlight"), ctx.color);
  if (hl) style.highlight = hl;
  const spc = numAttr(rPr, "spc");
  if (spc) style.letterSpacing = spc / 100;
  const link = rels.get(relAttr(child(rPr, "hlinkClick"), "id") ?? "");
  if (link) style.link = link;
  return style;
}

function parseBullet(pPr: XNode | undefined, level: number, d: TextDefaults, ctx: SlideContext): Bullet | undefined {
  const kind = inherit(pPr, level, d, (n) => {
    for (const c of n.children) if (c.name === "buNone" || c.name === "buChar" || c.name === "buAutoNum" || c.name === "buBlip") return c;
    return undefined;
  });
  if (!kind || kind.name === "buNone") return undefined;
  if (kind.name === "buAutoNum") {
    return { type: "number", format: AUTONUM[attr(kind, "type") ?? ""] ?? "arabic-period", startAt: numAttr(kind, "startAt") ?? 1 };
  }
  let char = kind.name === "buBlip" ? "•" : (attr(kind, "char") ?? "•");
  const font = inherit(pPr, level, d, (n) => attr(child(n, "buFont"), "typeface"));
  if (font && /wingdings|symbol/i.test(font)) char = SYMBOL_BULLETS[char] ?? "•";
  const color = resolveColor(inherit(pPr, level, d, (n) => child(n, "buClr")), ctx.color);
  return color ? { type: "char", char, color } : { type: "char", char };
}

function spacing(node: XNode | undefined, size: number): number | undefined {
  if (!node) return undefined;
  const pts = numAttr(child(node, "spcPts"), "val");
  if (pts !== undefined) return pts / 100;
  const p = numAttr(child(node, "spcPct"), "val");
  if (p !== undefined) return pct(p) * size * 1.2;
  return undefined;
}

/** Converts a:p elements into paragraphs. */
export function parseParagraphs(txBody: XNode, d: TextDefaults, ctx: SlideContext, rels: Map<string, string>): Paragraph[] {
  return children(txBody, "p").map((p) => {
    const pPr = child(p, "pPr");
    const level = Math.max(0, Math.min(8, numAttr(pPr, "lvl") ?? 0));
    const runs: Run[] = [];
    for (const c of p.children) {
      if (c.name === "r" || c.name === "fld") {
        const text = child(c, "t")?.text ?? "";
        runs.push({ text, ...runStyle(child(c, "rPr"), pPr, level, d, ctx, rels) });
      } else if (c.name === "br") {
        const style = runStyle(child(c, "rPr"), pPr, level, d, ctx, rels);
        runs.push({ text: "\n", ...style });
      }
    }
    // Merge adjacent runs with identical style.
    const merged: Run[] = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && JSON.stringify({ ...last, text: "" }) === JSON.stringify({ ...r, text: "" })) last.text += r.text;
      else merged.push({ ...r });
    }
    if (merged.length === 0) {
      // Keep the empty line's size from endParaRPr.
      merged.push({ text: "", ...runStyle(child(p, "endParaRPr"), pPr, level, d, ctx, rels) });
    }
    const size = merged[0].size;
    const para: Paragraph = {
      align: ALIGN[inherit(pPr, level, d, (n) => attr(n, "algn")) ?? "l"] ?? "left",
      level,
      runs: merged,
    };
    const hasText = merged.some((r) => r.text.trim());
    const bullet = hasText ? parseBullet(pPr, level, d, ctx) : undefined;
    if (bullet) para.bullet = bullet;
    const lnSpc = inherit(pPr, level, d, (n) => child(n, "lnSpc"));
    if (lnSpc) {
      const p100 = numAttr(child(lnSpc, "spcPct"), "val");
      const pts = numAttr(child(lnSpc, "spcPts"), "val");
      let lh = p100 !== undefined ? 1.2 * pct(p100) : pts !== undefined ? pts / 100 / size : undefined;
      if (lh !== undefined && d.lnSpcReduction) lh *= 1 - d.lnSpcReduction;
      if (lh !== undefined && Math.abs(lh - 1.2) > 0.01) para.lineHeight = Math.round(lh * 1000) / 1000;
    }
    const before = spacing(inherit(pPr, level, d, (n) => child(n, "spcBef")), size);
    const after = spacing(inherit(pPr, level, d, (n) => child(n, "spcAft")), size);
    if (before) para.spaceBefore = Math.round(before * 100) / 100;
    if (after) para.spaceAfter = Math.round(after * 100) / 100;
    return para;
  });
}

export function hasVisibleText(paragraphs: Paragraph[]): boolean {
  return paragraphs.some((p) => p.runs.some((r) => r.text.trim()));
}

export type BodyProps = {
  padding: [number, number, number, number];
  verticalAlign: "top" | "middle" | "bottom";
  autofit: "none" | "shrink" | "resize";
  fontScale?: number;
  lnSpcReduction?: number;
};

/** Resolves a:bodyPr over the inheritance chain (slide shape first). */
export function parseBodyProps(bodyPrs: (XNode | undefined)[]): BodyProps {
  const first = <T>(get: (n: XNode) => T | undefined): T | undefined => {
    for (const n of bodyPrs) {
      if (!n) continue;
      const v = get(n);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const ins = (name: string, def: number) => emuToPt(first((n) => numAttr(n, name)) ?? def);
  const anchor = first((n) => attr(n, "anchor"));
  const fit = first((n) => n.children.find((c) => c.name === "normAutofit" || c.name === "spAutoFit" || c.name === "noAutofit"));
  const out: BodyProps = {
    // DrawingML defaults: 0.1in left/right, 0.05in top/bottom.
    padding: [ins("tIns", 45720), ins("rIns", 91440), ins("bIns", 45720), ins("lIns", 91440)].map((v) => Math.round(v * 100) / 100) as BodyProps["padding"],
    verticalAlign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
    autofit: fit?.name === "normAutofit" ? "shrink" : fit?.name === "spAutoFit" ? "resize" : "none",
  };
  if (fit?.name === "normAutofit") {
    const fs = numAttr(fit, "fontScale");
    const ln = numAttr(fit, "lnSpcReduction");
    if (fs) out.fontScale = pct(fs);
    if (ln) out.lnSpcReduction = pct(ln);
  }
  return out;
}

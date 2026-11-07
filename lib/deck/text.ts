/**
 * Converts between the deck's Paragraph[] tree and Tiptap/ProseMirror JSON.
 * Pure (no DOM), so it is unit-tested and shared by the editor and importers.
 */
import type { Bullet, Paragraph, Run } from "./schema";

export type PMMark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
};

export type RunStyle = Omit<Run, "text">;

const STYLE_KEYS: (keyof RunStyle)[] = [
  "font",
  "size",
  "color",
  "bold",
  "italic",
  "underline",
  "strike",
  "highlight",
  "link",
  "letterSpacing",
];

export function runStyleOf(run: Run): RunStyle {
  const { text: _text, ...style } = run;
  return style;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return STYLE_KEYS.every((k) => (a[k] ?? undefined) === (b[k] ?? undefined));
}

// ---------- Paragraph[] -> ProseMirror ----------

function marksFor(run: Run): PMMark[] {
  const marks: PMMark[] = [];
  if (run.bold) marks.push({ type: "bold" });
  if (run.italic) marks.push({ type: "italic" });
  if (run.underline) marks.push({ type: "underline" });
  if (run.strike) marks.push({ type: "strike" });
  if (run.link) marks.push({ type: "link", attrs: { href: run.link } });
  const style: Record<string, unknown> = {
    fontFamily: run.font,
    fontSize: `${run.size}px`,
    color: run.color,
  };
  if (run.highlight) style.backgroundColor = run.highlight;
  if (run.letterSpacing !== undefined) style.letterSpacing = `${run.letterSpacing}px`;
  marks.push({ type: "textStyle", attrs: style });
  return marks;
}

export function paragraphsToDoc(paragraphs: Paragraph[]): PMNode {
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [{ align: "left", level: 0, runs: [] } as Paragraph]).map((p) => {
      const content: PMNode[] = [];
      for (const run of p.runs) {
        const marks = marksFor(run);
        run.text.split("\n").forEach((part, i) => {
          if (i > 0) content.push({ type: "hardBreak", marks });
          if (part) content.push({ type: "text", text: part, marks });
        });
      }
      return {
        type: "paragraph",
        attrs: {
          align: p.align,
          level: p.level,
          bullet: p.bullet ?? null,
          lineHeight: p.lineHeight ?? null,
          spaceBefore: p.spaceBefore ?? null,
          spaceAfter: p.spaceAfter ?? null,
          // Remembers the style of an empty paragraph so its line height survives a round trip.
          runDefaults: p.runs[0] ? runStyleOf(p.runs[0]) : null,
        },
        ...(content.length ? { content } : {}),
      };
    }),
  };
}

// ---------- ProseMirror -> Paragraph[] ----------

/** Normalizes CSS colors (#rgb, #rrggbb, rgb(), rgba()) to #RRGGBB(AA); null if unparseable. */
export function toHexColor(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${m[1].split("").map((c) => c + c).join("").toUpperCase()}`;
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) return `#${m[1].toUpperCase()}`;
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    let out = `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`;
    if (m[4] !== undefined) {
      const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (a < 1) out += hex(a * 255);
    }
    return out.toUpperCase();
  }
  return null;
}

function parsePx(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const n = parseFloat(v);
  // Stage px == slide pt, so "24px" and "24pt" both mean 24.
  return Number.isFinite(n) ? n : undefined;
}

function cleanFont(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

function styleFromMarks(marks: PMMark[] | undefined, fallback: RunStyle): RunStyle {
  const style: RunStyle = { font: fallback.font, size: fallback.size, color: fallback.color };
  for (const m of marks ?? []) {
    if (m.type === "bold") style.bold = true;
    else if (m.type === "italic") style.italic = true;
    else if (m.type === "underline") style.underline = true;
    else if (m.type === "strike") style.strike = true;
    else if (m.type === "link" && typeof m.attrs?.href === "string") style.link = m.attrs.href;
    else if (m.type === "textStyle") {
      const a = m.attrs ?? {};
      style.font = cleanFont(a.fontFamily) ?? style.font;
      const size = parsePx(a.fontSize);
      if (size && size > 0) style.size = size;
      style.color = toHexColor(a.color) ?? style.color;
      const hl = toHexColor(a.backgroundColor);
      if (hl) style.highlight = hl;
      const ls = parsePx(a.letterSpacing);
      if (ls !== undefined) style.letterSpacing = ls;
    }
  }
  return style;
}

const BULLET_TYPES = new Set(["char", "number"]);

function asBullet(v: unknown): Bullet | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Bullet;
  return BULLET_TYPES.has(b.type) ? b : undefined;
}

/**
 * Converts editor JSON back to paragraphs. Text without explicit styling
 * inherits `fallback` (normally the element's first run).
 */
export function docToParagraphs(doc: PMNode, fallback: RunStyle): Paragraph[] {
  return (doc.content ?? [])
    .filter((n) => n.type === "paragraph")
    .map((node) => {
      const a = node.attrs ?? {};
      const defaults = (a.runDefaults as RunStyle | null) ?? fallback;
      const runs: Run[] = [];
      const push = (text: string, style: RunStyle) => {
        const last = runs[runs.length - 1];
        if (last && sameStyle(runStyleOf(last), style)) last.text += text;
        else runs.push({ text, ...style });
      };
      for (const child of node.content ?? []) {
        if (child.type === "text" && child.text) push(child.text, styleFromMarks(child.marks, defaults));
        else if (child.type === "hardBreak") push("\n", styleFromMarks(child.marks, runs.length ? runStyleOf(runs[runs.length - 1]) : defaults));
      }
      if (runs.length === 0) runs.push({ text: "", ...defaults });
      const p: Paragraph = {
        align: (["left", "center", "right", "justify"] as const).includes(a.align as never) ? (a.align as Paragraph["align"]) : "left",
        level: typeof a.level === "number" ? Math.max(0, Math.min(8, Math.round(a.level))) : 0,
        runs,
      };
      const bullet = asBullet(a.bullet);
      if (bullet) p.bullet = bullet;
      if (typeof a.lineHeight === "number") p.lineHeight = a.lineHeight;
      if (typeof a.spaceBefore === "number") p.spaceBefore = a.spaceBefore;
      if (typeof a.spaceAfter === "number") p.spaceAfter = a.spaceAfter;
      return p;
    });
}

/** Style new text should get in an element: its first run, else the given defaults. */
export function defaultRunStyle(paragraphs: Paragraph[] | undefined, fallback: RunStyle): RunStyle {
  const first = paragraphs?.find((p) => p.runs.length)?.runs[0];
  return first ? runStyleOf(first) : fallback;
}

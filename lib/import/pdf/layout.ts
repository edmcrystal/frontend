/**
 * Pure layout analysis for PDF text: positioned text items → lines →
 * paragraphs → text boxes, with bullet and font detection. No pdf.js or DOM
 * here, so it is unit-tested directly.
 *
 * Coordinates are slide points with y pointing down.
 */
import type { Bullet, Paragraph, Run } from "@/lib/deck/schema";

export type TextItem = {
  text: string;
  /** Left edge and baseline. */
  x: number;
  baseline: number;
  width: number;
  /** Font size (em height). */
  size: number;
  /** Fraction of size above the baseline (font ascent), ~0.8 typical. */
  ascent: number;
  font: string;
  bold: boolean;
  italic: boolean;
  color: string;
};

export type Line = {
  items: TextItem[];
  x: number;
  right: number;
  baseline: number;
  size: number;
};

export type TextBlock = {
  x: number;
  y: number;
  w: number;
  h: number;
  paragraphs: Paragraph[];
  /** Mean baseline-to-baseline distance divided by size, when the block has several lines. */
  lineHeight?: number;
};

// ---------- Fonts ----------

const FAMILY_MAP: [RegExp, string][] = [
  [/^(arial|helvetica|liberationsans|arimo|nimbussans|helveticaneue)/, "Arial"],
  [/^(times|liberationserif|tinos|nimbusroman)/, "Times New Roman"],
  [/^(courier|liberationmono|cousine|nimbusmono)/, "Courier New"],
  [/^(calibri|carlito)/, "Calibri"],
  [/^(cambria|caladea)/, "Cambria"],
  [/^georgia/, "Georgia"],
  [/^verdana/, "Verdana"],
  [/^tahoma/, "Tahoma"],
  [/^trebuchet/, "Trebuchet MS"],
  [/^garamond|^ebgaramond/, "Garamond"],
  [/^segoeui/, "Segoe UI"],
  [/^dejavusans/, "Verdana"],
  [/^dejavuserif/, "Georgia"],
  [/^opensans/, "Open Sans"],
  [/^roboto/, "Roboto"],
  [/^lato/, "Lato"],
  [/^montserrat/, "Montserrat"],
  [/^sourcesans/, "Source Sans Pro"],
  [/^inter\b|^inter$/, "Inter"],
];

/**
 * Maps a PDF font name (e.g. "ABCDEF+Calibri-BoldItalic", "TimesNewRomanPSMT")
 * to a family we can render plus bold/italic flags.
 */
export function mapFontName(raw: string): { family: string; bold: boolean; italic: boolean } {
  const name = raw.replace(/^[A-Z]{6}\+/, "").trim();
  const bold = /bold|black|heavy|semibold|demi|,b$/i.test(name);
  const italic = /italic|oblique|,i$|-it$/i.test(name);
  const base = name.split(/[-,]/)[0].replace(/(PSMT|PS|MT|Std|Pro|LT)$/g, "");
  const key = base.toLowerCase().replace(/[^a-z]/g, "");
  for (const [re, family] of FAMILY_MAP) if (re.test(key)) return { family, bold, italic };
  if (/^(sans|sansserif)$/.test(key) || !key) return { family: "Arial", bold, italic };
  if (key === "serif") return { family: "Times New Roman", bold, italic };
  if (key === "monospace") return { family: "Courier New", bold, italic };
  // Unknown: de-camel-case ("OpenSansCondensed" → "Open Sans Condensed").
  return { family: base.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Arial", bold, italic };
}

// ---------- Bullets ----------

const BULLET_CHARS = new Set(["•", "▪", "■", "●", "○", "◦", "–", "—", "-", "*", "➢", "➤", "►", "▶", "✓", "✔", "❖", "◆", "♦", "·", "", ""]);
const NUMBERED = /^(\d{1,3}|[a-zA-Z]|[ivxlcIVXLC]{1,5})([.)])(\s+|$)/;

export type BulletMatch = { bullet: Bullet; rest: string };

/** Detects a leading bullet glyph or list number ("1.", "a)", "iv."). */
export function detectBullet(text: string): BulletMatch | null {
  const t = text.trimStart();
  const first = t[0];
  if (first && BULLET_CHARS.has(first) && (t.length === 1 || /\s/.test(t[1]))) {
    const char = first === "" || first === "·" ? "•" : first === "" ? "▪" : first;
    return { bullet: { type: "char", char }, rest: t.slice(1).trimStart() };
  }
  const m = NUMBERED.exec(t);
  if (m) {
    const token = m[1];
    const paren = m[2] === ")";
    let format: Extract<Bullet, { type: "number" }>["format"];
    let startAt = 1;
    if (/^\d+$/.test(token)) {
      format = paren ? "arabic-paren" : "arabic-period";
      startAt = parseInt(token, 10);
    } else if (/^[ivxlc]+$/.test(token) && token.length > 1) {
      format = "roman-lower";
    } else if (/^[IVXLC]+$/.test(token) && token.length > 1) {
      format = "roman-upper";
    } else if (/^[a-z]$/.test(token)) {
      format = "alpha-lower";
      startAt = token.charCodeAt(0) - 96;
    } else {
      format = "alpha-upper";
      startAt = token.charCodeAt(0) - 64;
    }
    // A lone capital letter followed by "." is usually an initial, not a list ("J. Smith").
    if (format === "alpha-upper" && !paren) return null;
    return { bullet: { type: "number", format, startAt: Math.max(1, startAt) }, rest: t.slice(m[0].length) };
  }
  return null;
}

// ---------- Lines ----------

/** Groups items into lines: same baseline (± 35% of size) and no large horizontal gap. */
export function groupLines(items: TextItem[]): Line[] {
  const sorted = items.filter((i) => i.text.length > 0).sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const line = lines.find(
      (l) =>
        Math.abs(l.baseline - item.baseline) <= Math.max(l.size, item.size) * 0.35 &&
        // Horizontal gap to the line (on either side) is at most ~1 em; wider gaps are columns, cells or legend entries.
        Math.max(item.x - l.right, l.x - (item.x + item.width)) <= Math.max(l.size, item.size) * 1 &&
        Math.abs(l.size - item.size) <= Math.max(l.size, item.size) * 0.45,
    );
    if (line) {
      line.items.push(item);
      line.right = Math.max(line.right, item.x + item.width);
      line.x = Math.min(line.x, item.x);
      line.size = Math.max(line.size, item.size);
    } else {
      lines.push({ items: [item], x: item.x, right: item.x + item.width, baseline: item.baseline, size: item.size });
    }
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
}

/** Line text with spaces inserted where items are visibly apart. */
export function lineRuns(line: Line): Run[] {
  const runs: Run[] = [];
  let prev: TextItem | undefined;
  for (const it of line.items) {
    let text = it.text;
    if (prev) {
      const gap = it.x - (prev.x + prev.width);
      const needsSpace = gap > Math.min(prev.size, it.size) * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(text);
      if (needsSpace) text = " " + text;
    }
    const style = { font: it.font, size: Math.round(it.size * 10) / 10, color: it.color, ...(it.bold ? { bold: true } : {}), ...(it.italic ? { italic: true } : {}) };
    const last = runs[runs.length - 1];
    if (last && last.font === style.font && last.size === style.size && last.color === style.color && !!last.bold === !!style.bold && !!last.italic === !!style.italic) last.text += text;
    else runs.push({ text, ...style });
    prev = it;
  }
  return runs;
}

const lineText = (l: Line) => lineRuns(l).map((r) => r.text).join("");
const top = (l: Line) => l.baseline - l.size * Math.min(0.85, l.items[0]?.ascent ?? 0.8);

// ---------- Blocks ----------

/**
 * Groups lines into text boxes. A line joins the box above when it's close
 * vertically (gap under ~0.9 em), similar in size and overlaps horizontally;
 * side-by-side columns therefore become separate boxes.
 */
export function groupBlocks(lines: Line[], pageWidth: number): TextBlock[] {
  type Open = { lines: Line[]; x: number; right: number };
  const blocks: Open[] = [];
  for (const line of lines) {
    const bullet = detectBullet(lineText(line));
    const candidates = blocks.filter((b) => {
      const last = b.lines[b.lines.length - 1];
      const em = Math.max(last.size, line.size);
      // Next line of the same text: baseline 0.5–1.9 em below (wider spacing = table rows, separate labels).
      const delta = line.baseline - last.baseline;
      const sizeOk = Math.abs(last.size - line.size) <= em * 0.3 || !!bullet;
      const overlap = Math.min(b.right, line.right) - Math.max(b.x, line.x);
      const leftAligned = Math.abs(line.x - b.x) < em * 0.75;
      const centered = Math.abs((line.x + line.right) / 2 - (b.x + b.right) / 2) < em * 0.75;
      const indented = !!bullet && line.x >= b.x - em * 0.5 && line.x < b.x + em * 6;
      return delta > em * 0.5 && delta < em * 1.9 && sizeOk && overlap > 0 && (leftAligned || centered || indented);
    });
    const block = candidates.sort((a, b) => b.lines[b.lines.length - 1].baseline - a.lines[a.lines.length - 1].baseline)[0];
    if (block) {
      block.lines.push(line);
      block.x = Math.min(block.x, line.x);
      block.right = Math.max(block.right, line.right);
    } else blocks.push({ lines: [line], x: line.x, right: line.right });
  }
  return blocks.map((b) => buildBlock(b.lines, b.x, b.right, pageWidth));
}

function alignmentOf(lines: Line[], x: number, right: number, pageWidth: number): Paragraph["align"] {
  const tol = Math.max(2, lines[0].size * 0.3);
  if (lines.length === 1) {
    const l = lines[0];
    const mid = (l.x + l.right) / 2;
    // A lone line centred on the page (and not starting near the left margin) is centred text.
    return Math.abs(mid - pageWidth / 2) < pageWidth * 0.02 && l.x > pageWidth * 0.15 ? "center" : "left";
  }
  const lefts = lines.every((l) => Math.abs(l.x - x) < tol);
  if (lefts) return "left";
  const rights = lines.every((l) => Math.abs(l.right - right) < tol);
  const centers = lines.every((l) => Math.abs((l.x + l.right) / 2 - (x + right) / 2) < tol);
  if (centers) return "center";
  if (rights) return "right";
  return "left";
}

function buildBlock(lines: Line[], x: number, right: number, pageWidth: number): TextBlock {
  const align = alignmentOf(lines, x, right, pageWidth);
  const paragraphs: Paragraph[] = [];
  let lastLine: Line | undefined;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push((lines[i].baseline - lines[i - 1].baseline) / lines[i - 1].size);
  // Lower median: with few lines, a single paragraph gap mustn't become the "normal" spacing.
  const typicalGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor((gaps.length - 1) / 2)] : 1.2;
  const minBulletX = Math.min(...lines.filter((l) => detectBullet(lineText(l))).map((l) => l.x), Infinity);

  for (const line of lines) {
    const runs = lineRuns(line);
    const text = runs.map((r) => r.text).join("");
    const match = detectBullet(text);
    const gap = lastLine ? (line.baseline - lastLine.baseline) / lastLine.size : 0;
    const prev = paragraphs[paragraphs.length - 1];
    const newPara = !prev || !!match || gap > typicalGap * 1.35 || (lastLine && lastLine.right < right - lastLine.size * 6 && align === "left");
    if (match) {
      // Strip the marker from the runs.
      let toStrip = text.length - match.rest.length;
      while (toStrip > 0 && runs.length) {
        const r = runs[0];
        if (r.text.length <= toStrip) {
          toStrip -= r.text.length;
          runs.shift();
        } else {
          r.text = r.text.slice(toStrip);
          toStrip = 0;
        }
      }
      if (runs[0]) runs[0].text = runs[0].text.trimStart();
    }
    if (newPara || !prev) {
      const para: Paragraph = { align, level: 0, runs: runs.length ? runs : [{ text: "", font: line.items[0].font, size: line.size, color: line.items[0].color }] };
      if (match) {
        para.bullet = match.bullet;
        para.level = Math.max(0, Math.min(8, Math.round((line.x - (Number.isFinite(minBulletX) ? minBulletX : x)) / 22)));
      } else if (paragraphs.some((p) => p.bullet) && line.x > x + line.size) {
        // Unbulleted line indented under a bullet: continuation of the list item.
        if (prev) {
          appendRuns(prev, runs);
          lastLine = line;
          continue;
        }
      }
      if (lastLine && gap > typicalGap * 1.35) para.spaceBefore = Math.round((gap - typicalGap) * lastLine.size * 10) / 10;
      paragraphs.push(para);
    } else {
      appendRuns(prev, runs);
    }
    lastLine = line;
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  const y = top(first);
  const bottom = last.baseline + last.size * 0.25;
  const block: TextBlock = { x, y, w: right - x, h: bottom - y, paragraphs };
  if (lines.length > 1 && Number.isFinite(typicalGap) && Math.abs(typicalGap - 1.2) > 0.05) block.lineHeight = Math.round(typicalGap * 1000) / 1000;
  return block;
}

function appendRuns(p: Paragraph, runs: Run[]) {
  const last = p.runs[p.runs.length - 1];
  if (last && runs[0] && !/\s$/.test(last.text) && !/^\s/.test(runs[0].text)) {
    // Re-joining a hyphenated or wrapped line.
    if (last.text.endsWith("-") && /^[a-z]/.test(runs[0].text)) last.text = last.text.slice(0, -1);
    else runs[0] = { ...runs[0], text: " " + runs[0].text };
  }
  for (const r of runs) {
    const prev = p.runs[p.runs.length - 1];
    if (prev && prev.font === r.font && prev.size === r.size && prev.color === r.color && !!prev.bold === !!r.bold && !!prev.italic === !!r.italic) prev.text += r.text;
    else p.runs.push(r);
  }
}

// ---------- Pixels ----------

export type RGBA = Uint8ClampedArray;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** Median color of a 1–3 px ring around a box (the local background). */
export function ringColor(px: RGBA, width: number, height: number, box: { x: number; y: number; w: number; h: number }, ring = 3): [number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const x0 = Math.max(0, Math.floor(box.x) - ring);
  const y0 = Math.max(0, Math.floor(box.y) - ring);
  const x1 = Math.min(width - 1, Math.ceil(box.x + box.w) + ring);
  const y1 = Math.min(height - 1, Math.ceil(box.y + box.h) + ring);
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    rs.push(px[i]);
    gs.push(px[i + 1]);
    bs.push(px[i + 2]);
  };
  for (let x = x0; x <= x1; x++) {
    push(x, y0);
    push(x, y1);
  }
  for (let y = y0 + 1; y < y1; y++) {
    push(x0, y);
    push(x1, y);
  }
  return [median(rs), median(gs), median(bs)];
}

/**
 * Text color inside a box: the median of pixels clearly different from the
 * local background (anti-aliased edge pixels are excluded by the threshold).
 */
export function inkColor(px: RGBA, width: number, height: number, box: { x: number; y: number; w: number; h: number }, bg: [number, number, number]): string | null {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const dists: number[] = [];
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w));
  const y1 = Math.min(height, Math.ceil(box.y + box.h));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
      if (d > 60) {
        rs.push(px[i]);
        gs.push(px[i + 1]);
        bs.push(px[i + 2]);
        dists.push(d);
      }
    }
  if (rs.length === 0) return null;
  // Keep the most contrasting half: glyph cores, not their blended edges.
  const cut = median(dists);
  const keep = dists.map((d, i) => (d >= cut ? i : -1)).filter((i) => i >= 0);
  return toHex(median(keep.map((i) => rs[i])), median(keep.map((i) => gs[i])), median(keep.map((i) => bs[i])));
}

/**
 * Median color along the outline of a rotated rectangle (center cx/cy, size
 * w×h in pixels, angle in degrees), grown by `ring` px: the background around
 * rotated text, without sampling the area outside the shape it sits on.
 */
export function rotatedRingColor(px: RGBA, width: number, height: number, cx: number, cy: number, w: number, h: number, angle: number, ring = 3): [number, number, number] {
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hw = w / 2 + ring;
  const hh = h / 2 + ring;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const steps = Math.max(8, Math.ceil((hw + hh) * 2));
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  for (let c = 0; c < 4; c++) {
    const [x0, y0] = corners[c];
    const [x1, y1] = corners[(c + 1) % 4];
    for (let i = 0; i < steps / 4; i++) {
      const t = i / (steps / 4);
      const lx = x0 + (x1 - x0) * t;
      const ly = y0 + (y1 - y0) * t;
      const x = Math.round(cx + lx * cos - ly * sin);
      const y = Math.round(cy + lx * sin + ly * cos);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const k = (y * width + x) * 4;
      rs.push(px[k]);
      gs.push(px[k + 1]);
      bs.push(px[k + 2]);
    }
  }
  return [median(rs), median(gs), median(bs)];
}

/** Paints boxes with their surrounding background color: a cheap inpaint that lifts text off the page image. */
export function eraseBoxes(px: RGBA, width: number, height: number, boxes: { x: number; y: number; w: number; h: number }[], dilate = 2) {
  // Sample every ring first, so erasing one box doesn't affect a neighbour's sample.
  const fills = boxes.map((b) => ringColor(px, width, height, { x: b.x - dilate, y: b.y - dilate, w: b.w + dilate * 2, h: b.h + dilate * 2 }));
  boxes.forEach((b, k) => {
    const [r, g, bl] = fills[k];
    const x0 = Math.max(0, Math.floor(b.x - dilate));
    const y0 = Math.max(0, Math.floor(b.y - dilate));
    const x1 = Math.min(width, Math.ceil(b.x + b.w + dilate));
    const y1 = Math.min(height, Math.ceil(b.y + b.h + dilate));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = bl;
        px[i + 3] = 255;
      }
  });
}

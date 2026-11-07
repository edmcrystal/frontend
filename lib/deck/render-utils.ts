import type { Bullet, Deck, Fill, Paragraph, PresetShape } from "./schema";

/** Converts a Fill into a CSS `background` value. */
export function fillToCss(fill: Fill | undefined, assets: Deck["assets"]): string {
  if (!fill) return "transparent";
  switch (fill.type) {
    case "none":
      return "transparent";
    case "solid":
      return fill.color;
    case "linear-gradient":
      return `linear-gradient(${fill.angle}deg, ${fill.stops
        .map((s) => `${s.color} ${Math.round(s.offset * 1000) / 10}%`)
        .join(", ")})`;
    case "image": {
      const url = assets[fill.assetId]?.url;
      if (!url) return "transparent";
      const size = fill.fit === "stretch" ? "100% 100%" : fill.fit;
      return `center / ${size} no-repeat url(${JSON.stringify(url)})`;
    }
  }
}

/**
 * CSS gradient angle (0deg = to top, clockwise) → SVG objectBoundingBox
 * endpoints for <linearGradient x1 y1 x2 y2>.
 */
export function gradientVector(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a) / 2;
  const dy = -Math.cos(a) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

/** SVG path data for a preset shape filling a w×h box. */
export function presetPath(preset: PresetShape, w: number, h: number): string {
  switch (preset) {
    case "rect":
      return `M0 0H${w}V${h}H0Z`;
    case "round-rect": {
      const r = Math.min(w, h) * 0.1;
      return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
    }
    case "ellipse": {
      const rx = w / 2;
      const ry = h / 2;
      return `M0 ${ry}A${rx} ${ry} 0 1 0 ${w} ${ry}A${rx} ${ry} 0 1 0 0 ${ry}Z`;
    }
    case "triangle":
      return `M${w / 2} 0L${w} ${h}H0Z`;
    case "diamond":
      return `M${w / 2} 0L${w} ${h / 2}L${w / 2} ${h}L0 ${h / 2}Z`;
    case "chevron": {
      const t = Math.min(w / 2, h / 2);
      return `M0 0H${w - t}L${w} ${h / 2}L${w - t} ${h}H0L${t} ${h / 2}Z`;
    }
    case "arrow-right": {
      const head = Math.min(w * 0.4, h);
      const shaft = h * 0.25;
      return `M0 ${shaft}H${w - head}V0L${w} ${h / 2}L${w - head} ${h}V${h - shaft}H0Z`;
    }
    case "line":
      return `M0 0L${w} ${h}`;
  }
}

export function strokeDashArray(dash: string, width: number): string | undefined {
  switch (dash) {
    case "dash":
      return `${width * 4} ${width * 3}`;
    case "dot":
      return `${width} ${width * 2}`;
    case "dash-dot":
      return `${width * 4} ${width * 2} ${width} ${width * 2}`;
    default:
      return undefined;
  }
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

function toAlpha(n: number): string {
  let out = "";
  while (n > 0) {
    n--;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function formatNumber(format: Extract<Bullet, { type: "number" }>["format"], n: number): string {
  switch (format) {
    case "arabic-period": return `${n}.`;
    case "arabic-paren": return `${n})`;
    case "alpha-lower": return `${toAlpha(n)}.`;
    case "alpha-upper": return `${toAlpha(n).toUpperCase()}.`;
    case "roman-lower": return `${toRoman(n)}.`;
    case "roman-upper": return `${toRoman(n).toUpperCase()}.`;
  }
}

/**
 * Computes the visible bullet label for every paragraph. Numbered bullets
 * count up across consecutive numbered paragraphs at the same level
 * (deeper levels don't break the sequence), as PowerPoint does.
 */
export function bulletLabels(paragraphs: Paragraph[]): (string | null)[] {
  const counters = new Map<number, number>();
  return paragraphs.map((p) => {
    const b = p.bullet;
    // A paragraph resets numbering for its own level and every deeper one.
    for (const lvl of [...counters.keys()]) if (lvl > p.level) counters.delete(lvl);
    if (!b) {
      counters.delete(p.level);
      return null;
    }
    if (b.type === "char") {
      counters.delete(p.level);
      return b.char;
    }
    const n = counters.has(p.level) ? counters.get(p.level)! + 1 : b.startAt;
    counters.set(p.level, n);
    return formatNumber(b.format, n);
  });
}

/** Encodes icon markup as a data-URI SVG (rendered via <img>, so scripts never run). */
export function iconDataUri(svg: string, viewBox: number[], color: string): string {
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(" ")}" style="color:${color}">${svg}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`;
}

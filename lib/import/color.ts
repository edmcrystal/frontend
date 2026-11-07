/** DrawingML color resolution: srgb/scheme/sys/preset/hsl/scrgb colors plus modifiers. */
import { attr, children, numAttr, type XNode } from "./xml";

export const EMU_PER_PT = 12700;
export const emuToPt = (emu: number) => emu / EMU_PER_PT;
/** DrawingML angles are in 60000ths of a degree. */
export const angleToDeg = (a: number) => a / 60000;
/** DrawingML percentages are in 1000ths of a percent (100000 = 100%). */
export const pct = (v: number) => v / 100000;

/** Theme color slots (clrScheme), as #RRGGBB. */
export type ColorScheme = Record<string, string>;

/** Maps logical names (bg1, tx1, …) to scheme slots (lt1, dk1, …); from p:clrMap. */
export type ColorMap = Record<string, string>;

export const DEFAULT_COLOR_MAP: ColorMap = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

export type ColorContext = {
  scheme: ColorScheme;
  map: ColorMap;
  /** Color substituted for schemeClr "phClr" (style references). */
  placeholder?: string;
};

const PRESET: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00",
  gray: "808080", grey: "808080", darkGray: "A9A9A9", lightGray: "D3D3D3", orange: "FFA500", purple: "800080",
  navy: "000080", teal: "008080", silver: "C0C0C0", maroon: "800000", cyan: "00FFFF", magenta: "FF00FF",
};

type RGB = { r: number; g: number; b: number };

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
}

function rgbToHex({ r, g, b }: RGB, alpha = 1): string {
  const h = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${alpha < 1 ? h(alpha) : ""}`.toUpperCase();
}

function rgbToHsl({ r, g, b }: RGB) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): RGB {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3) };
}

/** Applies DrawingML color modifiers (lumMod, lumOff, tint, shade, satMod, alpha, …) in document order. */
export function applyModifiers(hex: string, mods: XNode[]): string {
  let rgb = hexToRgb(hex);
  let alpha = 1;
  for (const m of mods) {
    const v = numAttr(m, "val");
    const p = v !== undefined ? pct(v) : 0;
    switch (m.name) {
      case "alpha":
        alpha = clamp(p);
        break;
      case "alphaMod":
        alpha = clamp(alpha * p);
        break;
      case "alphaOff":
        alpha = clamp(alpha + p);
        break;
      case "lumMod":
      case "lumOff":
      case "satMod":
      case "satOff":
      case "hueOff": {
        if (v === undefined) break;
        const hsl = rgbToHsl(rgb);
        if (m.name === "lumMod") hsl.l = clamp(hsl.l * p);
        if (m.name === "lumOff") hsl.l = clamp(hsl.l + p);
        if (m.name === "satMod") hsl.s = clamp(hsl.s * p);
        if (m.name === "satOff") hsl.s = clamp(hsl.s + p);
        if (m.name === "hueOff") hsl.h = (((hsl.h + v / 60000 / 360) % 1) + 1) % 1;
        rgb = hslToRgb(hsl);
        break;
      }
      case "tint": // toward white
        if (v === undefined) break;
        rgb = { r: rgb.r + (1 - rgb.r) * (1 - p), g: rgb.g + (1 - rgb.g) * (1 - p), b: rgb.b + (1 - rgb.b) * (1 - p) };
        break;
      case "shade": // toward black
        if (v === undefined) break;
        rgb = { r: rgb.r * p, g: rgb.g * p, b: rgb.b * p };
        break;
      case "comp": {
        const hsl = rgbToHsl(rgb);
        hsl.h = (hsl.h + 0.5) % 1;
        rgb = hslToRgb(hsl);
        break;
      }
      case "inv":
        rgb = { r: 1 - rgb.r, g: 1 - rgb.g, b: 1 - rgb.b };
        break;
      case "gray": {
        const y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
        rgb = { r: y, g: y, b: y };
        break;
      }
    }
  }
  return rgbToHex(rgb, alpha);
}

const COLOR_ELEMENTS = new Set(["srgbClr", "schemeClr", "sysClr", "prstClr", "hslClr", "scrgbClr"]);

/** Resolves a color element (e.g. <a:srgbClr>) to #RRGGBB(AA). */
export function resolveColorElement(el: XNode, ctx: ColorContext): string | undefined {
  let base: string | undefined;
  switch (el.name) {
    case "srgbClr":
      base = attr(el, "val");
      break;
    case "sysClr":
      base = attr(el, "lastClr") ?? (attr(el, "val") === "window" ? "FFFFFF" : "000000");
      break;
    case "prstClr":
      base = PRESET[attr(el, "val") ?? ""] ?? "000000";
      break;
    case "scrgbClr":
      base = rgbToHex({ r: pct(numAttr(el, "r") ?? 0), g: pct(numAttr(el, "g") ?? 0), b: pct(numAttr(el, "b") ?? 0) }).slice(1);
      break;
    case "hslClr":
      base = rgbToHex(
        hslToRgb({ h: (numAttr(el, "hue") ?? 0) / 60000 / 360, s: pct(numAttr(el, "sat") ?? 0), l: pct(numAttr(el, "lum") ?? 0) }),
      ).slice(1);
      break;
    case "schemeClr": {
      const name = attr(el, "val") ?? "";
      if (name === "phClr") base = ctx.placeholder?.replace("#", "").slice(0, 6);
      else {
        const slot = ctx.map[name] ?? name;
        base = ctx.scheme[slot]?.replace("#", "");
      }
      break;
    }
  }
  if (!base || !/^[0-9a-fA-F]{6}$/.test(base)) return undefined;
  return applyModifiers(`#${base}`, children(el));
}

/** Resolves a color element itself, or the first color child of a fill-like node (solidFill, fgClr, …). */
export function resolveColor(node: XNode | undefined, ctx: ColorContext): string | undefined {
  if (!node) return undefined;
  if (COLOR_ELEMENTS.has(node.name)) return resolveColorElement(node, ctx);
  const el = node.children.find((c) => COLOR_ELEMENTS.has(c.name));
  return el ? resolveColorElement(el, ctx) : undefined;
}

/** Parses a theme's <a:clrScheme>. */
export function parseColorScheme(clrScheme: XNode | undefined): ColorScheme {
  const scheme: ColorScheme = {};
  for (const slot of children(clrScheme)) {
    const c = slot.children[0];
    if (!c) continue;
    const hex =
      c.name === "srgbClr"
        ? attr(c, "val")
        : c.name === "sysClr"
          ? (attr(c, "lastClr") ?? (attr(c, "val") === "window" ? "FFFFFF" : "000000"))
          : undefined;
    if (hex) scheme[slot.name] = `#${hex.toUpperCase()}`;
  }
  return scheme;
}

/** Parses <p:clrMap bg1="lt1" …/> (or clrMapOvr's overrideClrMapping). */
export function parseColorMap(node: XNode | undefined): ColorMap {
  const map: ColorMap = { ...DEFAULT_COLOR_MAP };
  if (!node) return map;
  for (const [k, v] of Object.entries(node.attrs)) if (k in DEFAULT_COLOR_MAP) map[k] = v;
  return map;
}

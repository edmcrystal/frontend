import type { Frame } from "./schema";

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/** Resize handles: sx/sy say which edge moves (-1 = left/top, 1 = right/bottom, 0 = none). */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Record<Handle, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
};

export const MIN_SIZE = 4;

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotate(p: Point, deg: number): Point {
  const a = rad(deg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function center(f: Box): Point {
  return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
}

/** Axis-aligned bounding box of a (possibly rotated) frame. */
export function aabb(f: Frame): Box {
  if (!f.rotation) return { x: f.x, y: f.y, w: f.w, h: f.h };
  const c = center(f);
  const corners = [
    { x: -f.w / 2, y: -f.h / 2 },
    { x: f.w / 2, y: -f.h / 2 },
    { x: f.w / 2, y: f.h / 2 },
    { x: -f.w / 2, y: f.h / 2 },
  ].map((p) => {
    const r = rotate(p, f.rotation);
    return { x: c.x + r.x, y: c.y + r.y };
  });
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b - y };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeBox(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export type ResizeOptions = {
  /** Keep the original aspect ratio. */
  keepRatio?: boolean;
  /** Resize symmetrically around the center (Alt). */
  fromCenter?: boolean;
  minSize?: number;
};

/**
 * Resizes a rotated frame by dragging a handle by (dx, dy) in slide space.
 * The opposite edge/corner stays fixed in slide space (or the center, with fromCenter).
 */
export function resizeFrame(f: Frame, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Frame {
  const { sx, sy } = HANDLES[handle];
  const min = opts.minSize ?? MIN_SIZE;
  const k = opts.fromCenter ? 2 : 1;
  // Pointer delta in the element's own (unrotated) axes.
  const d = rotate({ x: dx, y: dy }, -f.rotation);

  let w = sx ? f.w + sx * d.x * k : f.w;
  let h = sy ? f.h + sy * d.y * k : f.h;

  if (opts.keepRatio && f.w > 0 && f.h > 0) {
    const ratio = f.w / f.h;
    if (sx && sy) {
      // Corner: follow whichever axis moved proportionally more.
      if (Math.abs(w / f.w) >= Math.abs(h / f.h)) h = w / ratio;
      else w = h * ratio;
    } else if (sx) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
  }

  w = Math.max(min, w);
  h = Math.max(min, h);

  const c0 = center(f);
  let c1: Point;
  if (opts.fromCenter) {
    c1 = c0;
  } else {
    // Anchor = the point opposite the handle, in local coords relative to the center.
    // Edge handles anchor the middle of the opposite edge, so with keepRatio the
    // perpendicular axis grows symmetrically.
    const a0 = { x: (-sx * f.w) / 2, y: (-sy * f.h) / 2 };
    const a1 = { x: (-sx * w) / 2, y: (-sy * h) / 2 };
    const anchorWorld = rotate(a0, f.rotation);
    const a1World = rotate(a1, f.rotation);
    c1 = { x: c0.x + anchorWorld.x - a1World.x, y: c0.y + anchorWorld.y - a1World.y };
  }
  return { x: c1.x - w / 2, y: c1.y - h / 2, w, h, rotation: f.rotation };
}

/** Angle in degrees (0 = handle straight above the center, clockwise) for a pointer at p. */
export function rotationFromPointer(c: Point, p: Point, snap: boolean): number {
  let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
  if (snap) deg = Math.round(deg / 15) * 15;
  else {
    // Gentle magnetism to right angles.
    const nearest = Math.round(deg / 90) * 90;
    if (Math.abs(deg - nearest) < 3) deg = nearest;
  }
  return normalizeAngle(deg);
}

export function normalizeAngle(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
}

// ---------- Snapping ----------

export type Guide = { axis: "x" | "y"; pos: number };

/**
 * Snaps a moving box to target lines (slide edges/center and other elements'
 * edges/centers). Returns the correction to apply and the guides to draw.
 */
export function snapBox(
  box: Box,
  targets: { x: number[]; y: number[] },
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  const best = (mine: number[], theirs: number[]) => {
    let delta = 0;
    let dist = threshold + 1;
    for (const m of mine)
      for (const t of theirs) {
        const d = t - m;
        if (Math.abs(d) < dist) {
          dist = Math.abs(d);
          delta = d;
        }
      }
    return dist <= threshold ? delta : null;
  };
  const dx = best(xs, targets.x);
  const dy = best(ys, targets.y);
  const guides: Guide[] = [];
  const eps = 0.01;
  if (dx !== null) for (const m of xs) if (targets.x.some((t) => Math.abs(t - (m + dx)) < eps)) guides.push({ axis: "x", pos: m + dx });
  if (dy !== null) for (const m of ys) if (targets.y.some((t) => Math.abs(t - (m + dy)) < eps)) guides.push({ axis: "y", pos: m + dy });
  return { dx: dx ?? 0, dy: dy ?? 0, guides };
}

export function snapTargets(slideSize: { width: number; height: number }, others: Box[]) {
  const x = [0, slideSize.width / 2, slideSize.width];
  const y = [0, slideSize.height / 2, slideSize.height];
  for (const b of others) {
    x.push(b.x, b.x + b.w / 2, b.x + b.w);
    y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function roundFrame(f: Frame): Frame {
  return { x: round2(f.x), y: round2(f.y), w: round2(f.w), h: round2(f.h), rotation: round2(f.rotation) };
}

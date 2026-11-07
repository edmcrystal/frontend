/**
 * Pure editing commands. Each takes an immer draft of the Deck and mutates it;
 * the store wraps them in `commit` so every command is one undo step.
 */
import { current, isDraft, type Draft } from "immer";
import type { Deck, Element, Fill, Frame, GroupElement, Paragraph, Run, Slide } from "./schema";
import { aabb, center, rotate, unionBoxes } from "./geometry";

type D = Draft<Deck>;
type DElement = Draft<Element>;

export function newId(prefix = "el"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}`;
}

// ---------- Lookup ----------

export function getSlide<T extends Deck | D>(deck: T, slideId: string): T["slides"][number] {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) throw new Error(`Slide ${slideId} not found`);
  return slide as T["slides"][number];
}

type Located<E> = { el: E; list: E[]; index: number; parent: GroupElement | null };

/** Finds an element anywhere in a slide (including inside groups). */
export function locate<E extends Element | DElement>(elements: E[], id: string, parent: GroupElement | null = null): Located<E> | null {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.id === id) return { el, list: elements, index: i, parent };
    if (el.type === "group") {
      const hit = locate(el.children as E[], id, el as GroupElement);
      if (hit) return hit;
    }
  }
  return null;
}

export function findElement(slide: Slide, id: string): Element | null {
  return locate(slide.elements, id)?.el ?? null;
}

/** Ids that are top-level on the slide, in z-order. */
function topLevel(slide: Draft<Slide>, ids: string[]): DElement[] {
  const set = new Set(ids);
  return slide.elements.filter((e) => set.has(e.id));
}

/** Deep copy that also works on immer drafts. */
export function deepClone<T>(value: T): T {
  return structuredClone(isDraft(value) ? current(value) : value);
}

export function cloneWithNewIds<E extends Element>(el: E): E {
  const copy = deepClone(el) as Element;
  const walk = (e: Element) => {
    e.id = newId(e.type);
    if (e.type === "group") e.children.forEach(walk);
  };
  walk(copy);
  return copy as E;
}

// ---------- Element commands ----------

export function setFrames(deck: D, slideId: string, frames: Record<string, Frame>) {
  const slide = getSlide(deck, slideId);
  for (const [id, frame] of Object.entries(frames)) {
    const hit = locate(slide.elements, id);
    if (hit) hit.el.frame = frame;
  }
}

/** Shallow-merges `patch` into an element. */
export function updateElement(deck: D, slideId: string, id: string, patch: Partial<Element>) {
  const hit = locate(getSlide(deck, slideId).elements, id);
  if (hit) Object.assign(hit.el, patch);
}

export function insertElements(deck: D, slideId: string, elements: Element[], index?: number): string[] {
  const slide = getSlide(deck, slideId);
  slide.elements.splice(index ?? slide.elements.length, 0, ...(elements as DElement[]));
  return elements.map((e) => e.id);
}

export function deleteElements(deck: D, slideId: string, ids: string[]) {
  const slide = getSlide(deck, slideId);
  for (const id of ids) {
    const hit = locate(slide.elements, id);
    if (hit) hit.list.splice(hit.index, 1);
  }
}

export function duplicateElements(deck: D, slideId: string, ids: string[], offset = 16): string[] {
  const slide = getSlide(deck, slideId);
  const sources = topLevel(slide, ids);
  const copies = sources.map((src) => {
    const copy = cloneWithNewIds(src as Element);
    copy.frame = { ...copy.frame, x: copy.frame.x + offset, y: copy.frame.y + offset };
    return copy;
  });
  slide.elements.push(...(copies as DElement[]));
  return copies.map((c) => c.id);
}

export type ReorderMode = "forward" | "backward" | "front" | "back";

export function reorderElements(deck: D, slideId: string, ids: string[], mode: ReorderMode) {
  const slide = getSlide(deck, slideId);
  const set = new Set(ids);
  const els = slide.elements;
  if (mode === "front" || mode === "back") {
    const moving = els.filter((e) => set.has(e.id));
    const rest = els.filter((e) => !set.has(e.id));
    slide.elements = mode === "front" ? [...rest, ...moving] : [...moving, ...rest];
    return;
  }
  if (mode === "forward") {
    for (let i = els.length - 2; i >= 0; i--)
      if (set.has(els[i].id) && !set.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
  } else {
    for (let i = 1; i < els.length; i++)
      if (set.has(els[i].id) && !set.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
  }
}

/** Groups top-level elements; children frames become relative to the group. Returns the group id. */
export function groupElements(deck: D, slideId: string, ids: string[]): string | null {
  const slide = getSlide(deck, slideId);
  const members = topLevel(slide, ids);
  if (members.length < 2) return null;
  const box = unionBoxes(members.map((m) => aabb(m.frame)))!;
  const insertAt = Math.max(...members.map((m) => slide.elements.indexOf(m))) - members.length + 1;
  const children = members.map((m) => {
    const copy = deepClone(m) as Element;
    copy.frame = { ...copy.frame, x: copy.frame.x - box.x, y: copy.frame.y - box.y };
    return copy;
  });
  const group: GroupElement = {
    id: newId("group"),
    type: "group",
    frame: { ...box, rotation: 0 },
    children,
  };
  const set = new Set(ids);
  slide.elements = slide.elements.filter((e) => !set.has(e.id));
  slide.elements.splice(insertAt, 0, group as DElement);
  return group.id;
}

/** Ungroups top-level groups back into slide space, honouring group rotation. Returns child ids. */
export function ungroupElements(deck: D, slideId: string, ids: string[]): string[] {
  const slide = getSlide(deck, slideId);
  const out: string[] = [];
  for (const id of ids) {
    const index = slide.elements.findIndex((e) => e.id === id);
    const group = slide.elements[index];
    if (!group || group.type !== "group") continue;
    const g = group.frame;
    const gc = center(g);
    const children = (group.children as Element[]).map((child) => {
      const copy = deepClone(child) as Element;
      const local = { x: child.frame.x + child.frame.w / 2 - g.w / 2, y: child.frame.y + child.frame.h / 2 - g.h / 2 };
      const r = rotate(local, g.rotation);
      copy.frame = {
        x: gc.x + r.x - child.frame.w / 2,
        y: gc.y + r.y - child.frame.h / 2,
        w: child.frame.w,
        h: child.frame.h,
        rotation: child.frame.rotation + g.rotation,
      };
      if (group.opacity !== undefined) copy.opacity = (copy.opacity ?? 1) * group.opacity;
      return copy;
    });
    slide.elements.splice(index, 1, ...(children as DElement[]));
    out.push(...children.map((c) => c.id));
  }
  return out;
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/**
 * Aligns top-level elements. A single element aligns to the slide; several
 * align to their combined bounds.
 */
export function alignElements(deck: D, slideId: string, ids: string[], mode: AlignMode) {
  const slide = getSlide(deck, slideId);
  const members = topLevel(slide, ids);
  if (members.length === 0) return;
  const ref =
    members.length === 1
      ? { x: 0, y: 0, w: deck.size.width, h: deck.size.height }
      : unionBoxes(members.map((m) => aabb(m.frame)))!;
  for (const m of members) {
    const b = aabb(m.frame);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = ref.x - b.x;
    if (mode === "hcenter") dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    if (mode === "right") dx = ref.x + ref.w - (b.x + b.w);
    if (mode === "top") dy = ref.y - b.y;
    if (mode === "vcenter") dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    if (mode === "bottom") dy = ref.y + ref.h - (b.y + b.h);
    m.frame.x += dx;
    m.frame.y += dy;
  }
}

/** Spaces 3+ elements evenly between the outermost two. */
export function distributeElements(deck: D, slideId: string, ids: string[], axis: "x" | "y") {
  const members = topLevel(getSlide(deck, slideId), ids);
  if (members.length < 3) return;
  const withBox = members.map((m) => ({ m, b: aabb(m.frame) }));
  const pos = (b: { x: number; y: number }) => (axis === "x" ? b.x : b.y);
  const size = (b: { w: number; h: number }) => (axis === "x" ? b.w : b.h);
  withBox.sort((a, b) => pos(a.b) - pos(b.b));
  const first = withBox[0].b;
  const last = withBox[withBox.length - 1].b;
  const span = pos(last) + size(last) - pos(first);
  const total = withBox.reduce((s, x) => s + size(x.b), 0);
  const gap = (span - total) / (withBox.length - 1);
  let cursor = pos(first);
  for (const { m, b } of withBox) {
    const delta = cursor - pos(b);
    if (axis === "x") m.frame.x += delta;
    else m.frame.y += delta;
    cursor += size(b) + gap;
  }
}

// ---------- Text formatting (whole element) ----------

type RunPatch = Partial<Omit<Run, "text">>;
type ParagraphPatch = Partial<Omit<Paragraph, "runs">>;

function paragraphsOf(el: DElement): Draft<Paragraph>[][] {
  if (el.type === "text") return [el.paragraphs];
  if (el.type === "shape" && el.paragraphs) return [el.paragraphs];
  if (el.type === "table") return el.rows.flatMap((r) => r.cells.map((c) => c.paragraphs));
  if (el.type === "group") return el.children.flatMap((c) => paragraphsOf(c));
  return [];
}

export function hasText(el: Element): boolean {
  return paragraphsOf(el as DElement).some((ps) => ps.length > 0);
}

/** Applies run formatting to every run of the given elements (and their group children). */
export function applyRunStyle(deck: D, slideId: string, ids: string[], patch: RunPatch | ((run: Run) => RunPatch)) {
  const slide = getSlide(deck, slideId);
  for (const id of ids) {
    const hit = locate(slide.elements, id);
    if (!hit) continue;
    for (const ps of paragraphsOf(hit.el))
      for (const p of ps)
        for (const r of p.runs) Object.assign(r, typeof patch === "function" ? patch(r as Run) : patch);
  }
}

export function applyParagraphStyle(deck: D, slideId: string, ids: string[], patch: ParagraphPatch) {
  const slide = getSlide(deck, slideId);
  for (const id of ids) {
    const hit = locate(slide.elements, id);
    if (!hit) continue;
    for (const ps of paragraphsOf(hit.el)) for (const p of ps) Object.assign(p, patch);
  }
}

export function setParagraphs(deck: D, slideId: string, id: string, paragraphs: Paragraph[]) {
  const hit = locate(getSlide(deck, slideId).elements, id);
  if (hit && (hit.el.type === "text" || hit.el.type === "shape")) hit.el.paragraphs = paragraphs as Draft<Paragraph>[];
}

// ---------- Slide commands ----------

export function blankSlide(deck: Deck | D): Slide {
  return { id: newId("slide"), background: { type: "solid", color: deck.theme.colors.background }, elements: [] };
}

export function addSlide(deck: D, index: number, slide?: Slide): string {
  const s = slide ?? blankSlide(deck);
  deck.slides.splice(index, 0, s as Draft<Slide>);
  return s.id;
}

export function duplicateSlide(deck: D, slideId: string): string {
  const index = deck.slides.findIndex((s) => s.id === slideId);
  const copy = deepClone(deck.slides[index]) as Slide;
  copy.id = newId("slide");
  copy.elements = copy.elements.map(cloneWithNewIds);
  deck.slides.splice(index + 1, 0, copy as Draft<Slide>);
  return copy.id;
}

/** Deletes a slide (never the last one). Returns the id of the slide to show next. */
export function deleteSlide(deck: D, slideId: string): string {
  const index = deck.slides.findIndex((s) => s.id === slideId);
  if (deck.slides.length <= 1 || index === -1) return slideId;
  deck.slides.splice(index, 1);
  return deck.slides[Math.min(index, deck.slides.length - 1)].id;
}

export function moveSlide(deck: D, from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= deck.slides.length || to >= deck.slides.length) return;
  const [s] = deck.slides.splice(from, 1);
  deck.slides.splice(to, 0, s);
}

export function setSlideBackground(deck: D, slideId: string, background: Fill) {
  getSlide(deck, slideId).background = background as Draft<Fill>;
}

export function setSlideNotes(deck: D, slideId: string, notes: string) {
  getSlide(deck, slideId).notes = notes || undefined;
}

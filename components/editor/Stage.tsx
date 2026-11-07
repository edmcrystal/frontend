"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Deck, Element, Frame, Slide } from "@/lib/deck/schema";
import { useEditor } from "@/lib/deck/store";
import { locate, setFrames } from "@/lib/deck/commands";
import {
  aabb,
  boxesIntersect,
  center,
  normalizeBox,
  resizeFrame,
  rotationFromPointer,
  roundFrame,
  snapBox,
  snapTargets,
  unionBoxes,
  HANDLES,
  type Box,
  type Guide,
  type Handle,
  type Point,
} from "@/lib/deck/geometry";
import { SlideView } from "./renderers/SlideView";
import { TextEditor } from "./TextEditor";
import styles from "./Stage.module.css";

const DRAG_THRESHOLD = 3; // screen px before a press becomes a drag
const SNAP_PX = 6; // screen px

type Gesture =
  | { kind: "move"; key: string; start: Point; startClient: Point; frames: Record<string, Frame>; started: boolean; clickedId: string; wasSelected: boolean; shift: boolean }
  | { kind: "resize"; key: string; start: Point; id: string; frame: Frame; handle: Handle; keepRatioDefault: boolean }
  | { kind: "rotate"; key: string; id: string; frame: Frame }
  | { kind: "marquee"; start: Point; base: string[] };

let gestureSeq = 0;

function isTextual(el: Element | null | undefined): el is Extract<Element, { type: "text" | "shape" }> {
  return !!el && (el.type === "text" || (el.type === "shape" && !("preset" in el.geometry && el.geometry.preset === "line")));
}

/** Interactive slide canvas: selection, move/resize/rotate with snapping, marquee, in-place text editing. */
export function Stage({ deck, slide }: { deck: Deck; slide: Slide }) {
  const selection = useEditor((s) => s.selection);
  const editingId = useEditor((s) => s.editingId);
  const review = useEditor((s) => s.review);
  const { select, setEditing, commit } = useEditor.getState();

  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const caret = useRef<Point | null>(null);
  const [scale, setScale] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);

  // Fit the slide to the available area.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const fit = () => {
      const pad = 56;
      setScale(Math.max(0.1, Math.min((node.clientWidth - pad) / deck.size.width, (node.clientHeight - pad) / deck.size.height)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    return () => ro.disconnect();
  }, [deck.size.width, deck.size.height]);

  const toSlide = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = layerRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
    },
    [scale],
  );

  const topLevel = (id: string) => slide.elements.find((e) => e.id === id);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !layerRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-text-editor]")) return; // let the text editor handle it
    const p = toSlide(e.clientX, e.clientY);
    const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle;

    if (handle && selection.length === 1) {
      const el = topLevel(selection[0]);
      if (!el || el.locked) return;
      if (handle === "rotate") {
        gesture.current = { kind: "rotate", key: `rotate-${++gestureSeq}`, id: el.id, frame: el.frame };
      } else {
        gesture.current = {
          kind: "resize",
          key: `resize-${++gestureSeq}`,
          start: p,
          id: el.id,
          frame: el.frame,
          handle: handle as Handle,
          keepRatioDefault: el.type === "image" || el.type === "icon" || el.type === "group",
        };
      }
    } else {
      const hit = target.closest<HTMLElement>('[data-depth="0"]')?.dataset.elementId;
      if (editingId && editingId !== hit) setEditing(null);
      if (hit) {
        const wasSelected = selection.includes(hit);
        let next = selection;
        if (e.shiftKey || e.metaKey || e.ctrlKey) next = wasSelected ? selection.filter((id) => id !== hit) : [...selection, hit];
        else if (!wasSelected) next = [hit];
        select(next);
        const frames: Record<string, Frame> = {};
        for (const id of next) {
          const el = topLevel(id);
          if (el && !el.locked) frames[id] = el.frame;
        }
        gesture.current = {
          kind: "move",
          key: `move-${++gestureSeq}`,
          start: p,
          startClient: { x: e.clientX, y: e.clientY },
          frames,
          started: false,
          clickedId: hit,
          wasSelected,
          shift: e.shiftKey || e.metaKey || e.ctrlKey,
        };
      } else {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (!additive) select([]);
        gesture.current = { kind: "marquee", start: p, base: additive ? selection : [] };
      }
    }
    containerRef.current?.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = toSlide(e.clientX, e.clientY);

    if (g.kind === "move") {
      if (!g.started) {
        if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return;
        if (Object.keys(g.frames).length === 0) return;
        g.started = true;
      }
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      const moving = new Set(Object.keys(g.frames));
      let found: Guide[] = [];
      if (!e.altKey) {
        const box = unionBoxes(Object.values(g.frames).map(aabb))!;
        const others = slide.elements.filter((el) => !moving.has(el.id) && !el.hidden).map((el) => aabb(el.frame));
        const snap = snapBox({ ...box, x: box.x + dx, y: box.y + dy }, snapTargets(deck.size, others), SNAP_PX / scale);
        dx += snap.dx;
        dy += snap.dy;
        found = snap.guides;
      }
      const next: Record<string, Frame> = {};
      for (const [id, f] of Object.entries(g.frames)) next[id] = roundFrame({ ...f, x: f.x + dx, y: f.y + dy });
      commit((d) => setFrames(d, slide.id, next), { key: g.key });
      setGuides(found);
    } else if (g.kind === "resize") {
      const corner = HANDLES[g.handle].sx !== 0 && HANDLES[g.handle].sy !== 0;
      const keepRatio = corner ? g.keepRatioDefault !== e.shiftKey : e.shiftKey;
      const f = resizeFrame(g.frame, g.handle, p.x - g.start.x, p.y - g.start.y, { keepRatio, fromCenter: e.altKey });
      commit((d) => setFrames(d, slide.id, { [g.id]: roundFrame(f) }), { key: g.key });
    } else if (g.kind === "rotate") {
      const rotation = rotationFromPointer(center(g.frame), p, e.shiftKey);
      commit((d) => setFrames(d, slide.id, { [g.id]: roundFrame({ ...g.frame, rotation }) }), { key: g.key });
    } else if (g.kind === "marquee") {
      const box = normalizeBox(g.start, p);
      setMarquee(box);
      const hits = slide.elements.filter((el) => !el.hidden && boxesIntersect(aabb(el.frame), box)).map((el) => el.id);
      select([...g.base, ...hits.filter((id) => !g.base.includes(id))]);
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    setGuides([]);
    setMarquee(null);
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    // A plain click on an already-selected element narrows a multi-selection to it.
    if (g?.kind === "move" && !g.started && g.wasSelected && !g.shift && selection.length > 1) select([g.clickedId]);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // Pointer capture retargets the event to the stage, so hit-test at the pointer instead.
    const hits = document.elementsFromPoint(e.clientX, e.clientY);
    if (hits.some((h) => h.closest("[data-text-editor]"))) return;
    // Deepest element under the pointer, so text inside groups is editable directly.
    const id = hits.map((h) => h.closest<HTMLElement>("[data-element-id]")).find(Boolean)?.dataset.elementId;
    if (!id) return;
    const el = locate(slide.elements, id)?.el;
    if (!isTextual(el) || el.locked) return;
    caret.current = { x: e.clientX, y: e.clientY };
    setEditing(id);
  };

  const renderTextEditor = (el: Element) =>
    isTextual(el) ? <TextEditor key={el.id} el={el} slideId={slide.id} theme={deck.theme} caret={caret.current} /> : null;

  // Reset the caret hint once an editing session has started.
  useEffect(() => {
    if (!editingId) caret.current = null;
  }, [editingId]);

  const selectedTop = selection.map(topLevel).filter((el): el is Element => !!el);
  const single = selectedTop.length === 1 && !editingId ? selectedTop[0] : null;
  const multiBox = selectedTop.length > 1 ? unionBoxes(selectedTop.map((el) => aabb(el.frame))) : null;
  const inv = scale ? 1 / scale : 1;

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      data-testid="stage"
    >
      {scale > 0 && (
        <div className={styles.canvas}>
          <SlideView
            deck={deck}
            slide={slide}
            scale={scale}
            review={review}
            stageRef={layerRef}
            editingId={editingId}
            renderTextEditor={renderTextEditor}
          >
            <div className={styles.overlay} style={{ ["--inv" as string]: inv }}>
              {selectedTop.map((el) => (
                <div
                  key={el.id}
                  className={el.id === single?.id ? styles.selectionBox : styles.selectionOutline}
                  data-locked={el.locked ? "true" : undefined}
                  style={{
                    left: el.frame.x,
                    top: el.frame.y,
                    width: el.frame.w,
                    height: el.frame.h,
                    transform: el.frame.rotation ? `rotate(${el.frame.rotation}deg)` : undefined,
                  }}
                >
                  {el.id === single?.id && !el.locked && (
                    <>
                      {(Object.keys(HANDLES) as Handle[]).map((h) => (
                        <div key={h} data-handle={h} className={`${styles.handle} ${styles[`h_${h}`]}`} />
                      ))}
                      <div data-handle="rotate" className={styles.rotate} title="Rotate (Shift: 15° steps)" />
                    </>
                  )}
                </div>
              ))}
              {multiBox && (
                <div className={styles.multiBox} style={{ left: multiBox.x, top: multiBox.y, width: multiBox.w, height: multiBox.h }} />
              )}
              {guides.map((g, i) => (
                <div
                  key={i}
                  className={styles.guide}
                  style={g.axis === "x" ? { left: g.pos, top: 0, height: deck.size.height } : { top: g.pos, left: 0, width: deck.size.width }}
                  data-axis={g.axis}
                />
              ))}
              {marquee && (
                <div className={styles.marquee} style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
              )}
            </div>
          </SlideView>
        </div>
      )}
    </div>
  );
}

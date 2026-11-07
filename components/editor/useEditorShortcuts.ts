"use client";

import { useEffect } from "react";
import { useEditor } from "@/lib/deck/store";
import {
  deleteElements,
  duplicateElements,
  groupElements,
  insertElements,
  locate,
  reorderElements,
  setFrames,
  ungroupElements,
} from "@/lib/deck/commands";
import { deserializeElements, serializeElements } from "@/lib/deck/clipboard";
import { createImage, createTextBox, imageFileToAsset, paragraph } from "@/lib/deck/factories";
import type { Element } from "@/lib/deck/schema";

/** True when the event comes from somewhere the user types (inputs, the text editor). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(target.type);
}

let pasteCount = 0;

/** Selected top-level elements of the current slide, in z-order. */
function selectedElements(): Element[] {
  const { deck, slideId, selection } = useEditor.getState();
  const slide = deck?.slides.find((s) => s.id === slideId);
  if (!slide) return [];
  return selection.map((id) => locate(slide.elements, id)?.el).filter((e): e is Element => !!e);
}

export function useEditorShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useEditor.getState();
      const { deck, slideId, selection, commit } = s;
      if (!deck || !slideId) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod && key === "z") return run(() => (e.shiftKey ? s.redo() : s.undo()));
      if (mod && key === "y") return run(s.redo);
      if (mod && key === "a") {
        const slide = deck.slides.find((x) => x.id === slideId)!;
        return run(() => s.select(slide.elements.filter((el) => !el.hidden).map((el) => el.id)));
      }
      if (e.key === "Escape") return run(() => s.select([]));
      if (selection.length === 0) return;

      if (e.key === "Delete" || e.key === "Backspace") return run(() => commit((d) => deleteElements(d, slideId, selection)));
      if (mod && key === "d") return run(() => s.select(commit((d) => duplicateElements(d, slideId, selection))));
      if (mod && key === "g" && !e.shiftKey) {
        return run(() => {
          const id = commit((d) => groupElements(d, slideId, selection));
          if (id) s.select([id]);
        });
      }
      if (mod && key === "g" && e.shiftKey) return run(() => s.select(commit((d) => ungroupElements(d, slideId, selection))));
      if (mod && (e.key === "]" || e.key === "}")) return run(() => commit((d) => reorderElements(d, slideId, selection, e.shiftKey ? "front" : "forward")));
      if (mod && (e.key === "[" || e.key === "{")) return run(() => commit((d) => reorderElements(d, slideId, selection, e.shiftKey ? "back" : "backward")));
      if (e.key === "Enter" && selection.length === 1) {
        const el = selectedElements()[0];
        if (el && (el.type === "text" || el.type === "shape") && !el.locked) return run(() => s.setEditing(el.id));
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key]) {
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = arrows[e.key];
        return run(() => {
          const frames = Object.fromEntries(
            selectedElements()
              .filter((el) => !el.locked)
              .map((el) => [el.id, { ...el.frame, x: el.frame.x + dx * step, y: el.frame.y + dy * step }]),
          );
          commit((d) => setFrames(d, slideId, frames), { key: "nudge" });
        });
      }
    };

    const onCopy = (e: ClipboardEvent, cut = false) => {
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      const { deck, slideId, selection, commit } = useEditor.getState();
      const els = selectedElements();
      if (!deck || !slideId || els.length === 0) return;
      e.clipboardData?.setData("text/plain", serializeElements(els, deck));
      e.preventDefault();
      pasteCount = 0;
      if (cut) commit((d) => deleteElements(d, slideId, selection));
    };

    const onPaste = async (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      const s = useEditor.getState();
      const { deck, slideId, commit } = s;
      if (!deck || !slideId || !e.clipboardData) return;
      const text = e.clipboardData.getData("text/plain");
      const ours = deserializeElements(text, 16 * ++pasteCount);
      if (ours) {
        e.preventDefault();
        const ids = commit((d) => {
          for (const [id, asset] of Object.entries(ours.assets)) if (!d.assets[id]) d.assets[id] = asset;
          return insertElements(d, slideId, ours.elements);
        });
        s.select(ids);
        return;
      }
      const image = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
      if (image) {
        e.preventDefault();
        const asset = await imageFileToAsset(image);
        const el = createImage(useEditor.getState().deck!, asset);
        const ids = commit((d) => {
          d.assets[asset.id] = asset;
          return insertElements(d, slideId, [el]);
        });
        s.select(ids);
        return;
      }
      if (text.trim()) {
        e.preventDefault();
        const box = createTextBox(deck);
        box.paragraphs = text.split(/\r?\n/).map((line) => paragraph(deck, line, 20));
        box.frame.h = Math.min(deck.size.height - 40, 30 * box.paragraphs.length + 20);
        box.frame.y = Math.max(20, (deck.size.height - box.frame.h) / 2);
        s.select(commit((d) => insertElements(d, slideId, [box])));
      }
    };

    const copy = (e: ClipboardEvent) => onCopy(e);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => void onPaste(e);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", paste);
    };
  }, []);
}

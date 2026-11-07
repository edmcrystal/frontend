/**
 * Editor state. The deck is immutable (immer), so history is a stack of deck
 * snapshots: structural sharing makes each one cheap, and undo/redo is just
 * swapping references.
 */
import { create } from "zustand";
import { produce, type Draft } from "immer";
import type { Editor } from "@tiptap/core";
import type { Deck } from "./schema";
import { locate } from "./commands";

export const HISTORY_LIMIT = 200;
/** Commits with the same key within this window merge into one undo step (drags, typing in inputs). */
export const COALESCE_MS = 1000;

export type EditorState = {
  deck: Deck | null;
  slideId: string | null;
  /** Selected element ids on the current slide (top-level, or a group child while editing its text). */
  selection: string[];
  /** Element whose text is being edited in place. */
  editingId: string | null;
  /** Live Tiptap editor while editing text (formatting toolbar targets it). */
  textEditor: Editor | null;
  review: boolean;
  past: Deck[];
  future: Deck[];
  lastKey: string | null;
  lastTime: number;
  /** Increments on every change; used by autosave. */
  revision: number;

  load: (deck: Deck, slideId?: string) => void;
  /**
   * Applies a command as one undo step and returns the recipe's result.
   * Pass `key` to merge consecutive commits (e.g. every pointer move of one drag).
   */
  commit: <R>(recipe: (draft: Draft<Deck>) => R, opts?: { key?: string }) => R;
  undo: () => void;
  redo: () => void;
  setSlide: (slideId: string) => void;
  select: (ids: string[]) => void;
  setEditing: (id: string | null) => void;
  setTextEditor: (editor: Editor | null) => void;
  setReview: (on: boolean) => void;
};

function validSelection(deck: Deck, slideId: string | null, ids: string[]): string[] {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return [];
  return ids.filter((id) => locate(slide.elements, id));
}

function validSlide(deck: Deck, slideId: string | null): string | null {
  return deck.slides.some((s) => s.id === slideId) ? slideId : (deck.slides[0]?.id ?? null);
}

export const useEditor = create<EditorState>()((set, get) => ({
  deck: null,
  slideId: null,
  selection: [],
  editingId: null,
  textEditor: null,
  review: false,
  past: [],
  future: [],
  lastKey: null,
  lastTime: 0,
  revision: 0,

  load: (deck, slideId) =>
    set({
      deck,
      slideId: validSlide(deck, slideId ?? null),
      selection: [],
      editingId: null,
      past: [],
      future: [],
      lastKey: null,
      lastTime: 0,
      revision: 0,
    }),

  commit: (recipe, opts) => {
    const state = get();
    if (!state.deck) throw new Error("No deck loaded");
    let result!: ReturnType<typeof recipe>;
    const next = produce(state.deck, (draft) => {
      result = recipe(draft);
    });
    if (next === state.deck) return result;
    const now = Date.now();
    const merge = !!opts?.key && opts.key === state.lastKey && now - state.lastTime < COALESCE_MS;
    set({
      deck: next,
      past: merge ? state.past : [...state.past, state.deck].slice(-HISTORY_LIMIT),
      future: [],
      lastKey: opts?.key ?? null,
      lastTime: now,
      revision: state.revision + 1,
      slideId: validSlide(next, state.slideId),
      selection: validSelection(next, state.slideId, state.selection),
    });
    return result;
  },

  undo: () => {
    const { past, future, deck, slideId, selection, revision } = get();
    if (!deck || past.length === 0) return;
    const prev = past[past.length - 1];
    const nextSlide = validSlide(prev, slideId);
    set({
      deck: prev,
      past: past.slice(0, -1),
      future: [deck, ...future],
      lastKey: null,
      editingId: null,
      slideId: nextSlide,
      selection: validSelection(prev, nextSlide, selection),
      revision: revision + 1,
    });
  },

  redo: () => {
    const { past, future, deck, slideId, selection, revision } = get();
    if (!deck || future.length === 0) return;
    const next = future[0];
    const nextSlide = validSlide(next, slideId);
    set({
      deck: next,
      past: [...past, deck],
      future: future.slice(1),
      lastKey: null,
      editingId: null,
      slideId: nextSlide,
      selection: validSelection(next, nextSlide, selection),
      revision: revision + 1,
    });
  },

  setSlide: (slideId) => set({ slideId, selection: [], editingId: null }),
  select: (ids) => {
    const { selection, editingId } = get();
    const same = ids.length === selection.length && ids.every((id, i) => id === selection[i]);
    if (same && !editingId) return;
    set({ selection: ids, editingId: editingId && ids.includes(editingId) ? editingId : null });
  },
  setEditing: (id) => set(id ? { editingId: id, selection: [id] } : { editingId: null }),
  setTextEditor: (textEditor) => set({ textEditor }),
  setReview: (review) => set({ review }),
}));

/** Convenience selectors. */
export const selectSlide = (s: EditorState) => s.deck?.slides.find((sl) => sl.id === s.slideId) ?? null;

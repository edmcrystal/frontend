"use client";

import { useEffect, useState } from "react";
import type { Deck } from "@/lib/deck/schema";
import { useEditor } from "@/lib/deck/store";
import { setSlideNotes } from "@/lib/deck/commands";
import { clearDraft, loadDraft, saveDraft } from "@/lib/deck/persistence";
import { Stage } from "./Stage";
import { Toolbar } from "./Toolbar";
import { TextToolbar } from "./TextToolbar";
import { Inspector } from "./Inspector";
import { SlideRail } from "./SlideRail";
import { useEditorShortcuts } from "./useEditorShortcuts";
import styles from "./EditorShell.module.css";
import ui from "./ui.module.css";

const AUTOSAVE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

function NotesBar() {
  const slide = useEditor((s) => s.deck?.slides.find((x) => x.id === s.slideId));
  const commit = useEditor((s) => s.commit);
  if (!slide) return null;
  return (
    <textarea
      className={styles.notes}
      aria-label="Speaker notes"
      placeholder="Speaker notes"
      value={slide.notes ?? ""}
      onChange={(e) => commit((d) => setSlideNotes(d, slide.id, e.target.value), { key: `notes-${slide.id}` })}
    />
  );
}

/** Full slide editor for one deck. `initialDeck` is the server copy; a newer local draft wins. */
export function EditorShell({ initialDeck }: { initialDeck: Deck }) {
  const deck = useEditor((s) => s.deck);
  const slideId = useEditor((s) => s.slideId);
  const revision = useEditor((s) => s.revision);
  const [restored, setRestored] = useState<number | null>(null);
  const [save, setSave] = useState<SaveState>("idle");

  // Load once per deck id: prefer an unsaved local draft.
  useEffect(() => {
    const draft = loadDraft(initialDeck.id);
    useEditor.getState().load(draft?.deck ?? initialDeck);
    setRestored(draft ? draft.savedAt : null);
  }, [initialDeck]);

  // Debounced autosave after every change.
  useEffect(() => {
    if (revision === 0) return;
    setSave("saving");
    const t = setTimeout(() => {
      const current = useEditor.getState().deck;
      if (current) setSave(saveDraft(current) ? "saved" : "error");
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [revision]);

  useEditorShortcuts();

  if (!deck || deck.id !== initialDeck.id) return <div className={styles.loading}>Loading editor…</div>;
  const slide = deck.slides.find((s) => s.id === slideId) ?? deck.slides[0];

  const discardDraft = () => {
    clearDraft(initialDeck.id);
    useEditor.getState().load(initialDeck);
    setRestored(null);
    setSave("idle");
  };

  const status =
    save === "saving" ? "Saving…" : save === "saved" ? "Saved in this browser" : save === "error" ? "Couldn't save locally (storage full?)" : restored ? "Restored local changes" : "";

  return (
    <div className={styles.shell}>
      <header className={styles.toolbar}>
        <Toolbar saveStatus={status} />
        <TextToolbar />
      </header>
      {restored && (
        <div className={styles.banner} role="status">
          Restored your unsaved changes from {new Date(restored).toLocaleString()}.
          <button type="button" className={ui.btn} onClick={discardDraft}>
            Discard and reload original
          </button>
          <button type="button" className={ui.btn} onClick={() => setRestored(null)}>
            Dismiss
          </button>
        </div>
      )}
      <SlideRail />
      <main className={styles.stageArea}>{slide && <Stage deck={deck} slide={slide} />}</main>
      <aside className={styles.inspector} aria-label="Properties">
        <Inspector />
      </aside>
      <footer className={styles.footer}>
        <NotesBar />
      </footer>
    </div>
  );
}

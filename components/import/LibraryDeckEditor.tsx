"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Deck } from "@/lib/deck/schema";
import { getDeck } from "@/lib/deck/library";
import { EditorShell } from "@/components/editor/EditorShell";
import styles from "./import.module.css";

type State = { kind: "loading" } | { kind: "ready"; deck: Deck } | { kind: "missing" } | { kind: "error" };

/** Opens a deck stored in this browser's library (e.g. an import) in the editor. */
export function LibraryDeckEditor({ deckId }: { deckId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getDeck(deckId)
      .then((deck) => !cancelled && setState(deck ? { kind: "ready", deck } : { kind: "missing" }))
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  if (state.kind === "ready") return <EditorShell initialDeck={state.deck} storage="library" />;

  return (
    <div className={styles.page}>
      <div className={`${styles.container} ${styles.center}`}>
        {state.kind === "loading" ? (
          <p className={styles.muted}>Loading deck…</p>
        ) : (
          <>
            <h1 className={styles.h1}>{state.kind === "missing" ? "Deck not found" : "Couldn't open this deck"}</h1>
            <p className={styles.muted}>
              {state.kind === "missing"
                ? "Imported decks are kept in the browser they were imported in. This one isn't in this browser — it may have been deleted, or imported elsewhere."
                : "Your browser's storage isn't available (private window or blocked site data?)."}
            </p>
            <div className={styles.row} style={{ justifyContent: "center" }}>
              <Link href="/decks" className={styles.button}>
                All decks
              </Link>
              <Link href="/decks/new" className={`${styles.button} ${styles.primary}`}>
                Import a file
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { deleteDeck, listDecks, type LibraryEntry } from "@/lib/deck/library";
import { listFixtureDecks } from "@/lib/deck/fixtures";
import styles from "./import.module.css";

function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

/** Lists built-in sample decks plus decks imported into this browser. */
export function DeckList() {
  const samples = listFixtureDecks();
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDecks()
      .then(setEntries)
      .catch(() => {
        setEntries([]);
        setError("Your browser's storage isn't available, so imported decks can't be listed.");
      });
  }, []);

  const remove = async (entry: LibraryEntry) => {
    if (!window.confirm(`Delete “${entry.title}” from this browser? This can't be undone.`)) return;
    await deleteDeck(entry.id);
    setEntries((prev) => prev?.filter((e) => e.id !== entry.id) ?? null);
  };

  return (
    <>
      <section className={styles.section} aria-labelledby="imported-heading">
        <h2 className={styles.sectionTitle} id="imported-heading">
          Your decks
        </h2>
        {error && <p className={styles.error}>{error}</p>}
        {entries === null ? (
          <p className={styles.muted}>Loading…</p>
        ) : entries.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.muted} style={{ marginBottom: 12 }}>
              Nothing imported yet.
            </p>
            <Link href="/decks/new" className={`${styles.button} ${styles.primary}`}>
              Import PDF or PowerPoint
            </Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {entries.map((d) => (
              <li key={d.id} className={styles.card}>
                <Link href={`/decks/${d.id}`} className={styles.cardLink}>
                  <span className={styles.cardTitle}>{d.title}</span>
                  <span className={styles.cardMeta}>
                    {d.sourceKind && <span className={styles.badge}>{d.sourceKind}</span>}
                    <span>
                      {d.slideCount} slide{d.slideCount === 1 ? "" : "s"}
                    </span>
                    <span>· edited {relativeTime(d.updatedAt)}</span>
                    {d.fileName && <span>· {d.fileName}</span>}
                  </span>
                </Link>
                <button type="button" className={`${styles.button} ${styles.danger}`} onClick={() => void remove(d)} aria-label={`Delete ${d.title}`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="samples-heading">
        <h2 className={styles.sectionTitle} id="samples-heading">
          Samples
        </h2>
        <ul className={styles.list}>
          {samples.map((d) => (
            <li key={d.id} className={styles.card}>
              <Link href={`/decks/${d.id}`} className={styles.cardLink}>
                <span className={styles.cardTitle}>{d.title}</span>
                <span className={styles.cardMeta}>
                  <span className={styles.badge}>sample</span>
                  <span>{d.slideCount} slides</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

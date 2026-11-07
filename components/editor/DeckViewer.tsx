"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Deck } from "@/lib/deck/schema";
import { SlideView } from "./renderers/SlideView";
import { LOW_CONFIDENCE } from "./renderers/ElementView";
import styles from "./DeckViewer.module.css";

const THUMB_WIDTH = 150;

function countLowConfidence(deck: Deck): number {
  let n = 0;
  const visit = (els: Deck["slides"][number]["elements"]) => {
    for (const el of els) {
      const c = el.provenance?.confidence;
      if (c !== undefined && c < LOW_CONFIDENCE) n++;
      if (el.type === "group") visit(el.children);
    }
  };
  deck.slides.forEach((s) => visit(s.elements));
  return n;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
}

/** Read-only deck viewer: slide rail, scaled stage, review overlay. Base for the editor. */
export function DeckViewer({ deck }: { deck: Deck }) {
  const [active, setActive] = useState(0);
  const [review, setReview] = useState(false);
  const [stageScale, setStageScale] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const slide = deck.slides[active];
  const lowConfidence = countLowConfidence(deck);

  // Fit the slide to the available stage area.
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const fit = () => {
      const pad = 48;
      const sx = (node.clientWidth - pad) / deck.size.width;
      const sy = (node.clientHeight - pad) / deck.size.height;
      setStageScale(Math.max(0.1, Math.min(sx, sy)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    return () => ro.disconnect();
  }, [deck.size.width, deck.size.height]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown") {
        setActive((i) => Math.min(i + 1, deck.slides.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp") {
        setActive((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.slides.length]);

  return (
    <div className={styles.shell}>
      <header className={styles.toolbar}>
        <Link href="/decks" className={styles.back}>
          ← Decks
        </Link>
        <h1 className={styles.title}>{deck.title}</h1>
        <span className={styles.counter}>
          {active + 1} / {deck.slides.length}
        </span>
        <label className={styles.review} title="Highlight elements the import was unsure about">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />
          Review{lowConfidence > 0 ? ` (${lowConfidence})` : ""}
        </label>
      </header>

      <nav className={styles.rail} aria-label="Slides">
        {deck.slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={i === active ? `${styles.thumb} ${styles.thumbActive}` : styles.thumb}
            onClick={() => setActive(i)}
            aria-current={i === active ? "true" : undefined}
            aria-label={`Slide ${i + 1}`}
          >
            <span className={styles.thumbIndex}>{i + 1}</span>
            <SlideView deck={deck} slide={s} scale={THUMB_WIDTH / deck.size.width} />
          </button>
        ))}
      </nav>

      <main className={styles.stage} ref={stageRef}>
        {slide && stageScale > 0 && (
          <div className={styles.canvas}>
            <SlideView deck={deck} slide={slide} scale={stageScale} review={review} />
          </div>
        )}
      </main>

      {slide?.notes && (
        <aside className={styles.notes}>
          <strong>Notes:</strong> {slide.notes}
        </aside>
      )}
    </div>
  );
}

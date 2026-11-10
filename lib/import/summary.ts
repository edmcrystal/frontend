/**
 * Describes what an import actually produced, so the report can be honest
 * about slides that came in as plain pictures.
 */
import type { Deck } from "@/lib/deck/schema";
import type { ImportReport } from "./types";

/**
 * 1-based numbers of slides with no editable elements whose background is a
 * picture. (A slide that is simply blank has a plain background and doesn't count.)
 */
export function pictureOnlySlides(deck: Deck): number[] {
  const out: number[] = [];
  deck.slides.forEach((s, i) => {
    if (s.elements.length === 0 && s.background.type === "image") out.push(i + 1);
  });
  return out;
}

/** [1,2,3,5,7,8] → "1–3, 5, 7–8". */
export function formatSlideRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

export type Outcome = {
  /** none: nothing editable came in; partial: some slides are pictures only; full: every slide has editable content. */
  tone: "none" | "partial" | "full";
  headline: string;
  /** One line under the headline. */
  summary: string;
  /** Longer explanation and what to do next (only when something is wrong). */
  advice?: string;
};

export function describeOutcome(report: Pick<ImportReport, "fileName" | "pictureOnlySlides">, title: string, slideCount: number): Outcome {
  const pictures = report.pictureOnlySlides;
  const slides = (n: number) => `${n} slide${n === 1 ? "" : "s"}`;
  if (slideCount > 0 && pictures.length === slideCount) {
    return {
      tone: "none",
      headline: `“${title}” came in as pictures only`,
      summary: `From ${report.fileName} · 0 of ${slides(slideCount)} have editable content.`,
      advice:
        "This file contains only images, with no text or shapes to read, so there was nothing to convert. " +
        "Turning text in images into editable text needs OCR, which the in-browser importer doesn't have yet. " +
        "You can still open the deck, reorder slides, add your own text, shapes and charts, and export it. " +
        "If you have the original PowerPoint file, or a PDF exported straight from it, import that instead.",
    };
  }
  if (pictures.length > 0) {
    return {
      tone: "partial",
      headline: `Imported “${title}”`,
      summary: `From ${report.fileName} · ${slideCount - pictures.length} of ${slides(slideCount)} have editable content.`,
      advice: `${pictures.length === 1 ? "Slide" : "Slides"} ${formatSlideRanges(pictures)} ${pictures.length === 1 ? "is" : "are"} pictures only: ${pictures.length === 1 ? "it contains" : "they contain"} no text or shapes to read.`,
    };
  }
  return { tone: "full", headline: `Imported “${title}”`, summary: `From ${report.fileName} · ${slides(slideCount)}.` };
}

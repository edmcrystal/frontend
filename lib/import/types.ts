/**
 * Importer contract. The in-browser importers (pptx.ts, pdf.ts) and the
 * planned server importer all produce a Deck plus a report, and emit the same
 * progress events, so the upload UI doesn't care which one runs.
 */
import type { Deck } from "@/lib/deck/schema";

export type ImportStage = "reading" | "parsing" | "rendering" | "assembling" | "done";

export type ImportProgress = {
  stage: ImportStage;
  /** 1-based slide/page currently being processed (0 before the first). */
  current: number;
  total: number;
  message?: string;
};

export type ImportWarning = {
  /** 1-based slide/page number, if the warning is about one. */
  slide?: number;
  message: string;
};

export type ImportReport = {
  sourceKind: "pptx" | "pdf";
  fileName: string;
  warnings: ImportWarning[];
  /** Elements created, by type, for the summary. */
  counts: Record<string, number>;
  /** 1-based numbers of slides that came in as a picture with nothing editable on them. */
  pictureOnlySlides: number[];
};

export type ImportResult = { deck: Deck; report: ImportReport };

export type ImportOptions = {
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
};

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 100;

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
}

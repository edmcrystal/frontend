"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ACCEPT_ATTRIBUTE, ACCEPTED_EXTENSIONS, ImportError, importFile, type ImportProgress, type ImportReport } from "@/lib/import";
import { putDeck } from "@/lib/deck/library";
import styles from "./import.module.css";

type State =
  | { kind: "idle" }
  | { kind: "importing"; fileName: string; progress: ImportProgress }
  | { kind: "done"; deckId: string; title: string; slideCount: number; report: ImportReport }
  | { kind: "error"; message: string };

const STAGE_LABEL: Record<ImportProgress["stage"], string> = {
  reading: "Reading file",
  parsing: "Rebuilding slides",
  rendering: "Separating text from the page",
  assembling: "Finishing up",
  done: "Done",
};

const COUNT_LABEL: Record<string, string> = {
  slide: "slides",
  text: "text boxes",
  shape: "shapes",
  image: "pictures",
  table: "tables",
  chart: "charts",
  group: "groups",
  smartart: "SmartArt graphics",
};

function ProgressView({ fileName, progress, onCancel }: { fileName: string; progress: ImportProgress; onCancel: () => void }) {
  const pctDone = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;
  return (
    <div className={styles.panel} role="status" aria-live="polite">
      <div className={styles.row} style={{ justifyContent: "space-between" }}>
        <strong>Importing {fileName}</strong>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pctDone ?? undefined}
        aria-label="Import progress"
      >
        <div className={pctDone === null ? `${styles.progressBar} ${styles.progressIndeterminate}` : styles.progressBar} style={pctDone === null ? undefined : { width: `${pctDone}%` }} />
      </div>
      <span className={styles.muted}>
        {STAGE_LABEL[progress.stage]}
        {progress.message ? ` · ${progress.message}` : ""}
      </span>
    </div>
  );
}

function ReportView({ state, onOpen, onAnother }: { state: Extract<State, { kind: "done" }>; onOpen: () => void; onAnother: () => void }) {
  const { report } = state;
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => openRef.current?.focus(), []);
  const counts = Object.entries(report.counts).filter(([k, n]) => n > 0 && COUNT_LABEL[k]);
  return (
    <div className={styles.panel}>
      <div>
        <strong style={{ fontSize: 18 }}>Imported “{state.title}”</strong>
        <p className={styles.muted}>
          From {report.fileName} · everything below is editable.
        </p>
      </div>
      {counts.length > 0 && (
        <div className={styles.counts}>
          {counts.map(([k, n]) => (
            <span key={k}>
              <strong>{n}</strong> {COUNT_LABEL[k]}
            </span>
          ))}
        </div>
      )}
      {report.warnings.length > 0 && (
        <>
          <span className={styles.muted}>Things to check:</span>
          <ul className={styles.warnings}>
            {report.warnings.map((w, i) => (
              <li key={i}>
                {w.slide ? <strong>Slide {w.slide}: </strong> : null}
                {w.message}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={styles.row}>
        <button ref={openRef} type="button" className={`${styles.button} ${styles.primary}`} onClick={onOpen}>
          Open deck
        </button>
        <button type="button" className={styles.button} onClick={onAnother}>
          Import another file
        </button>
      </div>
    </div>
  );
}

/** Drag-and-drop / file-picker import of .pptx and .pdf files into the local deck library. */
export function Uploader() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setState({ kind: "error", message: `“${file.name}” isn't a PowerPoint (.pptx) or PDF file.` });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "importing", fileName: file.name, progress: { stage: "reading", current: 0, total: 0 } });
    try {
      const { deck, report } = await importFile(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setState({ kind: "importing", fileName: file.name, progress });
        },
      });
      if (controller.signal.aborted) return;
      await putDeck(deck, { fileName: file.name });
      setState({ kind: "done", deckId: deck.id, title: deck.title, slideCount: deck.slides.length, report });
    } catch (e) {
      if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        setState({ kind: "idle" });
        return;
      }
      console.error(e);
      const message =
        e instanceof ImportError
          ? e.message
          : e instanceof DOMException && e.name === "QuotaExceededError"
            ? "Your browser ran out of storage for this deck. Free some space or try a smaller file."
            : "Something went wrong while importing this file.";
      setState({ kind: "error", message });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (state.kind === "importing") return;
    void start(e.dataTransfer.files[0]);
  };

  if (state.kind === "importing") {
    return <ProgressView fileName={state.fileName} progress={state.progress} onCancel={() => abortRef.current?.abort()} />;
  }
  if (state.kind === "done") {
    return <ReportView state={state} onOpen={() => router.push(`/decks/${state.deckId}`)} onAnother={() => setState({ kind: "idle" })} />;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        className={dragging ? `${styles.drop} ${styles.dropActive}` : styles.drop}
        role="button"
        tabIndex={0}
        aria-label="Choose a PowerPoint or PDF file to import"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="uploader"
      >
        <span className={styles.dropTitle}>Drop a PowerPoint or PDF here</span>
        <span className={styles.muted}>or click to choose a file · .pptx or .pdf, up to 50 MB</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void start(file);
          }}
        />
      </div>
      {state.kind === "error" && (
        <div className={styles.error} role="alert">
          {state.message}
        </div>
      )}
      <p className={styles.muted}>
        Files are converted in your browser and saved in this browser only. PowerPoint files keep their text, shapes, tables and charts editable. PDFs get editable text on top of
        a background image of each page; scanned PDFs need OCR, which isn&apos;t available yet.
      </p>
    </div>
  );
}

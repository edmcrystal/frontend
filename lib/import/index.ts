/**
 * Entry point for importing a file into a Deck. Runs in the browser for now;
 * a server importer can implement the same signature (and the same progress
 * events) later without changing the UI.
 */
import { ImportError, MAX_FILE_BYTES, type ImportOptions, type ImportResult } from "./types";

export * from "./types";

export const ACCEPTED_EXTENSIONS = [".pptx", ".pdf"];
export const ACCEPT_ATTRIBUTE = ".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type SourceKind = "pptx" | "pdf";

/** Sniffs the file type from its first bytes. */
export function detectKind(head: Uint8Array): SourceKind | "ppt" | null {
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf"; // %PDF
  if (head[0] === 0x50 && head[1] === 0x4b) return "pptx"; // zip container; the importer validates it
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return "ppt"; // legacy OLE
  return null;
}

export async function importFile(file: File, opts: ImportOptions = {}): Promise<ImportResult> {
  if (file.size === 0) throw new ImportError("The file is empty.");
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(`The file is ${(file.size / 1024 / 1024).toFixed(0)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  const data = await file.arrayBuffer();
  const kind = detectKind(new Uint8Array(data, 0, Math.min(8, data.byteLength)));
  if (kind === "ppt") throw new ImportError("Old .ppt files aren't supported. Open it in PowerPoint and save as .pptx, then import that.");
  if (kind === "pdf") {
    const { importPdf } = await import("./pdf");
    return importPdf(data, file.name, opts);
  }
  if (kind === "pptx") {
    const { importPptx } = await import("./pptx");
    return importPptx(data, file.name, opts);
  }
  throw new ImportError("Only PowerPoint (.pptx) and PDF files can be imported.");
}

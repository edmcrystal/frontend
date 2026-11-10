/**
 * PDF → Deck in the browser (pdf.js), Codia-style layer separation simplified:
 *  1. render the page to a canvas,
 *  2. read the text layer (positions, sizes, fonts) and sample each item's
 *     ink color from the pixels,
 *  3. erase the text from the canvas by filling each box with its
 *     surrounding color, and use the cleaned image as the slide background,
 *  4. rebuild the text as editable text boxes on top.
 * Images and vector art stay in the background image for now; scanned pages
 * (no text layer) need OCR, which belongs to the planned server importer.
 */
import type { Deck, Slide, TextElement } from "@/lib/deck/schema";
import { DeckSchema } from "@/lib/deck/schema";
import { newId } from "@/lib/deck/commands";
import { formatSlideRanges, pictureOnlySlides } from "../summary";
import { ImportError, MAX_PAGES, throwIfAborted, type ImportOptions, type ImportResult, type ImportWarning } from "../types";
import { eraseBoxes, groupBlocks, groupLines, inkColor, mapFontName, ringColor, rotatedRingColor, type TextItem } from "./layout";

const DECK_WIDTH = 960;
/** Canvas pixels per slide point (2 = retina-quality background). */
const PIXEL_RATIO = 2;
const MAX_CANVAS_WIDTH = 2400;

type PdfJs = typeof import("pdfjs-dist");
type PdfTextItem = { str: string; transform: number[]; width: number; height: number; fontName: string; hasEOL?: boolean };

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => pdfjs);
  return pdfjsPromise;
}

function makeWorker(): Worker {
  // Bundlers (webpack/Turbopack) emit the worker file for this exact pattern.
  return new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
}

function canvasFor(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ImportError("Your browser couldn't create a drawing surface for the PDF.");
  return { canvas, ctx };
}

export async function importPdf(data: ArrayBuffer | Uint8Array, fileName: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const { onProgress, signal } = opts;
  onProgress?.({ stage: "reading", current: 0, total: 0, message: "Opening PDF" });
  const pdfjs = await loadPdfJs();
  const worker = makeWorker();
  // pdf.js's typings declare `port` as null-only, but it accepts a Worker.
  const port = new pdfjs.PDFWorker({ port: worker as unknown as null });
  const warnings: ImportWarning[] = [];
  const counts: Record<string, number> = {};
  /** Pages with no text layer; summarised in one warning after the loop instead of one per page. */
  const scannedPages: number[] = [];
  const warn = (message: string, slide?: number) => {
    if (!warnings.some((w) => w.message === message && w.slide === slide)) warnings.push({ slide, message });
  };

  // pdf.js takes ownership of the buffer, so give it a copy.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  const task = pdfjs.getDocument({ data: bytes, worker: port, isEvalSupported: false });
  try {
    let doc: Awaited<typeof task.promise>;
    try {
      doc = await task.promise;
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "PasswordException") throw new ImportError("This PDF is password-protected. Remove the password and try again.");
      throw new ImportError("This file isn't a readable PDF.");
    }
    const total = Math.min(doc.numPages, MAX_PAGES);
    if (doc.numPages > MAX_PAGES) warn(`Only the first ${MAX_PAGES} of ${doc.numPages} pages were imported.`);

    const first = await doc.getPage(1);
    const firstView = first.getViewport({ scale: 1 });
    const deckHeight = Math.round((firstView.height * DECK_WIDTH) / firstView.width * 100) / 100;

    const assets: Deck["assets"] = {};
    const slides: Slide[] = [];
    const fontVotes = new Map<string, number>();
    let largestText = { size: 0, text: "" };

    for (let n = 1; n <= total; n++) {
      throwIfAborted(signal);
      onProgress?.({ stage: "rendering", current: n, total, message: `Page ${n} of ${total}` });
      const page = n === 1 ? first : await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const k = DECK_WIDTH / base.width;
      if (Math.abs(base.height * k - deckHeight) > 1) warn("Pages have different shapes; they were fitted to the first page's size.", n);
      const viewport = page.getViewport({ scale: k });
      const ratio = Math.min(PIXEL_RATIO, MAX_CANVAS_WIDTH / DECK_WIDTH);
      const renderViewport = page.getViewport({ scale: k * ratio });
      const { canvas, ctx } = canvasFor(Math.ceil(renderViewport.width), Math.ceil(renderViewport.height));
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
      throwIfAborted(signal);

      const content = await page.getTextContent();
      const styles = content.styles as Record<string, { ascent?: number; descent?: number; fontFamily?: string }>;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = image.data;

      const items: TextItem[] = [];
      const rotated: { item: TextItem; angle: number; cx: number; cy: number }[] = [];
      const eraseBoxesPx: { x: number; y: number; w: number; h: number }[] = [];
      /** Rotated text is erased with a rotated rectangle (in slide units) filled with its own ring color. */
      const eraseRotated: { cx: number; cy: number; w: number; h: number; angle: number; fill: [number, number, number] }[] = [];
      for (const raw of content.items as PdfTextItem[]) {
        if (!("str" in raw) || !raw.str || !raw.str.trim()) continue;
        const tx = pdfjs.Util.transform(viewport.transform, raw.transform);
        const size = Math.hypot(tx[2], tx[3]);
        if (size < 1) continue;
        const angle = (Math.atan2(tx[1], tx[0]) * 180) / Math.PI;
        const style = styles[raw.fontName] ?? {};
        const ascent = style.ascent && style.ascent > 0.3 && style.ascent < 1.2 ? style.ascent : 0.8;
        let fontName = style.fontFamily ?? "";
        try {
          if (page.commonObjs.has(raw.fontName)) fontName = (page.commonObjs.get(raw.fontName) as { name?: string }).name ?? fontName;
        } catch {
          // Font object not available; fall back to the CSS family.
        }
        const font = mapFontName(fontName);
        fontVotes.set(font.family, (fontVotes.get(font.family) ?? 0) + raw.str.length);
        const width = raw.width * k;
        const item: TextItem = {
          text: raw.str,
          x: tx[4],
          baseline: tx[5],
          width,
          size,
          ascent,
          font: font.family,
          bold: font.bold,
          italic: font.italic,
          color: "#000000",
        };
        if (Math.abs(angle) > 0.5) {
          const rad = (angle * Math.PI) / 180;
          // Center of the glyph box: half the advance along the baseline, ~0.3 em above it.
          const cx = item.x + (Math.cos(rad) * width) / 2 + Math.sin(rad) * size * 0.3;
          const cy = item.baseline + (Math.sin(rad) * width) / 2 - Math.cos(rad) * size * 0.3;
          const w = width + size * 0.2;
          const h = size * 1.25;
          const fill = rotatedRingColor(px, canvas.width, canvas.height, cx * ratio, cy * ratio, w * ratio, h * ratio, angle);
          const half = (Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))) / 2;
          const halfY = (Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad))) / 2;
          const aabb = { x: (cx - half) * ratio, y: (cy - halfY) * ratio, w: half * 2 * ratio, h: halfY * 2 * ratio };
          item.color = inkColor(px, canvas.width, canvas.height, aabb, fill) ?? "#000000";
          eraseRotated.push({ cx, cy, w, h, angle, fill });
          rotated.push({ item, angle, cx, cy });
        } else {
          // Pixel box of the glyphs, from the ascent line to a little below the baseline.
          const box = { x: item.x * ratio, y: (item.baseline - size * ascent) * ratio, w: width * ratio, h: size * (ascent + 0.25) * ratio };
          const bg = ringColor(px, canvas.width, canvas.height, box);
          item.color = inkColor(px, canvas.width, canvas.height, box, bg) ?? "#000000";
          eraseBoxesPx.push(box);
          items.push(item);
        }
        if (size > largestText.size && n === 1) largestText = { size, text: raw.str };
      }

      const elements: TextElement[] = [];
      for (const block of groupBlocks(groupLines(items), DECK_WIDTH)) {
        const align = block.paragraphs[0]?.align ?? "left";
        // Substituted fonts can run a little wider; give boxes slack so lines don't re-wrap.
        const slack = block.w * 0.06 + 6;
        const x = align === "center" ? block.x - slack / 2 : align === "right" ? block.x - slack : block.x;
        if (block.lineHeight) block.paragraphs.forEach((p) => (p.lineHeight = block.lineHeight));
        elements.push({
          id: newId("text"),
          type: "text",
          frame: { x: r2(x), y: r2(block.y), w: r2(block.w + slack), h: r2(block.h), rotation: 0 },
          autofit: "none",
          padding: [0, 0, 0, 0],
          verticalAlign: "top",
          paragraphs: block.paragraphs,
          provenance: { source: "native", confidence: 0.9 },
        });
      }
      for (const { item, angle, cx, cy } of rotated) {
        // Rotated text: one box per item, rotated around its own center.
        const w = item.width + item.size * 0.5;
        const h = item.size * 1.2;
        elements.push({
          id: newId("text"),
          type: "text",
          frame: { x: r2(cx - w / 2), y: r2(cy - h / 2), w: r2(w), h: r2(h), rotation: r2(angle) },
          autofit: "none",
          padding: [0, 0, 0, 0],
          verticalAlign: "middle",
          paragraphs: [{ align: "center", level: 0, runs: [{ text: item.text, font: item.font, size: r2(item.size), color: item.color, ...(item.bold ? { bold: true } : {}), ...(item.italic ? { italic: true } : {}) }] }],
          provenance: { source: "native", confidence: 0.6 },
        });
      }

      if (eraseBoxesPx.length === 0 && eraseRotated.length === 0) {
        scannedPages.push(n);
      } else {
        eraseBoxes(px, canvas.width, canvas.height, eraseBoxesPx, 2 * ratio);
        ctx.putImageData(image, 0, 0);
        for (const r of eraseRotated) {
          ctx.save();
          ctx.translate(r.cx * ratio, r.cy * ratio);
          ctx.rotate((r.angle * Math.PI) / 180);
          ctx.fillStyle = `rgb(${r.fill[0]}, ${r.fill[1]}, ${r.fill[2]})`;
          ctx.fillRect((-r.w / 2 - 2) * ratio, (-r.h / 2 - 2) * ratio, (r.w + 4) * ratio, (r.h + 4) * ratio);
          ctx.restore();
        }
      }
      const assetId = newId("asset");
      assets[assetId] = {
        id: assetId,
        kind: "image",
        url: canvas.toDataURL("image/jpeg", 0.88),
        mime: "image/jpeg",
        width: canvas.width,
        height: canvas.height,
      };
      counts.text = (counts.text ?? 0) + elements.length;
      counts.slide = (counts.slide ?? 0) + 1;
      slides.push({
        id: newId("slide"),
        background: { type: "image", assetId, fit: "stretch" },
        elements,
      });
      page.cleanup();
    }
    if (scannedPages.length > 0 && scannedPages.length < total) {
      warn(`${scannedPages.length === 1 ? "Page" : "Pages"} ${formatSlideRanges(scannedPages)} ${scannedPages.length === 1 ? "has" : "have"} no text layer (${scannedPages.length === 1 ? "it looks" : "they look"} scanned), so ${scannedPages.length === 1 ? "it was" : "they were"} imported as ${scannedPages.length === 1 ? "an image" : "images"}. Making that text editable needs OCR, which the server importer will provide.`);
    }
    if (slides.some((s) => s.elements.length)) {
      warn("Pictures and drawings stay part of each slide's background image; text was lifted off it and is editable.");
    }

    onProgress?.({ stage: "assembling", current: total, total, message: "Finishing up" });
    const meta = await doc.getMetadata().catch(() => null);
    const metaTitle = ((meta?.info as { Title?: string } | undefined)?.Title ?? "").trim();
    const body = [...fontVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Arial";
    const deck = DeckSchema.parse({
      id: newId("deck"),
      title: metaTitle || largestText.text.trim() || fileName.replace(/\.pdf$/i, ""),
      version: 1,
      size: { width: DECK_WIDTH, height: deckHeight },
      theme: {
        name: "Imported",
        colors: {
          background: "#FFFFFF",
          text: "#000000",
          accent1: "#4472C4",
          accent2: "#ED7D31",
          accent3: "#A5A5A5",
          accent4: "#FFC000",
          accent5: "#5B9BD5",
          accent6: "#70AD47",
        },
        fonts: { heading: body, body },
      },
      slides,
      assets,
      source: { kind: "pdf", fileId: fileName, pageCount: doc.numPages },
    });
    onProgress?.({ stage: "done", current: total, total });
    return { deck, report: { sourceKind: "pdf", fileName, warnings, counts, pictureOnlySlides: pictureOnlySlides(deck) } };
  } finally {
    await task.destroy().catch(() => {});
    port.destroy();
    worker.terminate();
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

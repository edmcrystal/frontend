/** Builders for new elements inserted from the editor. */
import type {
  Asset,
  ChartElement,
  Deck,
  ImageElement,
  Paragraph,
  PresetShape,
  ShapeElement,
  TableElement,
  TextElement,
} from "./schema";
import { newId } from "./commands";

type Size = { w: number; h: number };

/** Centers a box on the slide, nudged by `cascade` so repeated inserts don't stack exactly. */
function centered(deck: Deck, { w, h }: Size, cascade = 0) {
  return {
    x: Math.round((deck.size.width - w) / 2 + cascade),
    y: Math.round((deck.size.height - h) / 2 + cascade),
    w,
    h,
    rotation: 0,
  };
}

export function paragraph(deck: Deck, text: string, size = 24, extra: Partial<Paragraph> = {}): Paragraph {
  return {
    align: "left",
    level: 0,
    ...extra,
    runs: [{ text, font: deck.theme.fonts.body, size, color: deck.theme.colors.text }],
  };
}

export function createTextBox(deck: Deck, cascade = 0): TextElement {
  return {
    id: newId("text"),
    type: "text",
    frame: centered(deck, { w: 400, h: 60 }, cascade),
    autofit: "none",
    padding: [7.2, 3.6, 7.2, 3.6],
    verticalAlign: "top",
    paragraphs: [paragraph(deck, "Text", 24)],
    provenance: { source: "user" },
  };
}

export function createShape(deck: Deck, preset: PresetShape, cascade = 0): ShapeElement {
  const isLine = preset === "line";
  return {
    id: newId("shape"),
    type: "shape",
    frame: centered(deck, isLine ? { w: 240, h: 0 } : { w: 200, h: preset === "arrow-right" || preset === "chevron" ? 100 : 160 }, cascade),
    geometry: { preset },
    fill: isLine ? { type: "none" } : { type: "solid", color: deck.theme.colors.accent1 },
    stroke: isLine ? { color: deck.theme.colors.text, width: 2, dash: "solid" } : undefined,
    verticalAlign: "middle",
    provenance: { source: "user" },
  };
}

export function createImage(deck: Deck, asset: Asset, cascade = 0): ImageElement {
  const maxW = deck.size.width * 0.6;
  const maxH = deck.size.height * 0.6;
  const w0 = asset.width || 400;
  const h0 = asset.height || 300;
  const s = Math.min(1, maxW / w0, maxH / h0);
  return {
    id: newId("image"),
    type: "image",
    assetId: asset.id,
    frame: centered(deck, { w: Math.round(w0 * s), h: Math.round(h0 * s) }, cascade),
    mask: "rect",
    provenance: { source: "user" },
  };
}

export function createTable(deck: Deck, rows = 3, cols = 3, cascade = 0): TableElement {
  const colW = 120;
  const rowH = 36;
  const { accent1, text, background } = deck.theme.colors;
  const font = deck.theme.fonts.body;
  return {
    id: newId("table"),
    type: "table",
    frame: centered(deck, { w: colW * cols, h: rowH * rows }, cascade),
    columns: Array(cols).fill(colW),
    border: { color: "#D1D5DB", width: 1, dash: "solid" },
    rows: Array.from({ length: rows }, (_, r) => ({
      height: rowH,
      cells: Array.from({ length: cols }, (_, c) => ({
        fill: { type: "solid" as const, color: r === 0 ? accent1 : background },
        paragraphs: [
          {
            align: "center" as const,
            level: 0,
            runs: [{ text: r === 0 ? `Header ${c + 1}` : "", font, size: 14, bold: r === 0, color: r === 0 ? "#FFFFFF" : text }],
          },
        ],
      })),
    })),
    provenance: { source: "user" },
  };
}

export function createChart(deck: Deck, cascade = 0): ChartElement {
  return {
    id: newId("chart"),
    type: "chart",
    frame: centered(deck, { w: 480, h: 300 }, cascade),
    spec: {
      type: "column",
      categories: ["A", "B", "C", "D"],
      series: [{ name: "Series 1", values: [4, 7, 5, 9] }],
      legend: "bottom",
    },
    provenance: { source: "user" },
  };
}

/** Reads an image file into a data-URL asset (until the asset upload API exists). */
export async function imageFileToAsset(file: File): Promise<Asset> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = url;
  });
  return { id: newId("asset"), kind: "image", url, mime: file.type || "image/png", width, height };
}

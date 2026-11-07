/**
 * Copy/paste of slide elements via the system clipboard as tagged JSON,
 * so elements can move between slides, decks and browser tabs.
 */
import { z } from "zod";
import { AssetSchema, ElementSchema, type Asset, type Deck, type Element } from "./schema";
import { cloneWithNewIds } from "./commands";

const MARKER = "pptxconverter/elements@1\n";

const PayloadSchema = z.object({
  elements: z.array(ElementSchema),
  assets: z.record(z.string(), AssetSchema),
});

function assetIds(el: Element, out: Set<string>) {
  if (el.type === "image") out.add(el.assetId);
  if ((el.type === "shape" || el.type === "text") && el.fill?.type === "image") out.add(el.fill.assetId);
  if (el.type === "group") el.children.forEach((c) => assetIds(c, out));
}

export function serializeElements(elements: Element[], deck: Deck): string {
  const ids = new Set<string>();
  elements.forEach((e) => assetIds(e, ids));
  const assets: Record<string, Asset> = {};
  for (const id of ids) if (deck.assets[id]) assets[id] = deck.assets[id];
  return MARKER + JSON.stringify({ elements, assets });
}

/** Parses clipboard text; returns copies with fresh ids offset by `offset`, or null if not ours. */
export function deserializeElements(text: string, offset: number): { elements: Element[]; assets: Record<string, Asset> } | null {
  if (!text.startsWith(MARKER)) return null;
  try {
    const parsed = PayloadSchema.safeParse(JSON.parse(text.slice(MARKER.length)));
    if (!parsed.success) return null;
    const elements = parsed.data.elements.map((el) => {
      const copy = cloneWithNewIds(el);
      copy.frame = { ...copy.frame, x: copy.frame.x + offset, y: copy.frame.y + offset };
      return copy;
    });
    return { elements, assets: parsed.data.assets };
  } catch {
    return null;
  }
}

/**
 * Local draft autosave. Until the decks API (PATCH /v1/decks/{id}) exists,
 * edits are kept in localStorage per deck so a reload doesn't lose work.
 */
import { DeckSchema, type Deck } from "./schema";

const PREFIX = "pptxconverter:draft:";

export type Draft = { deck: Deck; savedAt: number };

export function loadDraft(deckId: string): Draft | null {
  try {
    const raw = localStorage.getItem(PREFIX + deckId);
    if (!raw) return null;
    const data = JSON.parse(raw) as { deck: unknown; savedAt: number };
    const parsed = DeckSchema.safeParse(data.deck);
    return parsed.success ? { deck: parsed.data, savedAt: data.savedAt } : null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refuses (quota exceeded, storage disabled). */
export function saveDraft(deck: Deck): boolean {
  try {
    localStorage.setItem(PREFIX + deck.id, JSON.stringify({ deck, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(deckId: string) {
  try {
    localStorage.removeItem(PREFIX + deckId);
  } catch {
    // ignore
  }
}

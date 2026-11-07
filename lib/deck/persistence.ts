/**
 * Autosave. Until the decks API (PATCH /v1/decks/{id}) exists:
 *  - decks that live in the local library (imports) are saved back to it;
 *  - fixture/server decks keep an unsaved-changes draft per deck.
 * Both are stored in IndexedDB (imported decks carry images as data URLs,
 * far beyond localStorage's quota).
 */
import { DeckSchema, type Deck } from "./schema";
import { deleteDraftRecord, getDraftRecord, putDeck, putDraftRecord } from "./library";

/** Drafts used to live in localStorage; read (and migrate) those once. */
const LEGACY_PREFIX = "pptxconverter:draft:";

export type Draft = { deck: Deck; savedAt: number };

function legacyDraft(deckId: string): Draft | null {
  try {
    const raw = localStorage.getItem(LEGACY_PREFIX + deckId);
    if (!raw) return null;
    localStorage.removeItem(LEGACY_PREFIX + deckId);
    const data = JSON.parse(raw) as { deck: unknown; savedAt: number };
    const parsed = DeckSchema.safeParse(data.deck);
    return parsed.success ? { deck: parsed.data, savedAt: data.savedAt } : null;
  } catch {
    return null;
  }
}

export async function loadDraft(deckId: string): Promise<Draft | null> {
  try {
    const draft = await getDraftRecord(deckId);
    if (draft) return draft;
    const legacy = legacyDraft(deckId);
    if (legacy) await putDraftRecord(legacy.deck).catch(() => {});
    return legacy;
  } catch {
    return legacyDraft(deckId);
  }
}

/** Resolves false when the browser refuses (quota exceeded, storage disabled). */
export async function saveDraft(deck: Deck): Promise<boolean> {
  try {
    await putDraftRecord(deck);
    return true;
  } catch {
    return false;
  }
}

export async function clearDraft(deckId: string): Promise<void> {
  try {
    localStorage.removeItem(LEGACY_PREFIX + deckId);
  } catch {
    // ignore
  }
  await deleteDraftRecord(deckId).catch(() => {});
}

/** Saves a library deck in place. Resolves false on failure. */
export async function saveLibraryDeck(deck: Deck): Promise<boolean> {
  try {
    await putDeck(deck);
    return true;
  } catch {
    return false;
  }
}

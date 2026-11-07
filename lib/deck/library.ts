/**
 * Local deck library in IndexedDB: imported decks (with their images as data
 * URLs, which easily exceed localStorage's ~5 MB) and autosaved drafts of
 * server/fixture decks. Stands in for the decks API until it exists.
 */
import { DeckSchema, type Deck } from "./schema";

const DB_NAME = "pptxconverter";
const DB_VERSION = 1;
const DECKS = "decks";
const META = "deckMeta";
const DRAFTS = "drafts";

export type LibraryEntry = {
  id: string;
  title: string;
  slideCount: number;
  sourceKind?: "pptx" | "pdf";
  fileName?: string;
  createdAt: number;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available in this browser."));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DECKS)) db.createObjectStore(DECKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("The deck library is open in an older tab; close it and retry."));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function parse(value: unknown): Deck | null {
  const r = DeckSchema.safeParse(value);
  return r.success ? r.data : null;
}

// ---------- Library decks ----------

export async function listDecks(): Promise<LibraryEntry[]> {
  const db = await openDb();
  const entries = await request(db.transaction(META, "readonly").objectStore(META).getAll() as IDBRequest<LibraryEntry[]>);
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDeck(id: string): Promise<Deck | null> {
  const db = await openDb();
  const rec = await request(db.transaction(DECKS, "readonly").objectStore(DECKS).get(id) as IDBRequest<{ deck: unknown } | undefined>);
  return rec ? parse(rec.deck) : null;
}

export async function hasDeck(id: string): Promise<boolean> {
  const db = await openDb();
  const key = await request(db.transaction(META, "readonly").objectStore(META).getKey(id));
  return key !== undefined;
}

/** Saves (creates or replaces) a deck in the library. */
export async function putDeck(deck: Deck, extra: { fileName?: string } = {}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([DECKS, META], "readwrite");
  const meta = tx.objectStore(META);
  const existing = await request(meta.get(deck.id) as IDBRequest<LibraryEntry | undefined>);
  const now = Date.now();
  tx.objectStore(DECKS).put({ id: deck.id, deck });
  const entry: LibraryEntry = {
    id: deck.id,
    title: deck.title,
    slideCount: deck.slides.length,
    sourceKind: deck.source?.kind,
    fileName: extra.fileName ?? existing?.fileName ?? deck.source?.fileId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  meta.put(entry);
  await done(tx);
}

export async function deleteDeck(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([DECKS, META, DRAFTS], "readwrite");
  tx.objectStore(DECKS).delete(id);
  tx.objectStore(META).delete(id);
  tx.objectStore(DRAFTS).delete(id);
  await done(tx);
}

// ---------- Drafts (unsaved edits of fixture/server decks) ----------

export async function getDraftRecord(id: string): Promise<{ deck: Deck; savedAt: number } | null> {
  const db = await openDb();
  const rec = await request(db.transaction(DRAFTS, "readonly").objectStore(DRAFTS).get(id) as IDBRequest<{ deck: unknown; savedAt: number } | undefined>);
  const deck = rec ? parse(rec.deck) : null;
  return deck && rec ? { deck, savedAt: rec.savedAt } : null;
}

export async function putDraftRecord(deck: Deck): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DRAFTS, "readwrite");
  tx.objectStore(DRAFTS).put({ id: deck.id, deck, savedAt: Date.now() });
  await done(tx);
}

export async function deleteDraftRecord(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DRAFTS, "readwrite");
  tx.objectStore(DRAFTS).delete(id);
  await done(tx);
}

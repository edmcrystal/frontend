import { EditorShell } from "@/components/editor/EditorShell";
import { LibraryDeckEditor } from "@/components/import/LibraryDeckEditor";
import { getFixtureDeck } from "@/lib/deck/fixtures";

// Sample decks are served from fixtures (edits autosave as a local draft).
// Any other id is a deck imported into this browser's library.
export default async function DeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  const deck = getFixtureDeck(deckId);
  if (deck) return <EditorShell initialDeck={deck} />;
  return <LibraryDeckEditor deckId={deckId} />;
}

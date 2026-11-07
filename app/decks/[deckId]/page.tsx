import { notFound } from "next/navigation";
import { EditorShell } from "@/components/editor/EditorShell";
import { getFixtureDeck } from "@/lib/deck/fixtures";

// Until the decks API exists, decks are served from local fixtures and edits
// autosave to the browser.
export default async function DeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  const deck = getFixtureDeck(deckId);
  if (!deck) notFound();
  return <EditorShell initialDeck={deck} />;
}

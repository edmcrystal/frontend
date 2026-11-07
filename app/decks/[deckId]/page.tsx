import { notFound } from "next/navigation";
import { DeckViewer } from "@/components/editor/DeckViewer";
import { getFixtureDeck } from "@/lib/deck/fixtures";

// Until the decks API exists, decks are served from local fixtures.
export default async function DeckPage({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  const deck = getFixtureDeck(deckId);
  if (!deck) notFound();
  return <DeckViewer deck={deck} />;
}

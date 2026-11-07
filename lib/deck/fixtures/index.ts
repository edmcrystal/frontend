import { parseDeck, type Deck } from "../schema";
import { sampleDeck } from "./sample-deck";

const fixtures = { sample: sampleDeck };

export function listFixtureDecks(): { id: string; title: string; slideCount: number }[] {
  return Object.values(fixtures).map((d) => ({ id: d.id, title: d.title, slideCount: d.slides.length }));
}

/** Returns a validated fixture deck, or null if no fixture has this id. */
export function getFixtureDeck(id: string): Deck | null {
  const input = fixtures[id as keyof typeof fixtures];
  return input ? parseDeck(input) : null;
}

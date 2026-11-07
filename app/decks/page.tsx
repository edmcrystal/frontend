import Link from "next/link";
import { listFixtureDecks } from "@/lib/deck/fixtures";

export default function DecksPage() {
  const decks = listFixtureDecks();
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 16px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 24 }}>Decks</h1>
      <ul style={{ listStyle: "none", display: "grid", gap: 12 }}>
        {decks.map((d) => (
          <li key={d.id}>
            <Link
              href={`/decks/${d.id}`}
              style={{ display: "block", padding: 16, border: "1px solid rgb(127 127 127 / 0.3)", borderRadius: 8 }}
            >
              <strong>{d.title}</strong>
              <span style={{ display: "block", opacity: 0.7, fontSize: 14, marginTop: 4 }}>{d.slideCount} slides</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

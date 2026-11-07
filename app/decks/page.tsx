import Link from "next/link";
import { DeckList } from "@/components/import/DeckList";
import styles from "@/components/import/import.module.css";

export default function DecksPage() {
  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.h1}>Decks</h1>
            <p className={styles.muted}>Turn PowerPoint and PDF files into fully editable slides.</p>
          </div>
          <Link href="/decks/new" className={`${styles.button} ${styles.primary}`}>
            Import PDF or PowerPoint
          </Link>
        </div>
        <DeckList />
      </main>
    </div>
  );
}

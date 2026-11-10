import Link from "next/link";
import { Uploader } from "@/components/import/Uploader";
import styles from "@/components/import/import.module.css";

export const metadata = { title: "Import a deck" };

export default function NewDeckPage() {
  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <Link href="/decks" className={styles.back}>
          ← All decks
        </Link>
        <div className={styles.header}>
          <div>
            <h1 className={styles.h1}>Import a deck</h1>
            <p className={styles.muted}>Text, shapes, pictures, tables and charts in the file become editable. Slides that are only images stay pictures.</p>
          </div>
        </div>
        <Uploader />
      </main>
    </div>
  );
}

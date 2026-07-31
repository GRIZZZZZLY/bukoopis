import type { NoteKind } from "./episodic-notes.js";

/**
 * A `book_notes` row (episodic-memory note) as served to the plot board.
 * See episodic-notes.ts for the extraction schema that produces these rows
 * and book-forge/apps/server/drizzle/0013_book_notes.sql for the table.
 */
export interface BookNote {
  id: number;
  bookId: number;
  kind: NoteKind;
  /** chapter_order_introduced — the note's thread starts here. */
  introduced: number;
  /** chapter_order_resolved — null while the thread is still open. */
  resolved: number | null;
  title: string;
  body: string;
  /** Parsed JSON array; [] on missing/malformed source data. */
  tags: string[];
  createdAt: string;
}

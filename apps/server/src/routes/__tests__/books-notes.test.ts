import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import Database from "better-sqlite3";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { BookNote } from "@book-forge/shared";

interface BookJson {
  id: number;
}

function dbPath(app: TestApp): string {
  return join(app.dbDir, "test.sqlite");
}

function seedNote(
  app: TestApp,
  bookId: number,
  note: {
    kind: string;
    introduced: number;
    resolved?: number | null;
    title?: string;
    body?: string;
    tags?: string | null;
  },
): number {
  const db = new Database(dbPath(app));
  try {
    db.pragma("foreign_keys = ON");
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO book_notes
         (book_id, kind, chapter_order_introduced, chapter_order_resolved, title, body, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        bookId,
        note.kind,
        note.introduced,
        note.resolved ?? null,
        note.title ?? "Заметка",
        note.body ?? "Тело заметки",
        note.tags ?? "[]",
        now,
      );
    return Number(info.lastInsertRowid);
  } finally {
    db.close();
  }
}

let t: TestApp;

// Plot board: GET /api/books/:id/notes serves book_notes (thread/foreshadow/
// arc_delta/theme/mystery) for a book. Notes are only ever written by the
// episodic-note extractor, so seed them with a raw second connection into
// makeTestApp()'s db file (same idiom as canon-extraction.test.ts).
describe("GET /api/books/:id/notes", () => {
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => {
    t.cleanup();
  });

  it("404 for a missing book", async () => {
    const res = await send(t.app, "/api/books/9999/notes", "GET");
    expect(res.status).toBe(404);
  });

  it("returns empty array when the book has no notes", async () => {
    const book = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "Книга без заметок",
    });

    const res = await send(t.app, `/api/books/${book.id}/notes`, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns notes ordered by introduced chapter, with parsed tags", async () => {
    const book = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "Книга с заметками",
    });

    // Insertion order deliberately does not match expected output order.
    seedNote(t, book.id, { kind: "mystery", introduced: 3 });
    seedNote(t, book.id, {
      kind: "thread",
      introduced: 1,
      resolved: 4,
      tags: JSON.stringify(["a", "b"]),
    });
    seedNote(t, book.id, { kind: "theme", introduced: 1 });

    const res = await send(t.app, `/api/books/${book.id}/notes`, "GET");
    expect(res.status).toBe(200);
    const notes = (await res.json()) as BookNote[];
    expect(notes.map((n) => n.introduced)).toEqual([1, 1, 3]);
    expect(notes[0]?.tags).toEqual(["a", "b"]);
    expect(notes[0]?.resolved).toBe(4);
    expect(notes[2]?.resolved).toBeNull();
  });

  it("survives malformed tags json", async () => {
    const book = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "Книга с битыми тегами",
    });
    seedNote(t, book.id, {
      kind: "arc_delta",
      introduced: 1,
      tags: "not json",
    });

    const res = await send(t.app, `/api/books/${book.id}/notes`, "GET");
    expect(res.status).toBe(200);
    const notes = (await res.json()) as BookNote[];
    expect(notes.some((n) => Array.isArray(n.tags))).toBe(true);
  });
});

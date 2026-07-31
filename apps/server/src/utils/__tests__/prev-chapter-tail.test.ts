import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { loadPreviousChapterTail } from "../rolling-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

let dbDir: string;
let sqlite: DatabaseType;

const NOW = "2026-08-01T00:00:00.000Z";

function insertBook(title = "Книга"): number {
  const info = sqlite
    .prepare(
      "INSERT INTO books (title, created_at, updated_at) VALUES (?, ?, ?)",
    )
    .run(title, NOW, NOW);
  return Number(info.lastInsertRowid);
}

/** Chapter with no committed version at all (current_version_id stays NULL). */
function insertChapterWithoutVersion(bookId: number, order: number): void {
  sqlite
    .prepare(
      `INSERT INTO chapters (book_id, order_index, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bookId, order, `Глава ${order}`, NOW, NOW);
}

function insertChapter(
  bookId: number,
  order: number,
  contentText: string,
): void {
  const ch = sqlite
    .prepare(
      `INSERT INTO chapters (book_id, order_index, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bookId, order, `Глава ${order}`, NOW, NOW);
  const chId = Number(ch.lastInsertRowid);
  const v = sqlite
    .prepare(
      `INSERT INTO chapter_versions
         (chapter_id, content_json, content_text, word_count, summary, created_at)
       VALUES (?, '{}', ?, ?, ?, ?)`,
    )
    .run(chId, contentText, 100, "саммари", NOW);
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(Number(v.lastInsertRowid), chId);
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "prev-tail-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
});

afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("loadPreviousChapterTail", () => {
  it("returns null when there is no prior chapter", () => {
    const bookId = insertBook();
    insertChapter(bookId, 1, "Текст первой главы.");

    expect(loadPreviousChapterTail(sqlite, bookId, 1)).toBeNull();
  });

  it("returns the whole text when it is shorter than the limit", () => {
    const bookId = insertBook();
    insertChapter(bookId, 1, "Он закрыл дверь и замер.");

    expect(loadPreviousChapterTail(sqlite, bookId, 2)).toBe(
      "Он закрыл дверь и замер.",
    );
  });

  it("keeps only the tail and starts it right after a paragraph break", () => {
    const bookId = insertBook();
    const text = [
      "Абзац один. ".repeat(10),
      "Абзац два. ".repeat(10),
      "Финальный абзац.",
    ].join("\n\n");
    insertChapter(bookId, 1, text);

    const tail = loadPreviousChapterTail(sqlite, bookId, 2, 60);

    expect(tail).not.toBeNull();
    expect(tail!.length).toBeLessThanOrEqual(60);
    // A suffix of the chapter, and the dropped head ends on a paragraph break —
    // so the tail never starts mid-sentence.
    expect(text.endsWith(tail!)).toBe(true);
    expect(text.slice(0, text.length - tail!.length)).toMatch(/\n\n$/);
    expect(tail).toBe("Финальный абзац.");
  });

  it("reads the immediately preceding chapter, not an earlier one", () => {
    const bookId = insertBook();
    insertChapter(bookId, 1, "Глава один.");
    insertChapter(bookId, 2, "Глава два.");

    expect(loadPreviousChapterTail(sqlite, bookId, 3)).toBe("Глава два.");
  });

  it("returns null when the preceding chapter is still empty", () => {
    const bookId = insertBook();
    insertChapter(bookId, 1, "   ");

    expect(loadPreviousChapterTail(sqlite, bookId, 2)).toBeNull();
  });

  it("returns null when the preceding chapter has no committed version", () => {
    const bookId = insertBook();
    insertChapterWithoutVersion(bookId, 1);

    expect(loadPreviousChapterTail(sqlite, bookId, 2)).toBeNull();
  });

  it("falls back to a hard cut when the tail has no paragraph break", () => {
    const bookId = insertBook();
    insertChapter(bookId, 1, `${"а".repeat(500)} последнее слово`);

    const tail = loadPreviousChapterTail(sqlite, bookId, 2, 30);

    expect(tail).toBe("последнее слово");
  });
});

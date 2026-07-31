import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  COMMIT_JOB_KINDS,
  completeMemoryJob,
  enqueueMemoryJobs,
  pendingEarlierMemoryChapters,
} from "../memory-queue.js";

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

/** Chapter + committed version. Returns both ids. */
function insertChapter(
  bookId: number,
  order: number,
): { chapterId: number; versionId: number } {
  const ch = sqlite
    .prepare(
      `INSERT INTO chapters (book_id, order_index, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bookId, order, `Глава ${order}`, NOW, NOW);
  const chapterId = Number(ch.lastInsertRowid);
  const v = sqlite
    .prepare(
      `INSERT INTO chapter_versions
         (chapter_id, content_json, content_text, word_count, summary, created_at)
       VALUES (?, '{}', ?, ?, ?, ?)`,
    )
    .run(chapterId, "текст", 100, "саммари", NOW);
  const versionId = Number(v.lastInsertRowid);
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(versionId, chapterId);
  return { chapterId, versionId };
}

function enqueueAll(
  bookId: number,
  ch: { chapterId: number; versionId: number },
): void {
  enqueueMemoryJobs(sqlite, {
    bookId,
    chapterId: ch.chapterId,
    chapterVersionId: ch.versionId,
    kinds: COMMIT_JOB_KINDS,
  });
}

function finishAll(chapterVersionId: number): void {
  const ids = sqlite
    .prepare("SELECT id FROM memory_jobs WHERE chapter_version_id = ?")
    .all(chapterVersionId) as Array<{ id: number }>;
  for (const { id } of ids) completeMemoryJob(sqlite, id);
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "memory-lag-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
});

afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("pendingEarlierMemoryChapters", () => {
  it("returns nothing when no memory work is outstanding", () => {
    const bookId = insertBook();
    const c1 = insertChapter(bookId, 1);
    enqueueAll(bookId, c1);
    finishAll(c1.versionId);

    expect(pendingEarlierMemoryChapters(sqlite, bookId, 2)).toEqual([]);
  });

  it("reports an earlier chapter whose memory is still queued", () => {
    const bookId = insertBook();
    const c1 = insertChapter(bookId, 1);
    enqueueAll(bookId, c1);

    expect(pendingEarlierMemoryChapters(sqlite, bookId, 2)).toEqual([1]);
  });

  it("lists each lagging chapter once, in order", () => {
    const bookId = insertBook();
    const c1 = insertChapter(bookId, 1);
    const c2 = insertChapter(bookId, 2);
    enqueueAll(bookId, c1);
    enqueueAll(bookId, c2);

    expect(pendingEarlierMemoryChapters(sqlite, bookId, 3)).toEqual([1, 2]);
  });

  it("ignores the chapter being written and anything after it", () => {
    const bookId = insertBook();
    const c2 = insertChapter(bookId, 2);
    const c3 = insertChapter(bookId, 3);
    enqueueAll(bookId, c2);
    enqueueAll(bookId, c3);

    expect(pendingEarlierMemoryChapters(sqlite, bookId, 2)).toEqual([]);
  });

  it("counts a permanently errored job as memory that never landed", () => {
    const bookId = insertBook();
    const c1 = insertChapter(bookId, 1);
    enqueueAll(bookId, c1);
    finishAll(c1.versionId);
    sqlite
      .prepare(
        "UPDATE memory_jobs SET status='error' WHERE chapter_version_id = ? AND kind='facts'",
      )
      .run(c1.versionId);

    expect(pendingEarlierMemoryChapters(sqlite, bookId, 2)).toEqual([1]);
  });

  it("ignores jobs superseded by a newer version of the same chapter", () => {
    const bookId = insertBook();
    const c1 = insertChapter(bookId, 1);
    enqueueAll(bookId, c1);
    sqlite
      .prepare(
        "UPDATE memory_jobs SET status='obsolete' WHERE chapter_version_id = ?",
      )
      .run(c1.versionId);

    expect(pendingEarlierMemoryChapters(sqlite, bookId, 2)).toEqual([]);
  });

  it("is scoped to one book", () => {
    const bookA = insertBook("A");
    const bookB = insertBook("B");
    const a1 = insertChapter(bookA, 1);
    enqueueAll(bookA, a1);

    expect(pendingEarlierMemoryChapters(sqlite, bookB, 2)).toEqual([]);
  });
});

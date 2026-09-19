import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  metaSummarize: vi.fn(),
}));

import { metaSummarize } from "@book-forge/agents";
import {
  loadRollingChapterContext,
  triggerMetaSummary,
  runMetaSummary,
} from "../rolling-context.js";

const metaSummarizeMock = vi.mocked(metaSummarize);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

let dbDir: string;
let sqlite: DatabaseType;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "rolling-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
}

const NOW = "2026-05-16T00:00:00.000Z";

function insertBook(title = "Книга"): number {
  const info = sqlite
    .prepare(
      "INSERT INTO books (title, created_at, updated_at) VALUES (?, ?, ?)",
    )
    .run(title, NOW, NOW);
  return Number(info.lastInsertRowid);
}

/** Create chapter #order with a current version carrying `summary`. */
function insertChapter(
  bookId: number,
  order: number,
  summary: string | null,
  contentText = "Сырой текст главы ".repeat(20),
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
    .run(chId, contentText, 500, summary, NOW);
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(Number(v.lastInsertRowid), chId);
}

beforeEach(() => {
  open();
  metaSummarizeMock.mockReset();
  metaSummarizeMock.mockResolvedValue({
    summary: "МЕТА-СВОДКА ранних глав.",
    modelId: "noop",
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  });
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("loadRollingChapterContext", () => {
  it("returns null when there are no prior chapters", () => {
    const bookId = insertBook();
    expect(loadRollingChapterContext(sqlite, bookId, 1)).toBeNull();
  });

  it("returns all chapters verbatim when count <= window (3)", () => {
    const bookId = insertBook();
    insertChapter(bookId, 1, "Сводка 1");
    insertChapter(bookId, 2, "Сводка 2");
    insertChapter(bookId, 3, "Сводка 3");
    const out = loadRollingChapterContext(sqlite, bookId, 999)!;
    expect(out).toContain("Глава #1 «Глава 1»");
    expect(out).toContain("Глава #3 «Глава 3»");
    expect(out).not.toContain("Сводка ранних глав");
  });

  it("falls back to per-chapter for older when no meta row exists", () => {
    const bookId = insertBook();
    for (let i = 1; i <= 5; i++) insertChapter(bookId, i, `Сводка ${i}`);
    const out = loadRollingChapterContext(sqlite, bookId, 999)!;
    // older = #1,#2 (verbatim fallback); recent window = #3,#4,#5
    expect(out).toContain("Глава #1 «Глава 1»");
    expect(out).toContain("Глава #5 «Глава 5»");
    expect(out).not.toContain("Сводка ранних глав");
  });

  it("uses meta-summary block for older chapters when present", () => {
    const bookId = insertBook();
    for (let i = 1; i <= 5; i++) insertChapter(bookId, i, `Сводка ${i}`);
    sqlite
      .prepare(
        `INSERT INTO book_meta_summaries
           (book_id, covers_from_order, covers_to_order, summary_text, model_id, created_at)
         VALUES (?, 1, 2, ?, 'sonnet', ?)`,
      )
      .run(bookId, "СЖАТАЯ сводка глав 1-2.", NOW);
    const out = loadRollingChapterContext(sqlite, bookId, 999)!;
    expect(out).toContain("### Сводка ранних глав (#1–#2)");
    expect(out).toContain("СЖАТАЯ сводка глав 1-2.");
    expect(out).not.toContain("Глава #1 «Глава 1»");
    // recent window still verbatim
    expect(out).toContain("Глава #3 «Глава 3»");
    expect(out).toContain("Глава #5 «Глава 5»");
  });

  it("AC-10: сводка, покрывающая главы позже границы, не используется", () => {
    const bookId = insertBook();
    // Книга из 12 глав, сводка покрывает 1–20 (сохранена, когда книга была длиннее).
    for (let i = 1; i <= 12; i++) insertChapter(bookId, i, `Сводка ${i}`);
    sqlite
      .prepare(
        `INSERT INTO book_meta_summaries
           (book_id, covers_from_order, covers_to_order, summary_text, model_id, created_at)
         VALUES (?, 1, 20, ?, 'sonnet', ?)`,
      )
      .run(bookId, "СВОДКА_ДО_ДВАДЦАТОЙ", NOW);
    // Готовим контекст для главы 10.
    const ctx = loadRollingChapterContext(sqlite, bookId, 10)!;
    // Сводка из будущего не должна попасть в контекст.
    expect(ctx).not.toContain("СВОДКА_ДО_ДВАДЦАТОЙ");
    // Ранние главы при этом не пропадают — они возвращаются поглавно.
    expect(ctx).toContain("Глава #1 «Глава 1»");
  });

  it("сводка в пределах границы по-прежнему используется", () => {
    const bookId = insertBook();
    for (let i = 1; i <= 12; i++) insertChapter(bookId, i, `Сводка ${i}`);
    sqlite
      .prepare(
        `INSERT INTO book_meta_summaries
           (book_id, covers_from_order, covers_to_order, summary_text, model_id, created_at)
         VALUES (?, 1, 9, ?, 'sonnet', ?)`,
      )
      .run(bookId, "СВОДКА_ДО_ДЕВЯТОЙ", NOW);
    const ctx = loadRollingChapterContext(sqlite, bookId, 12)!;
    expect(ctx).toContain("СВОДКА_ДО_ДЕВЯТОЙ");
  });
});

describe("triggerMetaSummary", () => {
  /** Новая принятая версия главы со своей поглавной сводкой. Именно смена
   *  `chapters.current_version_id` и делает отпечаток источников другим. */
  function commitNewVersion(chapterId: number, text: string, summary: string): number {
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO chapter_versions
           (chapter_id, content_json, content_text, word_count, summary, created_at)
         VALUES (?, '{}', ?, ?, ?, ?)`,
      )
      .run(chapterId, text, text.split(/\s+/).length, summary, now);
    const versionId = Number(info.lastInsertRowid);
    sqlite
      .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
      .run(versionId, chapterId);
    return versionId;
  }

  it("does not write a meta row when summarized count <= window", async () => {
    const bookId = insertBook();
    insertChapter(bookId, 1, "S1");
    insertChapter(bookId, 2, "S2");
    insertChapter(bookId, 3, "S3");
    await triggerMetaSummary(sqlite, bookId);
    const row = sqlite
      .prepare("SELECT * FROM book_meta_summaries WHERE book_id = ?")
      .get(bookId);
    expect(row).toBeUndefined();
    expect(metaSummarizeMock).not.toHaveBeenCalled();
  });

  it("writes one rollup row covering chapters older than the window", async () => {
    const bookId = insertBook();
    for (let i = 1; i <= 5; i++) insertChapter(bookId, i, `S${i}`);
    await triggerMetaSummary(sqlite, bookId);
    const row = sqlite
      .prepare(
        "SELECT covers_from_order, covers_to_order, summary_text FROM book_meta_summaries WHERE book_id = ?",
      )
      .get(bookId) as
      | {
          covers_from_order: number;
          covers_to_order: number;
          summary_text: string;
        }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.covers_from_order).toBe(1);
    expect(row!.covers_to_order).toBe(2); // 5 total - window 3
    expect(row!.summary_text).toBe("МЕТА-СВОДКА ранних глав.");
    expect(metaSummarizeMock).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — does not regenerate when meta already covers range", async () => {
    const bookId = insertBook();
    for (let i = 1; i <= 5; i++) insertChapter(bookId, i, `S${i}`);
    await triggerMetaSummary(sqlite, bookId);
    await triggerMetaSummary(sqlite, bookId);
    expect(metaSummarizeMock).toHaveBeenCalledTimes(1);
  });

  it("AC-11: правка главы внутри покрытого диапазона заставляет пересчитать сводку", async () => {
    const bookId = insertBook();
    // Книга из 12 глав, у каждой принятая версия со сводкой. Первый прогон
    // строит сводку по главам 1–9 (всё, что старше окна в три главы).
    const chapterIds = new Map<number, number>();
    for (let i = 1; i <= 12; i++) {
      insertChapter(bookId, i, `S${i}`);
      const ch = sqlite
        .prepare("SELECT id FROM chapters WHERE book_id = ? AND order_index = ?")
        .get(bookId, i) as { id: number } | undefined;
      if (ch) chapterIds.set(i, ch.id);
    }

    await runMetaSummary(sqlite, bookId);

    // Глава 3 — внутри покрытого диапазона — получает другую версию.
    commitNewVersion(chapterIds.get(3)!, "совсем другой текст", "другая сводка главы 3");

    const r = await runMetaSummary(sqlite, bookId);
    expect(r.skipped).not.toBe("covered");
    expect(r.updated).toBe(true);
  });

  it("без изменений сводка не пересчитывается", async () => {
    const bookId = insertBook();
    for (let i = 1; i <= 5; i++) insertChapter(bookId, i, `S${i}`);
    await runMetaSummary(sqlite, bookId);
    const r = await runMetaSummary(sqlite, bookId);
    expect(r.skipped).toBe("covered");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * AC-36: критика и правка видят ту же историю, что Writer — сводки по
 * рубежам, дословный финал предыдущей главы, найденные фрагменты. Прежде
 * контекст критики собирался отдельно: первые 1200 символов КАЖДОЙ
 * предыдущей главы и ничего больше.
 */

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  metaSummarize: vi.fn(),
}));
vi.mock("@book-forge/retrieval", async (orig) => ({
  ...(await orig<typeof import("@book-forge/retrieval")>()),
  hybridSearch: vi.fn(),
}));

import { metaSummarize } from "@book-forge/agents";
import { hybridSearch } from "@book-forge/retrieval";
import { runMetaSummary } from "../rolling-context.js";
import { loadChapterProseContext } from "../chapter-prose-context.js";
import type { BookRow, ChapterRow } from "../../db/rows.js";

const metaSummarizeMock = vi.mocked(metaSummarize);
const hybridSearchMock = vi.mocked(hybridSearch);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;

function insertChapter(order: number, text: string, summary: string): number {
  const ch = sqlite
    .prepare(
      `INSERT INTO chapters (book_id, order_index, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bookId, order, `Глава ${order / 10}`, NOW, NOW);
  const chId = Number(ch.lastInsertRowid);
  const v = sqlite
    .prepare(
      `INSERT INTO chapter_versions
         (chapter_id, content_json, content_text, word_count, summary, created_at)
       VALUES (?, '{}', ?, ?, ?, ?)`,
    )
    .run(chId, text, text.split(/\s+/).length, summary, NOW);
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(Number(v.lastInsertRowid), chId);
  return chId;
}

function rows(chapterId: number): { book: BookRow; ch: ChapterRow } {
  return {
    book: sqlite.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as BookRow,
    ch: sqlite.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as ChapterRow,
  };
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "prose-context-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  bookId = Number(
    sqlite
      .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
  metaSummarizeMock.mockReset();
  hybridSearchMock.mockReset();
  hybridSearchMock.mockResolvedValue([]);
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("loadChapterProseContext", () => {
  it("критика получает сводку рубежа и хвост, а не срез каждой главы", async () => {
    // Двенадцать глав; у десятой — критика. Ранние главы должны прийти
    // сводкой, девятая — дословным финалом, а начало первой главы не должно
    // всплыть нигде: раньше оно ехало срезом «первые 1200 символов».
    for (let i = 1; i <= 12; i += 1) {
      insertChapter(
        i * 10,
        i === 1
          ? "НАЧАЛО_ПЕРВОЙ_ГЛАВЫ и дальше много текста. ".repeat(5)
          : i === 9
            ? `Середина девятой.\n\nКОНЕЦ_ДЕВЯТОЙ последним абзацем.`
            : `Текст главы ${i}. `.repeat(5),
        `Сводка ${i}`,
      );
    }
    metaSummarizeMock.mockResolvedValue({
      summary: "СВОДКА_РАННИХ_ГЛАВ",
      modelId: "noop",
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    });
    await runMetaSummary(sqlite, bookId); // рубеж до девятой (1..9), окно 10..12

    const tenth = sqlite
      .prepare("SELECT id FROM chapters WHERE book_id = ? AND order_index = 100")
      .get(bookId) as { id: number };
    const { book, ch } = rows(tenth.id);
    const ctx = await loadChapterProseContext(sqlite, book, ch, "Текст десятой.", {
      hasVec: false,
    });

    expect(ctx.previousChaptersSummary).toContain("СВОДКА_РАННИХ_ГЛАВ");
    expect(ctx.previousChaptersSummary).not.toContain("НАЧАЛО_ПЕРВОЙ_ГЛАВЫ");
    // Короткая глава едет хвостом целиком — обрезка начинается с 6000 знаков.
    expect(ctx.previousChapterTail).toContain("КОНЕЦ_ДЕВЯТОЙ");
    expect(ctx.previousChapterTail).not.toContain("Текст главы 8");
    expect(ctx.compiled.requiredOverflow).toBe(false);
    expect(ctx.compiled.includedIds).toEqual(
      expect.arrayContaining(["prevTail", "rolling"]),
    );
  });

  it("найденные фрагменты доезжают до критики, кроме главы, поданной дословно", async () => {
    insertChapter(10, "Далёкое начало. ".repeat(10), "Сводка 1");
    insertChapter(20, "Медальон лежал под половицей. ".repeat(10), "Сводка 2 без медальона");
    insertChapter(30, "Финал третьей главы.", "Сводка 3");
    const fourth = insertChapter(40, "Текст четвёртой.", "Сводка 4");

    hybridSearchMock.mockResolvedValue([
      {
        chunkId: 1, bookId, chapterId: 2, chapterOrder: 20,
        text: "Медальон лежал под половицей.", score: 9, vecRank: 1, ftsRank: null,
      },
      {
        chunkId: 2, bookId, chapterId: 3, chapterOrder: 30,
        text: "Финал третьей главы.", score: 8, vecRank: 2, ftsRank: null,
      },
    ]);

    const { book, ch } = rows(fourth);
    const ctx = await loadChapterProseContext(sqlite, book, ch, "Текст четвёртой.", {
      hasVec: false,
    });
    // Деталь второй главы, отсутствующая в её сводке, достаётся поиском —
    // раньше окно последних трёх глав исключалось из поиска целиком (AC-12).
    expect(ctx.retrievedContext).toContain("Медальон лежал под половицей");
    // Третья глава подана хвостом дословно — её фрагмент не повторяется.
    expect(ctx.retrievedContext).not.toContain("Финал третьей главы");
    expect(ctx.previousChapterTail).toContain("Финал третьей главы");
  });

  it("у первой главы истории нет, и это не ошибка", async () => {
    const first = insertChapter(10, "Первая.", "Сводка 1");
    const { book, ch } = rows(first);
    const ctx = await loadChapterProseContext(sqlite, book, ch, "Первая.", { hasVec: false });
    expect(ctx.previousChaptersSummary).toBeNull();
    expect(ctx.previousChapterTail).toBeNull();
    expect(ctx.retrievedContext).toBeNull();
    expect(ctx.compiled.requiredOverflow).toBe(false);
  });
});

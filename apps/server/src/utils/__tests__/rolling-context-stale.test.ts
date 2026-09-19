import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  metaSummarize: vi.fn(),
}));

import { metaSummarize } from "@book-forge/agents";
import { loadRollingChapterContext, runMetaSummary } from "../rolling-context.js";

/** В6 независимого ревью 2026-09-19: сводки по рубежам считались только для
 *  последнего рубежа, а читатель брал САМУЮ ПОЗДНЮЮ строку ниже границы — не
 *  самую позднюю ПРИГОДНУЮ. Правка ранней главы делала недействительными все
 *  сводки, и вся книга навсегда переходила на поглавные пересказы. */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;

function chapter(order: number, summary: string | null): number {
  const chId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapters (book_id, order_index, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(bookId, order, `Глава ${order / 10}`, NOW, NOW).lastInsertRowid,
  );
  const vId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, summary, created_at)
         VALUES (?, '{}', ?, 5, ?, ?)`,
      )
      .run(chId, `Полный текст главы ${order / 10}`, summary, NOW).lastInsertRowid,
  );
  sqlite.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(vId, chId);
  return chId;
}

function seedSummary(
  coversFrom: number,
  coversTo: number,
  text: string,
  fingerprint: string | null,
): void {
  sqlite
    .prepare(
      `INSERT INTO book_meta_summaries
         (book_id, covers_from_order, covers_to_order, summary_text, model_id, source_fingerprint, created_at)
       VALUES (?, ?, ?, ?, 'test', ?, ?)`,
    )
    .run(bookId, coversFrom, coversTo, text, fingerprint, NOW);
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "rolling-stale-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  bookId = Number(
    sqlite
      .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
  vi.mocked(metaSummarize).mockReset();
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("чтение сводок (В6)", () => {
  it("берёт самую позднюю ПРИГОДНУЮ сводку, а не самую позднюю", () => {
    for (let i = 1; i <= 5; i++) chapter(i * 10, `Пересказ главы ${i}`);
    seedSummary(10, 20, "СВОДКА_ДО_ВТОРОЙ", null);
    // Рубеж позже, но его отпечаток уже не сходится: главу внутри правили.
    seedSummary(10, 30, "СВОДКА_ДО_ТРЕТЬЕЙ", "отпечаток-который-не-сойдётся");

    const ctx = loadRollingChapterContext(sqlite, bookId, 50);

    expect(ctx).toContain("СВОДКА_ДО_ВТОРОЙ");
    expect(ctx).not.toContain("СВОДКА_ДО_ТРЕТЬЕЙ");
    // Главы, которых пригодная сводка не покрывает, идут пересказами.
    expect(ctx).toContain("Пересказ главы 3");
  });

  it("без пригодных сводок честно падает на поглавные пересказы", () => {
    for (let i = 1; i <= 5; i++) chapter(i * 10, `Пересказ главы ${i}`);
    seedSummary(10, 30, "СВОДКА", "битый-отпечаток");

    const ctx = loadRollingChapterContext(sqlite, bookId, 50);

    expect(ctx).not.toContain("СВОДКА");
    expect(ctx).toContain("Пересказ главы 1");
  });
});

describe("пересчёт сводок (В6)", () => {
  it("пересобирает устаревшие рубежи, а не только последний", async () => {
    for (let i = 1; i <= 6; i++) chapter(i * 10, `Пересказ главы ${i}`);
    // Рубеж, собранный до правки ранней главы: отпечаток не сойдётся.
    seedSummary(10, 20, "СТАРАЯ_СВОДКА", "устаревший-отпечаток");
    vi.mocked(metaSummarize).mockImplementation(async (input) => ({
      summary: `сводка до главы ${input.chapterSummaries.at(-1)?.order ?? 0}`,
      modelId: "test",
      tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
    }));

    const res = await runMetaSummary(sqlite, bookId);
    expect(res.updated).toBe(true);

    const rows = sqlite
      .prepare(
        "SELECT covers_to_order t, summary_text s FROM book_meta_summaries WHERE book_id = ? ORDER BY covers_to_order",
      )
      .all(bookId) as Array<{ t: number; s: string }>;
    // Новый рубеж (30) собран, старый (20) пересобран, а не оставлен врать.
    expect(rows.map((r) => r.t)).toEqual([20, 30]);
    expect(rows.find((r) => r.t === 20)!.s).not.toBe("СТАРАЯ_СВОДКА");
  });

  it("не трогает рубежи, чей отпечаток сошёлся", async () => {
    for (let i = 1; i <= 6; i++) chapter(i * 10, `Пересказ главы ${i}`);
    vi.mocked(metaSummarize).mockImplementation(async (input) => ({
      summary: `сводка до главы ${input.chapterSummaries.at(-1)?.order ?? 0}`,
      modelId: "test",
      tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
    }));

    await runMetaSummary(sqlite, bookId);
    const callsAfterFirst = vi.mocked(metaSummarize).mock.calls.length;
    const second = await runMetaSummary(sqlite, bookId);

    expect(second.updated).toBe(false);
    expect(vi.mocked(metaSummarize).mock.calls.length).toBe(callsAfterFirst);
  });
});

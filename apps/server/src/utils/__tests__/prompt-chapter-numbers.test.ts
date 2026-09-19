import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { loadRollingChapterContext } from "../rolling-context.js";
import { persistExtractedFacts, renderActiveFactsPrompt } from "../book-facts.js";
import { renderOpenNotesPrompt } from "../book-notes.js";
import { chapterPositionLookup } from "../chapter-position.js";

/** С4 ревью 2026-09-19: в промпт уходил сырой `order_index`. Нумерация
 *  разрежённая (шаг 10), поэтому модель видела «Глава #10, #20, #30» и свою
 *  «Глава 3» — и считала по ним расстояния, которых нет. События героев уже
 *  переведены на позиции, остальные слои — нет. */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;

function chapter(order: number, text: string): number {
  const chId = Number(
    sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(bookId, order, `Глава ${order / 10}`, NOW, NOW).lastInsertRowid,
  );
  const vId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, summary, created_at)
         VALUES (?, '{}', ?, 4, ?, ?)`,
      )
      .run(chId, text, `Пересказ: ${text}`, NOW).lastInsertRowid,
  );
  sqlite.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(vId, chId);
  return chId;
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "prompt-numbers-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  bookId = Number(
    sqlite
      .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("номера глав в промпте — порядковые (С4)", () => {
  it("история глав нумеруется по порядку, а не по order_index", () => {
    chapter(10, "Первая.");
    chapter(20, "Вторая.");
    chapter(30, "Третья.");

    const ctx = loadRollingChapterContext(sqlite, bookId, 40, {
      positionOf: chapterPositionLookup(sqlite, bookId),
    });

    expect(ctx).toContain("Глава 3");
    expect(ctx).not.toContain("#30");
  });

  it("факты называют главу, с которой действуют, порядковым номером", () => {
    chapter(10, "Первая.");
    chapter(20, "Вторая.");
    persistExtractedFacts(sqlite, bookId, 20, null, [
      {
        entityType: "character",
        entityName: "Анна",
        predicate: "местоположение",
        objectText: "в порту",
        confidence: 1,
        assertionMode: "narrated_as_fact",
        supersedesFactIds: [],
      },
    ]);

    const prompt = renderActiveFactsPrompt(sqlite, bookId, 20, {
      positionOf: chapterPositionLookup(sqlite, bookId),
    });

    expect(prompt).toContain("с главы 2");
    expect(prompt).not.toContain("#20");
  });

  it("открытые линии тоже", () => {
    chapter(10, "Первая.");
    chapter(20, "Вторая.");
    const prompt = renderOpenNotesPrompt(
      [
        {
          id: 1,
          kind: "thread",
          title: "Письмо",
          body: "не дошло",
          introduced: 10,
        },
      ],
      "Открытые линии",
      20,
      { positionOf: chapterPositionLookup(sqlite, bookId) },
    );

    expect(prompt).toContain("с главы 1");
    expect(prompt).not.toContain("#10");
  });
});

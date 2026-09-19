import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { loadActiveFacts, persistExtractedFacts } from "../book-facts.js";
import type { ExtractedFact } from "@book-forge/shared";

/** Разбор главы больше не обязан идти строго по порядку глав: очередь
 *  перестала блокироваться на главе, чьё задание упало навсегда (В3), и
 *  «Повторить» приходит ПОСЛЕ того, как поздние главы уже разобраны.
 *  Вставка факта обязана попадать в интервал, а не только закрывать
 *  открытое прошлое. */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;

const fact = (objectText: string): ExtractedFact => ({
  entityType: "character",
  entityName: "Анна",
  predicate: "местоположение",
  objectText,
  confidence: 1,
  assertionMode: "narrated_as_fact",
  supersedesFactIds: [],
});

const activeAt = (order: number): string[] =>
  loadActiveFacts(sqlite, bookId, order).map((f) => f.objectText);

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "facts-order-"));
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

describe("факты вне порядка глав", () => {
  it("глава, разобранная последней, не остаётся действующей навсегда", () => {
    persistExtractedFacts(sqlite, bookId, 30, null, [fact("в порту")]);
    persistExtractedFacts(sqlite, bookId, 50, null, [fact("в столице")]);
    // Глава 40 падала и разобрана после пятидесятой.
    persistExtractedFacts(sqlite, bookId, 40, null, [fact("в дороге")]);

    expect(activeAt(35)).toEqual(["в порту"]);
    expect(activeAt(45)).toEqual(["в дороге"]);
    // Главный отказ: без закрытия «в дороге» на 49 Писатель шестой главы
    // получал два противоречащих действующих факта.
    expect(activeAt(55)).toEqual(["в столице"]);
  });

  it("предшественник, закрытый поздней главой, ужимается, а не перекрывается", () => {
    persistExtractedFacts(sqlite, bookId, 30, null, [fact("в порту")]);
    persistExtractedFacts(sqlite, bookId, 50, null, [fact("в столице")]);
    persistExtractedFacts(sqlite, bookId, 40, null, [fact("в дороге")]);

    const rows = sqlite
      .prepare(
        "SELECT object_text, valid_from_chapter, valid_to_chapter FROM book_facts WHERE book_id = ? ORDER BY valid_from_chapter",
      )
      .all(bookId) as Array<{
      object_text: string;
      valid_from_chapter: number;
      valid_to_chapter: number | null;
    }>;
    expect(rows).toEqual([
      { object_text: "в порту", valid_from_chapter: 30, valid_to_chapter: 39 },
      { object_text: "в дороге", valid_from_chapter: 40, valid_to_chapter: 49 },
      { object_text: "в столице", valid_from_chapter: 50, valid_to_chapter: null },
    ]);
  });

  it("прежний порядок глав работает как раньше", () => {
    persistExtractedFacts(sqlite, bookId, 10, null, [fact("в порту")]);
    persistExtractedFacts(sqlite, bookId, 20, null, [fact("в столице")]);
    expect(activeAt(15)).toEqual(["в порту"]);
    expect(activeAt(25)).toEqual(["в столице"]);
  });
});

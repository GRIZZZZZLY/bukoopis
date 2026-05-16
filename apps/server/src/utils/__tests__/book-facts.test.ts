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
  extractCanonFacts: vi.fn(),
}));

import { extractCanonFacts } from "@book-forge/agents";
import {
  loadActiveFacts,
  persistExtractedFacts,
  renderActiveFactsPrompt,
  triggerCanonFactExtraction,
} from "../book-facts.js";
import type { ExtractedFact } from "@book-forge/shared";

const extractMock = vi.mocked(extractCanonFacts);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-05-16T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "facts-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
}

function insertBook(): number {
  const info = sqlite
    .prepare(
      "INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)",
    )
    .run(NOW, NOW);
  return Number(info.lastInsertRowid);
}

function fact(
  entityName: string,
  predicate: string,
  objectText: string,
  entityType: ExtractedFact["entityType"] = "character",
): ExtractedFact {
  return { entityType, entityName, predicate, objectText, confidence: 1 };
}

beforeEach(() => {
  open();
  extractMock.mockReset();
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("persistExtractedFacts + loadActiveFacts", () => {
  it("temporal supersession closes the prior version", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 5, 50, [
      fact("Аня", "умеет", "магия огня"),
    ]);
    persistExtractedFacts(sqlite, b, 8, 80, [
      fact("Аня", "умеет", "потеряла магию"),
    ]);

    // At chapter 6 the old fact is still active.
    const at6 = loadActiveFacts(sqlite, b, 6);
    expect(at6).toHaveLength(1);
    expect(at6[0]!.objectText).toBe("магия огня");

    // At chapter 8 the new fact is active, old one closed.
    const at8 = loadActiveFacts(sqlite, b, 8);
    expect(at8).toHaveLength(1);
    expect(at8[0]!.objectText).toBe("потеряла магию");

    const old = sqlite
      .prepare(
        "SELECT valid_to_chapter, superseded_by FROM book_facts WHERE object_text = 'магия огня'",
      )
      .get() as { valid_to_chapter: number; superseded_by: number | null };
    expect(old.valid_to_chapter).toBe(7);
    expect(old.superseded_by).not.toBeNull();
  });

  it("is idempotent when the value is unchanged", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 5, 50, [fact("Аня", "умеет", "магия")]);
    persistExtractedFacts(sqlite, b, 9, 90, [fact("Аня", "умеет", "магия")]);
    const rows = sqlite
      .prepare("SELECT COUNT(*) AS c FROM book_facts")
      .get() as { c: number };
    expect(rows.c).toBe(1);
    expect(loadActiveFacts(sqlite, b, 12)[0]!.validFromChapter).toBe(5);
  });

  it("same-chapter re-extraction replaces this chapter's rows", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 5, 50, [fact("Аня", "умеет", "v1")]);
    persistExtractedFacts(sqlite, b, 5, 51, [fact("Аня", "умеет", "v2")]);
    const active = loadActiveFacts(sqlite, b, 5);
    expect(active).toHaveLength(1);
    expect(active[0]!.objectText).toBe("v2");
  });

  it("scopes by entityNames", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 1, 1, [
      fact("Аня", "умеет", "магия"),
      fact("Борис", "владеет", "меч"),
    ]);
    const only = loadActiveFacts(sqlite, b, 3, { entityNames: ["Аня"] });
    expect(only).toHaveLength(1);
    expect(only[0]!.entityName).toBe("Аня");
  });
});

describe("renderActiveFactsPrompt", () => {
  it("returns null when no active facts", () => {
    const b = insertBook();
    expect(renderActiveFactsPrompt(sqlite, b, 3)).toBeNull();
  });

  it("groups facts by entity with chapter provenance", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 2, 20, [
      fact("Аня", "умеет", "магия огня"),
      fact("Меч-кладенец", "свойство", "режет камень", "item"),
    ]);
    const out = renderActiveFactsPrompt(sqlite, b, 5)!;
    expect(out).toContain("Канон-факты (актуальны на главу #5)");
    expect(out).toContain("### Персонаж: Аня");
    expect(out).toContain("- умеет: магия огня (с гл. #2)");
    expect(out).toContain("### Предмет: Меч-кладенец");
  });
});

describe("triggerCanonFactExtraction", () => {
  function seedChapter(bookId: number, order: number, words: number): number {
    const ch = sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(bookId, order, `Глава ${order}`, NOW, NOW);
    const chId = Number(ch.lastInsertRowid);
    const v = sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', ?, ?, ?)`,
      )
      .run(chId, "Текст ".repeat(words), words, NOW);
    const vId = Number(v.lastInsertRowid);
    sqlite
      .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
      .run(vId, chId);
    return vId;
  }

  it("persists extracted facts for a long enough chapter", async () => {
    const b = insertBook();
    const vId = seedChapter(b, 3, 500);
    extractMock.mockResolvedValue({
      facts: [fact("Аня", "умеет", "магия огня")],
      notes: null,
    });
    await triggerCanonFactExtraction(sqlite, vId);
    expect(extractMock).toHaveBeenCalledTimes(1);
    const active = loadActiveFacts(sqlite, b, 3);
    expect(active).toHaveLength(1);
    expect(active[0]!.objectText).toBe("магия огня");
  });

  it("skips short chapters (word_count < 80)", async () => {
    const b = insertBook();
    const vId = seedChapter(b, 1, 40);
    await triggerCanonFactExtraction(sqlite, vId);
    expect(extractMock).not.toHaveBeenCalled();
  });
});

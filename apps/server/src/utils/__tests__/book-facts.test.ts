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
  extra?: Partial<
    Pick<ExtractedFact, "assertionMode" | "supersedesFactIds">
  >,
): ExtractedFact {
  return {
    entityType,
    entityName,
    predicate,
    objectText,
    confidence: 1,
    assertionMode: extra?.assertionMode ?? "narrated_as_fact",
    supersedesFactIds: extra?.supersedesFactIds ?? [],
  };
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

  it("a character's statement never becomes objective canon (ADR 0003)", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 3, 30, [
      fact("Мария", "состояние", "жива"),
    ]);
    // Иван lies: «Мария умерла» — stated_by_character.
    persistExtractedFacts(sqlite, b, 5, 50, [
      fact("Мария", "состояние", "умерла", "character", {
        assertionMode: "stated_by_character",
      }),
    ]);
    // Objective canon still says «жива»; the claim did NOT supersede it.
    const active = loadActiveFacts(sqlite, b, 6);
    expect(active).toHaveLength(1);
    expect(active[0]!.objectText).toBe("жива");
    // The claim is stored (for future character-knowledge use)…
    const all = loadActiveFacts(sqlite, b, 6, { objectiveOnly: false });
    expect(all).toHaveLength(2);
    // …and the rendered canon prompt excludes it.
    const prompt = renderActiveFactsPrompt(sqlite, b, 6)!;
    expect(prompt).toContain("жива");
    expect(prompt).not.toContain("умерла");
  });

  it("explicit supersedesFactIds closes exactly the named fact (multi-valued predicate)", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 2, 20, [
      fact("Аня", "владеет", "кольцо Эйра"),
      fact("Аня", "владеет", "меч Заката"),
    ]);
    const ring = loadActiveFacts(sqlite, b, 3).find(
      (f) => f.objectText === "кольцо Эйра",
    )!;
    // She loses ONLY the ring; the model names the exact fact id.
    persistExtractedFacts(sqlite, b, 6, 60, [
      fact("Аня", "владеет", "потеряла кольцо Эйра", "character", {
        supersedesFactIds: [`fact_${ring.id}`],
      }),
    ]);
    const at7 = loadActiveFacts(sqlite, b, 7).map((f) => f.objectText);
    expect(at7).toContain("меч Заката"); // untouched
    expect(at7).toContain("потеряла кольцо Эйра");
    expect(at7).not.toContain("кольцо Эйра");
  });

  it("unknown or foreign supersedesFactIds are skipped, not guessed", () => {
    const a = insertBook();
    const b = insertBook();
    persistExtractedFacts(sqlite, a, 1, 10, [
      fact("Чужой", "состояние", "жив"),
    ]);
    const foreign = loadActiveFacts(sqlite, a, 2)[0]!;
    persistExtractedFacts(sqlite, b, 4, 40, [
      fact("Свой", "состояние", "ранен", "character", {
        supersedesFactIds: ["fact_999999", `fact_${foreign.id}`],
      }),
    ]);
    // Foreign book's fact untouched; new fact inserted anyway.
    expect(loadActiveFacts(sqlite, a, 5)[0]!.objectText).toBe("жив");
    expect(loadActiveFacts(sqlite, b, 5)[0]!.objectText).toBe("ранен");
  });

  it("renders fact ids only when withIds is set (extractor input)", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 1, 10, [fact("Аня", "умеет", "магия")]);
    const id = loadActiveFacts(sqlite, b, 2)[0]!.id;
    expect(renderActiveFactsPrompt(sqlite, b, 2)).not.toContain("[fact_");
    expect(
      renderActiveFactsPrompt(sqlite, b, 2, { withIds: true }),
    ).toContain(`[fact_${id}]`);
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

describe("fact provenance", () => {
  it("marks extracted rows as machine-produced and unreviewed", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 5, 50, [
      fact("Аня", "умеет", "магия огня"),
    ]);

    const row = sqlite
      .prepare("SELECT source_kind, review_status FROM book_facts")
      .get() as { source_kind: string; review_status: string };
    expect(row.source_kind).toBe("llm_extraction");
    expect(row.review_status).toBe("unreviewed");
  });

  it("keeps serving an unreviewed fact — extraction is the normal path", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 5, 50, [
      fact("Аня", "умеет", "магия огня"),
    ]);

    expect(loadActiveFacts(sqlite, b, 6)).toHaveLength(1);
  });

  it("never serves a fact the author rejected", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 5, 50, [
      fact("Аня", "умеет", "магия огня"),
    ]);
    sqlite
      .prepare("UPDATE book_facts SET review_status = 'rejected'")
      .run();

    expect(loadActiveFacts(sqlite, b, 6)).toEqual([]);
    expect(renderActiveFactsPrompt(sqlite, b, 6)).toBeNull();
  });

  it("serves a confirmed fact", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 5, 50, [
      fact("Аня", "умеет", "магия огня"),
    ]);
    sqlite
      .prepare("UPDATE book_facts SET review_status = 'confirmed'")
      .run();

    expect(loadActiveFacts(sqlite, b, 6)).toHaveLength(1);
  });
});

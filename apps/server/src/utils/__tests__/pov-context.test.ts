import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadPovKnowledge, renderPovKnowledgePrompt } from "../pov-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-07-12T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "pov-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
}
function insertBook(): number {
  return Number(
    sqlite
      .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
}
function insertCharacter(bookId: number, name: string): number {
  return Number(
    sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
         VALUES (?, ?, '{}', ?, ?)`,
      )
      .run(bookId, name, NOW, NOW).lastInsertRowid,
  );
}
function insertChapter(bookId: number, order: number): number {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(bookId, order, `Глава ${order}`, NOW, NOW).lastInsertRowid,
  );
}
function learn(characterId: number, fact: string, chapterId: number | null): void {
  sqlite
    .prepare(
      `INSERT INTO character_knowledge (character_id, fact, learned_in_chapter_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(characterId, fact, chapterId, NOW);
}

beforeEach(() => open());
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("loadPovKnowledge", () => {
  it("returns only what POV learned by the current chapter", () => {
    const b = insertBook();
    const ivan = insertCharacter(b, "Иван");
    const ch2 = insertChapter(b, 2);
    const ch7 = insertChapter(b, 7);
    learn(ivan, "знает пароль", ch2);
    learn(ivan, "видел убийцу", ch7);
    learn(ivan, "боится темноты", null); // known from the start

    const at5 = loadPovKnowledge(sqlite, b, "Иван", 5);
    expect(at5.povName).toBe("Иван");
    expect(at5.facts).toContain("знает пароль");
    expect(at5.facts).toContain("боится темноты");
    expect(at5.facts).not.toContain("видел убийцу"); // learned later, at ch7

    const at7 = loadPovKnowledge(sqlite, b, "Иван", 7);
    expect(at7.facts).toContain("видел убийцу");
  });

  it("resolves the POV name to the canonical character (case-insensitive)", () => {
    const b = insertBook();
    const ivan = insertCharacter(b, "Иван");
    learn(ivan, "умеет читать руны", null);
    expect(loadPovKnowledge(sqlite, b, "иван", 3).facts).toEqual([
      "умеет читать руны",
    ]);
  });

  it("returns empty for an unknown POV name", () => {
    const b = insertBook();
    insertCharacter(b, "Иван");
    expect(loadPovKnowledge(sqlite, b, "Незнакомец", 3).facts).toEqual([]);
  });
});

describe("renderPovKnowledgePrompt", () => {
  it("is null when POV knows nothing", () => {
    expect(
      renderPovKnowledgePrompt({ povName: "Иван", facts: [] }),
    ).toBeNull();
  });
  it("labels the block with the POV name and a guard line", () => {
    const out = renderPovKnowledgePrompt({
      povName: "Иван",
      facts: ["знает пароль"],
    })!;
    expect(out).toContain("Известно POV-персонажу (Иван)");
    expect(out).toContain("- знает пароль");
  });
});

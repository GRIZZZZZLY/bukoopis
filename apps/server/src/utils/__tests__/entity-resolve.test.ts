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
  resolveEntity,
  addEntityAlias,
  listEntityAliases,
  deleteEntityAlias,
} from "../entity-resolve.js";
import { persistExtractedFacts, loadActiveFacts } from "../book-facts.js";
import type { ExtractedFact } from "@book-forge/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-07-12T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "entres-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
}
function insertBook(): number {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)",
      )
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
function insertItem(bookId: number, name: string): number {
  return Number(
    sqlite
      .prepare(
        `INSERT INTO items (book_id, name, profile_json, created_at, updated_at)
         VALUES (?, ?, '{}', ?, ?)`,
      )
      .run(bookId, name, NOW, NOW).lastInsertRowid,
  );
}
function fact(
  entityName: string,
  predicate: string,
  objectText: string,
  entityType: ExtractedFact["entityType"] = "character",
): ExtractedFact {
  return {
    entityType,
    entityName,
    predicate,
    objectText,
    confidence: 1,
    assertionMode: "narrated_as_fact",
    supersedesFactIds: [],
  };
}

beforeEach(() => open());
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("resolveEntity", () => {
  it("matches canonical names case-insensitively", () => {
    const b = insertBook();
    const id = insertCharacter(b, "Айрис");
    expect(resolveEntity(sqlite, b, "character", "айрис")?.entityId).toBe(id);
    expect(resolveEntity(sqlite, b, "character", "  АЙРИС ")?.canonicalName).toBe(
      "Айрис",
    );
  });

  it("returns null for unknown names and for world facts", () => {
    const b = insertBook();
    insertCharacter(b, "Айрис");
    expect(resolveEntity(sqlite, b, "character", "Кеан")).toBeNull();
    expect(resolveEntity(sqlite, b, "world", "магия")).toBeNull();
  });

  it("resolves via a registered alias", () => {
    const b = insertBook();
    const id = insertCharacter(b, "Айрис");
    addEntityAlias(sqlite, b, "character", id, "Айри");
    const r = resolveEntity(sqlite, b, "character", "айри");
    expect(r?.entityId).toBe(id);
    expect(r?.canonicalName).toBe("Айрис"); // canonical, not the alias
  });

  it("does not leak entities across books or types", () => {
    const a = insertBook();
    const b = insertBook();
    insertCharacter(a, "Айрис");
    insertItem(b, "Айрис"); // same string, different book + type
    expect(resolveEntity(sqlite, b, "character", "Айрис")).toBeNull();
    expect(resolveEntity(sqlite, a, "item", "Айрис")).toBeNull();
  });
});

describe("addEntityAlias", () => {
  it("is idempotent and rejects conflicting mappings", () => {
    const b = insertBook();
    const a = insertCharacter(b, "Айрис");
    const kean = insertCharacter(b, "Кеан");
    expect(addEntityAlias(sqlite, b, "character", a, "Ветер").ok).toBe(true);
    expect(addEntityAlias(sqlite, b, "character", a, "ветер").ok).toBe(true); // dup, same entity
    const conflict = addEntityAlias(sqlite, b, "character", kean, "Ветер");
    expect(conflict.ok).toBe(false);
    expect(conflict.conflict).toBe(a);
    expect(listEntityAliases(sqlite, b, "character", a)).toHaveLength(1);
  });

  it("delete removes the alias", () => {
    const b = insertBook();
    const a = insertCharacter(b, "Айрис");
    addEntityAlias(sqlite, b, "character", a, "Ветер");
    const [alias] = listEntityAliases(sqlite, b, "character", a);
    expect(deleteEntityAlias(sqlite, b, alias!.id)).toBe(true);
    expect(listEntityAliases(sqlite, b, "character", a)).toHaveLength(0);
  });
});

describe("persistExtractedFacts entity resolution", () => {
  it("stores the resolved entity_id and canonicalizes the name", () => {
    const b = insertBook();
    const id = insertCharacter(b, "Иван");
    // Extractor emitted a case form; a registered alias resolves it.
    addEntityAlias(sqlite, b, "character", id, "Ивана");
    persistExtractedFacts(sqlite, b, 3, 30, [
      fact("Ивана", "состояние", "ранен"),
    ]);
    const row = sqlite
      .prepare(
        "SELECT entity_id, entity_name FROM book_facts WHERE book_id = ?",
      )
      .get(b) as { entity_id: number | null; entity_name: string };
    expect(row.entity_id).toBe(id);
    expect(row.entity_name).toBe("Иван"); // canonicalized
  });

  it("supersedes by entity_id even when the emitted name form differs", () => {
    const b = insertBook();
    const id = insertCharacter(b, "Иван");
    addEntityAlias(sqlite, b, "character", id, "Ивана");
    persistExtractedFacts(sqlite, b, 2, 20, [fact("Иван", "состояние", "здоров")]);
    // Later chapter refers to him in another form → still one active fact.
    persistExtractedFacts(sqlite, b, 6, 60, [fact("Ивана", "состояние", "ранен")]);
    const active = loadActiveFacts(sqlite, b, 7);
    expect(active).toHaveLength(1);
    expect(active[0]!.objectText).toBe("ранен");
    expect(active[0]!.entityName).toBe("Иван");
  });

  it("keeps unresolved names as-is (no matching entity)", () => {
    const b = insertBook();
    persistExtractedFacts(sqlite, b, 1, 10, [
      fact("Безымянный дух", "состояние", "бродит"),
    ]);
    const row = sqlite
      .prepare("SELECT entity_id, entity_name FROM book_facts WHERE book_id = ?")
      .get(b) as { entity_id: number | null; entity_name: string };
    expect(row.entity_id).toBeNull();
    expect(row.entity_name).toBe("Безымянный дух");
  });
});

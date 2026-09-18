import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ACQUISITION_LABELS } from "@book-forge/shared";
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
function learn(
  bookId: number,
  characterId: number,
  fact: string,
  chapterId: number | null,
  acquisition = "observed",
): void {
  sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', ?, ?, 0, 'manual', 'confirmed', 1, ?, ?)`,
    )
    .run(
      bookId,
      characterId,
      JSON.stringify({ fact, acquisition }),
      chapterId,
      `k:${fact}`,
      NOW,
    );
}

beforeEach(() => open());
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("loadPovKnowledge", () => {
  it("возвращает узнанное ДО этой главы, но не в ней самой", () => {
    const b = insertBook();
    const ivan = insertCharacter(b, "Иван");
    const ch2 = insertChapter(b, 2);
    const ch5 = insertChapter(b, 5);
    const ch7 = insertChapter(b, 7);
    learn(b, ivan, "знает пароль", ch2);
    learn(b, ivan, "видел убийцу", ch7);
    learn(b, ivan, "боится темноты", null); // известно с начала

    const at5 = loadPovKnowledge(sqlite, b, "Иван", ch5);
    expect(at5.povName).toBe("Иван");
    expect(at5.facts.join(" ")).toContain("знает пароль");
    expect(at5.facts.join(" ")).toContain("боится темноты");
    expect(at5.facts.join(" ")).not.toContain("видел убийцу");

    // Решающий случай: в СВОЕЙ главе знание ещё не получено. При включающей
    // границе (как было до этапа 3) герой входил бы в сцену, уже зная её
    // поворот, и Писателю разрешалось бы это озвучить.
    const at7 = loadPovKnowledge(sqlite, b, "Иван", ch7);
    expect(at7.facts.join(" ")).not.toContain("видел убийцу");
    expect(at7.facts.join(" ")).toContain("знает пароль");
  });

  it("сохраняет, откуда герой узнал: услышанное не равно увиденному", () => {
    const b = insertBook();
    const ivan = insertCharacter(b, "Иван");
    const ch1 = insertChapter(b, 1);
    const ch4 = insertChapter(b, 4);
    learn(b, ivan, "станцию закрывают", ch1, "told");
    learn(b, ivan, "дверь была взломана", ch1, "observed");

    const facts = loadPovKnowledge(sqlite, b, "Иван", ch4).facts;
    const told = facts.find((f) => f.includes("станцию закрывают"))!;
    const seen = facts.find((f) => f.includes("дверь была взломана"))!;
    expect(told).toContain(ACQUISITION_LABELS.told);
    expect(seen).toContain(ACQUISITION_LABELS.observed);
    expect(told).not.toContain(ACQUISITION_LABELS.observed);
  });

  it("гипотеза извлекателя в голову герою не попадает", () => {
    const b = insertBook();
    const ivan = insertCharacter(b, "Иван");
    const ch1 = insertChapter(b, 1);
    const ch4 = insertChapter(b, 4);
    learn(b, ivan, "точно знает", ch1);
    sqlite
      .prepare(
        `INSERT INTO character_events
           (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
            origin, verification, extractor_version, dedup_key, created_at)
         VALUES (?, ?, 'knowledge', ?, ?, 0, 'llm', 'proposed', 1, 'p', ?)`,
      )
      .run(b, ivan, JSON.stringify({ fact: "только предположение" }), ch1, NOW);

    const facts = loadPovKnowledge(sqlite, b, "Иван", ch4).facts.join(" ");
    expect(facts).toContain("точно знает");
    expect(facts).not.toContain("только предположение");
  });

  it("разрешает имя POV к каноническому герою без учёта регистра", () => {
    const b = insertBook();
    const ivan = insertCharacter(b, "Иван");
    const ch3 = insertChapter(b, 3);
    learn(b, ivan, "умеет читать руны", null);
    const out = loadPovKnowledge(sqlite, b, "иван", ch3);
    expect(out.povName).toBe("Иван");
    expect(out.facts).toHaveLength(1);
    expect(out.facts[0]).toContain("умеет читать руны");
  });

  it("на неизвестное имя POV возвращает пусто", () => {
    const b = insertBook();
    const ivan = insertCharacter(b, "Иван");
    const ch3 = insertChapter(b, 3);
    // У книги есть что возвращать — иначе пустой ответ ничего не доказывает.
    learn(b, ivan, "знает город", null);
    expect(loadPovKnowledge(sqlite, b, "Незнакомец", ch3).facts).toEqual([]);
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

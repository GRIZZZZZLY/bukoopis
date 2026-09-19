import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Одна сборка контекста на все роли (этап 4, раздел 8.1). Роли различаются
 * тем, что сканируют и чем ищут; история, участники на границе, факты и
 * бюджет у них общие — и ссылки на источники одни.
 */

vi.mock("@book-forge/retrieval", async (orig) => ({
  ...(await orig<typeof import("@book-forge/retrieval")>()),
  hybridSearch: vi.fn(async () => []),
}));

import { assembleGenerationContext } from "../generation-context.js";
import type { BookRow, ChapterRow } from "../../db/rows.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;

function insertChapter(order: number, text: string | null): number {
  const chId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapters (book_id, order_index, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(bookId, order, `Глава ${order / 10}`, NOW, NOW).lastInsertRowid,
  );
  if (text !== null) commitVersion(chId, text);
  return chId;
}

function commitVersion(chapterId: number, text: string): number {
  const vId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, summary, created_at)
         VALUES (?, '{}', ?, ?, ?, ?)`,
      )
      .run(chapterId, text, text.split(/\s+/).length, `Сводка: ${text.slice(0, 20)}`, NOW)
      .lastInsertRowid,
  );
  sqlite.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(vId, chapterId);
  return vId;
}

function insertCharacter(name: string): number {
  return Number(
    sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, revision, created_at, updated_at)
         VALUES (?, ?, '{"description":"герой"}', 0, ?, ?)`,
      )
      .run(bookId, name, NOW, NOW).lastInsertRowid,
  );
}

function insertKnowledge(characterId: number, chapterId: number, fact: string): void {
  sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, origin,
          verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', ?, ?, 'manual', 'confirmed', 1, ?, ?)`,
    )
    .run(bookId, characterId, JSON.stringify({ fact, acquisition: "told" }), chapterId, `k:${fact}`, NOW);
}

function rows(chapterId: number): { book: BookRow; ch: ChapterRow } {
  return {
    book: sqlite.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as BookRow,
    ch: sqlite.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as ChapterRow,
  };
}

async function assemble(chapterId: number, over: Partial<Parameters<typeof assembleGenerationContext>[1]> = {}) {
  const { book, ch } = rows(chapterId);
  return assembleGenerationContext(sqlite, {
    book,
    chapter: ch,
    hasVec: false,
    scanTexts: ["Рин идёт к ручью"],
    retrievalQuery: "ручей",
    povName: "Рин",
    label: "test",
    ...over,
  });
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "generation-context-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  bookId = Number(
    sqlite
      .prepare("INSERT INTO books (title, premise, created_at, updated_at) VALUES ('Книга', 'Премиса', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("assembleGenerationContext", () => {
  it("Writer и критика получают одну историю и одних участников", async () => {
    insertCharacter("Рин");
    insertChapter(10, "Первая глава. Рин у ручья.");
    insertChapter(20, "Вторая глава. КОНЕЦ_ВТОРОЙ.");
    const third = insertChapter(30, "Третья.");

    const asWriter = await assemble(third, { scanTexts: ["беат-лист: Рин идёт"], retrievalQuery: "беат" });
    const asCritic = await assemble(third, { scanTexts: ["текст главы: Рин пришла"], retrievalQuery: "план", styleFewShot: 0 });

    expect(asWriter.previousChapters).toBe(asCritic.previousChapters);
    expect(asWriter.previousTail).toBe(asCritic.previousTail);
    expect(asWriter.previousTail).toContain("КОНЕЦ_ВТОРОЙ");
    expect(asWriter.characterContext).toBe(asCritic.characterContext);
    expect(asWriter.characterContext).toContain("Рин");
    expect(asWriter.povCharacterId).toBe(asCritic.povCharacterId);
    // Ссылки на источники — те же: отпечаток задачи 5 совпадёт.
    expect(asWriter.sourceRefs).toEqual(asCritic.sourceRefs);
  });

  it("граница исключающая: знание из поздней главы не попадает в раннюю", async () => {
    const rin = insertCharacter("Рин");
    const first = insertChapter(10, "Первая.");
    insertChapter(20, "Вторая.");
    const fourth = insertChapter(40, "Четвёртая.");
    const eighth = insertChapter(80, "Восьмая.");
    insertKnowledge(rin, first, "ЗНАНИЕ_ИЗ_ПЕРВОЙ");
    insertKnowledge(rin, eighth, "СЕКРЕТ_ИЗ_ВОСЬМОЙ");

    const ctx = await assemble(fourth);
    expect(ctx.characterContext).toContain("ЗНАНИЕ_ИЗ_ПЕРВОЙ");
    expect(ctx.characterContext).not.toContain("СЕКРЕТ_ИЗ_ВОСЬМОЙ");
    // И в ссылках на источники — только то, что реально вошло.
    const eventIds = ctx.sourceRefs.filter((r) => r.kind === "event").map((r) => r.id);
    expect(eventIds).toHaveLength(1);
  });

  it("два героя с одним именем — неоднозначность, а не выбор первого", async () => {
    insertCharacter("Рин");
    insertCharacter("Рин");
    const ch = insertChapter(10, "Глава.");
    const ctx = await assemble(ch, { povName: "Рин" });
    expect(ctx.povCharacterId).toBeNull();
    expect(ctx.ambiguousNames).toEqual(["Рин"]);
    // Имя из плана остаётся как есть — подменять его нечем.
    expect(ctx.pov).toBe("Рин");
  });

  it("неизвестное имя POV — не неоднозначность", async () => {
    insertCharacter("Рин");
    const ch = insertChapter(10, "Глава.");
    const ctx = await assemble(ch, { povName: "Никто" });
    expect(ctx.povCharacterId).toBeNull();
    expect(ctx.ambiguousNames).toEqual([]);
  });

  it("ссылки на источники называют версии глав и ревизии героев", async () => {
    const rin = insertCharacter("Рин");
    sqlite.prepare("UPDATE characters SET revision = 3 WHERE id = ?").run(rin);
    const first = insertChapter(10, "Первая.");
    const v1 = Number(
      (sqlite.prepare("SELECT current_version_id v FROM chapters WHERE id = ?").get(first) as { v: number }).v,
    );
    const second = insertChapter(20, "Вторая.");

    const ctx = await assemble(second);
    expect(ctx.sourceRefs).toContainEqual({ kind: "chapter_version", id: first, versionId: v1, revision: null });
    expect(ctx.sourceRefs).toContainEqual({ kind: "character", id: rin, versionId: null, revision: 3 });

    // Новая принятая версия первой главы меняет ссылку — и только её.
    const v2 = commitVersion(first, "Первая, переписанная.");
    const after = await assemble(second);
    expect(after.sourceRefs).toContainEqual({ kind: "chapter_version", id: first, versionId: v2, revision: null });
    expect(after.sourceRefs.filter((r) => r.kind === "chapter_version")).toHaveLength(1);
  });

  it("AC-15: стилевые образцы одни и те же на одних входах", async () => {
    const profileId = Number(
      sqlite
        .prepare(
          `INSERT INTO style_profiles (name, kind, fingerprint_json, created_at, updated_at)
           VALUES ('Стиль', 'extracted', NULL, ?, ?)`,
        )
        .run(NOW, NOW).lastInsertRowid,
    );
    const corpusId = Number(
      sqlite
        .prepare(
          `INSERT INTO reference_corpora
             (profile_id, filename, format, raw_text, char_count, scene_count, created_at)
           VALUES (?, 'корпус.txt', 'txt', 'текст', 5, 8, ?)`,
        )
        .run(profileId, NOW).lastInsertRowid,
    );
    for (let i = 1; i <= 8; i += 1) {
      sqlite
        .prepare(
          `INSERT INTO reference_scenes (corpus_id, order_index, text, char_count, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(corpusId, i, `Образец ${i}.`, 10, NOW);
    }
    sqlite.prepare("UPDATE books SET style_profile_id = ? WHERE id = ?").run(profileId, bookId);
    insertCharacter("Рин");
    const ch = insertChapter(10, "Глава.");

    const a = await assemble(ch);
    const b = await assemble(ch);
    expect(a.styleContext.prompt).not.toBeNull();
    expect(a.styleContext.prompt).toBe(b.styleContext.prompt);
    expect(a.sourceRefs).toContainEqual({ kind: "style_profile", id: profileId, versionId: null, revision: null });
  });

  it("при тесном бюджете обязательный слой остаётся, а переполнение видно", async () => {
    insertCharacter("Рин");
    insertChapter(10, "Первая длинная глава. ".repeat(200));
    const second = insertChapter(20, "Вторая.");
    const ctx = await assemble(second, { budgetTokens: 5 });
    expect(ctx.compiled.requiredOverflow).toBe(true);
    expect(ctx.characterContext).not.toBeNull();
    expect(ctx.previousTail).toBeNull();
    expect(ctx.previousChapters).toBeNull();
  });
});

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
    // Ссылки на источники — те же: отпечаток совпадёт.
    expect(asWriter.sourceRefs).toEqual(asCritic.sourceRefs);
  });

  it("разные карточки при той же базе не меняют набор источников", async () => {
    // Writer сканирует план, критика — текст главы. Глава ввела героя,
    // которого в плане не было: карточки разные, база та же. Отпечаток по
    // карточкам кричал бы «база уехала» на каждой второй главе.
    insertCharacter("Рин");
    insertCharacter("Сарек");
    insertChapter(10, "Первая.");
    const second = insertChapter(20, "Вторая.");

    const asWriter = await assemble(second, { scanTexts: ["план: Рин ждёт"] });
    const asCritic = await assemble(second, { scanTexts: ["текст: Рин ждёт, Сарек входит"] });

    expect(asWriter.characterContext).not.toContain("Сарек");
    expect(asCritic.characterContext).toContain("Сарек");
    expect(asWriter.sourceRefs).toEqual(asCritic.sourceRefs);
    expect(asWriter.sourceRefs.filter((r) => r.kind === "character")).toHaveLength(2);
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
    // И в ссылках на источники — только события до границы: секрет из
    // восьмой не должен менять отпечаток четвёртой.
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

/** В7 независимого ревью 2026-09-19: факты и заметки читались ВКЛЮЧАЮЩЕ по
 *  номеру самой главы. У главы с уже принятой версией это значит, что в
 *  промпт её же перегенерации возвращаются факты, извлечённые из версии,
 *  которую автор как раз выбрасывает. Извлекатели ту же границу считают
 *  исключающей — расхождение было и в комментарии маршрута. */
describe("граница фактов (В7)", () => {
  function seedFact(order: number, name: string, object: string): void {
    sqlite
      .prepare(
        `INSERT INTO book_facts
           (book_id, entity_type, entity_name, predicate, object_text,
            valid_from_chapter, valid_to_chapter, source_version_id, confidence,
            origin, assertion_mode, created_at)
         VALUES (?, 'character', ?, 'состояние', ?, ?, NULL, NULL, 0.9, 'extracted', 'narrated_as_fact', ?)`,
      )
      .run(bookId, name, object, order, NOW);
  }

  it("Писатель не получает фактов из версии главы, которую переписывает", async () => {
    insertCharacter("Рин");
    insertChapter(10, "Первая глава. Рин у ручья.");
    const second = insertChapter(20, "Вторая глава. Рин в лесу.");
    seedFact(10, "Рин", "цела");
    seedFact(20, "Рин", "ранена в отброшенной версии");

    const forWriter = await assemble(second, { factsBoundary: "before_chapter" });
    expect(forWriter.characterContext).toContain("цела");
    expect(forWriter.characterContext).not.toContain("ранена в отброшенной версии");
  });

  it("критика по-прежнему видит факты своей главы: их она и проверяет", async () => {
    insertCharacter("Рин");
    insertChapter(10, "Первая глава. Рин у ручья.");
    const second = insertChapter(20, "Вторая глава. Рин в лесу.");
    seedFact(20, "Рин", "ранена");

    const forCritic = await assemble(second);
    expect(forCritic.characterContext).toContain("ранена");
  });
});

describe("состав сцены (С1) и приоритеты бюджета (С6)", () => {
  it("герой из аутлайна и пересказов не становится участником сцены", async () => {
    insertCharacter("Рин");
    insertCharacter("Кассий");
    // Кассий действует в первой главе и назван в плане книги, но в этой
    // сцене его нет. Прежде карточки собирались сканированием аутлайна и
    // всех пересказов — и в обязательный слой попадала почти вся книга.
    insertChapter(10, "Первая глава. Кассий у ворот.");
    insertChapter(20, "Вторая. Рин идёт.");
    const third = insertChapter(30, "Третья.");
    sqlite
      .prepare("UPDATE books SET outline_json = ? WHERE id = ?")
      .run(
        JSON.stringify({
          variants: [
            {
              id: "v1",
              logline: "Кассий предаёт Рин",
              synopsis: "Кассий и Рин идут через горы",
              selected: true,
            },
          ],
          selectedVariantId: "v1",
        }),
        bookId,
      );

    const ctx = await assemble(third, { scanTexts: ["беат-лист: Рин у ручья"] });

    expect(ctx.characterContext).toContain("Рин");
    expect(ctx.characterContext ?? "").not.toContain("Кассий");
  });

  it("поиск и стиль вытесняются позже принятых разделов Мастерской", async () => {
    insertCharacter("Рин");
    const first = insertChapter(10, "Первая глава. Рин у ручья.");
    expect(first).toBeGreaterThan(0);
    const second = insertChapter(20, "Вторая.");

    const ctx = await assemble(second, { budgetTokens: 400 });

    // Мир и лор — фон; поиск по прошлым главам и стиль держат
    // непротиворечивость и голос, и уходить первыми должны не они.
    const order = ctx.compiled.includedIds;
    expect(order.includes("studio") && !order.includes("style")).toBe(false);
  });
});


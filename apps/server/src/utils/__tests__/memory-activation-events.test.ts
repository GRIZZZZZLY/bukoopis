import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { MEMORY_PIPELINE_VERSION, COMMIT_JOB_KINDS } from "../memory-queue.js";
import { tryActivateMemoryVersion } from "../memory-activation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "activation-events-test-"));
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

function insertChapter(bookId: number, order: number): number {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(bookId, order, `Глава ${order}`, NOW, NOW).lastInsertRowid,
  );
}

function insertVersion(chapterId: number, contentText: string): number {
  return Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', ?, ?, ?)`,
      )
      .run(chapterId, contentText, contentText.split(/\s+/).length, NOW).lastInsertRowid,
  );
}

function insertCharacter(bookId: number, canonicalName: string): number {
  return Number(
    sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, revision, created_at, updated_at)
         VALUES (?, ?, '{}', 1, ?, ?)`,
      )
      .run(bookId, canonicalName, NOW, NOW).lastInsertRowid,
  );
}

function markVersionAsCurrent(chapterId: number, versionId: number): void {
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(versionId, chapterId);
}

function enqueueJob(
  bookId: number,
  chapterId: number,
  versionId: number,
  kind: string,
  resultJson: string | null,
  status: string = "done",
): void {
  sqlite
    .prepare(
      `INSERT INTO memory_jobs
         (book_id, chapter_id, chapter_version_id, kind, status, result_json, pipeline_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(bookId, chapterId, versionId, kind, status, resultJson, MEMORY_PIPELINE_VERSION, NOW, NOW);
}

function countEvents(): number {
  return (
    sqlite.prepare("SELECT COUNT(*) n FROM character_events").get() as { n: number }
  ).n;
}

function countFacts(): number {
  return (
    sqlite.prepare("SELECT COUNT(*) n FROM book_facts").get() as { n: number }
  ).n;
}

beforeEach(() => {
  open();
});

afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("memory activation with character events", () => {
  it("AC-22: события и факты активируются одной транзакцией", () => {
    // Если задание notes ещё не done, то ничего не должно активироваться.
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const contentText = "Рин молчала. Сарек вышел.";
    const vId = insertVersion(ch, contentText);
    markVersionAsCurrent(ch, vId);
    insertCharacter(b, "Рин");

    const factsResult = {
      factCount: 1,
      staged: {
        facts: [
          {
            entityType: "character",
            entityName: "Рин",
            predicate: "статус",
            objectText: "молчит",
            confidence: 1,
          },
        ],
        characterEvents: [
          {
            subjectName: "Рин",
            kind: "state",
            data: { state: "молчит", scope: "scene" },
            evidenceQuote: "молчала",
          },
        ],
      },
    };

    const notesResult = null; // notes не done, поэтому null

    enqueueJob(b, ch, vId, "index", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "summary", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "facts", JSON.stringify(factsResult), "done");
    enqueueJob(b, ch, vId, "notes", JSON.stringify(notesResult), "pending"); // ← не done

    const outcome = tryActivateMemoryVersion(sqlite, ch, vId);
    expect(outcome).toBe("pending");
    expect(countEvents()).toBe(0);
    expect(countFacts()).toBe(0);
  });

  it("AC-23: результат устаревшей версии не активируется", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const contentText = "Герой закрыл дверь первой версии.";
    const vId = insertVersion(ch, contentText);
    const otherVersionId = insertVersion(ch, "Текст второй версии.");

    insertCharacter(b, "Герой");

    markVersionAsCurrent(ch, otherVersionId); // ← текущая версия ДРУГАЯ

    // События здесь настоящие и с находимой цитатой: со списком `[]` проверка
    // «событий не появилось» держалась бы при любой реализации, включая ту,
    // что пишет их до проверки на устаревание.
    const factsResult = {
      factCount: 0,
      staged: {
        facts: [],
        characterEvents: [
          {
            subjectName: "Герой",
            kind: "state",
            data: { state: "закрыл дверь", scope: "scene" },
            evidenceQuote: "закрыл дверь",
          },
        ],
      },
    };
    const notesResult = { newCount: 0, resolvedCount: 0, staged: null };

    enqueueJob(b, ch, vId, "index", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "summary", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "facts", JSON.stringify(factsResult), "done");
    enqueueJob(b, ch, vId, "notes", JSON.stringify(notesResult), "done");

    const outcome = tryActivateMemoryVersion(sqlite, ch, vId);
    expect(outcome).toBe("obsolete");
    expect(countEvents()).toBe(0);
  });

  it("AC-25: событие с несошедшимся доказательством не активируется, остальные проходят", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const contentText = "Рин вышла. Сарек остался здесь.";
    const vId = insertVersion(ch, contentText);
    markVersionAsCurrent(ch, vId);

    const rinId = insertCharacter(b, "Рин");
    insertCharacter(b, "Сарек");

    const goodQuote = "Рин вышла";
    const badQuote = "квазар вышел"; // ← не в тексте

    const factsResult = {
      factCount: 2,
      staged: {
        facts: [
          {
            entityType: "character",
            entityName: "Рин",
            predicate: "статус",
            objectText: "вышла",
            confidence: 1,
          },
        ],
        characterEvents: [
          {
            subjectName: "Рин",
            kind: "state",
            data: { state: "уходит", scope: "scene" },
            evidenceQuote: goodQuote, // ← правильная цитата
          },
          {
            subjectName: "Сарек",
            kind: "knowledge",
            data: { fact: "Квазар вышел", acquisition: "told" },
            evidenceQuote: badQuote, // ← неправильная цитата → отвергнуто
          },
        ],
      },
    };
    const notesResult = { newCount: 0, resolvedCount: 0, staged: null };

    enqueueJob(b, ch, vId, "index", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "summary", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "facts", JSON.stringify(factsResult), "done");
    enqueueJob(b, ch, vId, "notes", JSON.stringify(notesResult), "done");

    const outcome = tryActivateMemoryVersion(sqlite, ch, vId);
    expect(outcome).toBe("activated");
    expect(countEvents()).toBe(1);

    const event = sqlite
      .prepare("SELECT evidence_quote FROM character_events")
      .get() as { evidence_quote: string };
    expect(event.evidence_quote).toBe(goodQuote);
  });

  it("AC-21: повторная активация той же версии не плодит событий", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const contentText = "Рин молчала молча.";
    const vId = insertVersion(ch, contentText);
    markVersionAsCurrent(ch, vId);

    insertCharacter(b, "Рин");

    const factsResult = {
      factCount: 1,
      staged: {
        facts: [],
        characterEvents: [
          {
            subjectName: "Рин",
            kind: "state",
            data: { state: "молчит", scope: "scene" },
            evidenceQuote: "молчала",
          },
        ],
      },
    };
    const notesResult = { newCount: 0, resolvedCount: 0, staged: null };

    enqueueJob(b, ch, vId, "index", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "summary", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "facts", JSON.stringify(factsResult), "done");
    enqueueJob(b, ch, vId, "notes", JSON.stringify(notesResult), "done");

    // Первая активация
    tryActivateMemoryVersion(sqlite, ch, vId);
    const firstCount = countEvents();
    expect(firstCount).toBeGreaterThan(0);

    // Сбрасываем memory_version_id, чтобы пройти путь активации ещё раз.
    sqlite.prepare("UPDATE chapters SET memory_version_id = NULL WHERE id = ?").run(ch);

    // Вторая активация той же версии
    tryActivateMemoryVersion(sqlite, ch, vId);
    const secondCount = countEvents();

    expect(secondCount).toBe(firstCount);
  });

  it("AC-22: падение ПОСЛЕ записи событий откатывает и их", () => {
    // Единственная проверка настоящего отката. Прежний тест AC-22 оставлял
    // задание notes в `pending`, то есть возвращался до открытия транзакции:
    // реализация, пишущая события отдельной транзакцией после успешной
    // активации, проходила бы его. Здесь событие уже вставлено, и следом
    // падает материализация заметок.
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const contentText = "Рин закрыла люк и села.";
    const vId = insertVersion(ch, contentText);
    markVersionAsCurrent(ch, vId);
    insertCharacter(b, "Рин");

    const factsResult = {
      factCount: 0,
      staged: {
        facts: [],
        characterEvents: [
          {
            subjectName: "Рин",
            kind: "state",
            data: { state: "закрыла люк", scope: "scene" },
            evidenceQuote: "закрыла люк",
          },
        ],
      },
    };
    // `embeddings` не массив: `.map` в активации бросит уже после вставки
    // событий. Испорченный result_json — реальный случай: он читается
    // `JSON.parse(...) as T`, без схемы.
    const notesResult = {
      newCount: 0,
      resolvedCount: 0,
      staged: { extraction: { newNotes: [], resolvedNoteIds: [] }, embeddings: null },
    };

    enqueueJob(b, ch, vId, "index", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "summary", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "facts", JSON.stringify(factsResult), "done");
    enqueueJob(b, ch, vId, "notes", JSON.stringify(notesResult), "done");

    expect(() => tryActivateMemoryVersion(sqlite, ch, vId)).toThrow();
    expect(countEvents()).toBe(0);
    const row = sqlite
      .prepare("SELECT memory_version_id FROM chapters WHERE id = ?")
      .get(ch) as { memory_version_id: number | null };
    expect(row.memory_version_id).toBeNull();
  });

  it("испорченный стадированный результат не бросает внутри транзакции", () => {
    // Бросок здесь теряет память всей версии молча и навсегда: задание к
    // этому моменту уже `done`, повторять активацию нечему.
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, "Рин закрыла люк и села.");
    markVersionAsCurrent(ch, vId);
    insertCharacter(b, "Рин");

    const factsResult = {
      factCount: 0,
      staged: {
        facts: [],
        characterEvents: [
          { subjectName: "Рин", kind: "state", data: {}, evidenceQuote: 42 },
          { subjectName: "Рин", kind: "state", data: {}, evidenceQuote: null },
        ],
      },
    };
    const notesResult = { newCount: 0, resolvedCount: 0, staged: null };

    enqueueJob(b, ch, vId, "index", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "summary", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "facts", JSON.stringify(factsResult), "done");
    enqueueJob(b, ch, vId, "notes", JSON.stringify(notesResult), "done");

    expect(tryActivateMemoryVersion(sqlite, ch, vId)).toBe("activated");
    expect(countEvents()).toBe(0);
  });

  it("characterEvents не массивом не бросает внутри транзакции", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, "Рин закрыла люк и села.");
    markVersionAsCurrent(ch, vId);

    // Строка правдиво отвечает на `.length`, поэтому прежняя проверка
    // пропускала её в `for…of`.
    const factsResult = {
      factCount: 0,
      staged: { facts: [], characterEvents: "не массив" },
    };
    const notesResult = { newCount: 0, resolvedCount: 0, staged: null };

    enqueueJob(b, ch, vId, "index", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "summary", JSON.stringify({}), "done");
    enqueueJob(b, ch, vId, "facts", JSON.stringify(factsResult), "done");
    enqueueJob(b, ch, vId, "notes", JSON.stringify(notesResult), "done");

    expect(tryActivateMemoryVersion(sqlite, ch, vId)).toBe("activated");
    expect(countEvents()).toBe(0);
  });
});

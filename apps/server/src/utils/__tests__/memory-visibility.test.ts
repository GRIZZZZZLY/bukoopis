import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { MEMORY_PIPELINE_VERSION } from "../memory-queue.js";
import {
  tryActivateMemoryVersion,
  chapterMemoryStatus,
  outdatedPipelineChapters,
  type StagedFactsResult,
} from "../memory-activation.js";

/**
 * Что автор может узнать о памяти главы. Разбор молчит четырьмя способами:
 * глава слишком коротка, строку ответа отвергла схема, событие не прижилось,
 * а вся книга разобрана прежней версией конвейера. Во всех четырёх случаях
 * экран показывал «память актуальна».
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;

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
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', ?, ?, ?)`,
      )
      .run(chapterId, contentText, contentText.split(/\s+/).length, NOW)
      .lastInsertRowid,
  );
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(id, chapterId);
  return id;
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

function enqueueJob(
  bookId: number,
  chapterId: number,
  versionId: number,
  kind: string,
  result: unknown,
  opts?: { status?: string; pipelineVersion?: number },
): void {
  sqlite
    .prepare(
      `INSERT INTO memory_jobs
         (book_id, chapter_id, chapter_version_id, kind, status, result_json,
          pipeline_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      bookId,
      chapterId,
      versionId,
      kind,
      opts?.status ?? "done",
      result === null ? null : JSON.stringify(result),
      opts?.pipelineVersion ?? MEMORY_PIPELINE_VERSION,
      NOW,
      NOW,
    );
}

function allCommitJobs(
  bookId: number,
  chapterId: number,
  versionId: number,
  factsResult: unknown,
  opts?: { pipelineVersion?: number },
): void {
  for (const kind of ["index", "summary", "notes"]) {
    enqueueJob(bookId, chapterId, versionId, kind, {}, opts);
  }
  enqueueJob(bookId, chapterId, versionId, "facts", factsResult, opts);
}

function chapterRow(chapterId: number): {
  current_version_id: number | null;
  memory_version_id: number | null;
} {
  return sqlite
    .prepare(
      "SELECT current_version_id, memory_version_id FROM chapters WHERE id = ?",
    )
    .get(chapterId) as {
    current_version_id: number | null;
    memory_version_id: number | null;
  };
}

function factsResultOf(versionId: number): StagedFactsResult {
  const row = sqlite
    .prepare(
      "SELECT result_json FROM memory_jobs WHERE chapter_version_id = ? AND kind = 'facts'",
    )
    .get(versionId) as { result_json: string };
  return JSON.parse(row.result_json) as StagedFactsResult;
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "memory-visibility-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
});

afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("что видно о памяти главы", () => {
  it("активация записывает, сколько событий легло и сколько отброшено", () => {
    const b = insertBook();
    const ch = insertChapter(b, 10);
    const v = insertVersion(ch, "Рин молчала. Сарек вышел.");
    insertCharacter(b, "Рин");

    allCommitJobs(b, ch, v, {
      factCount: 0,
      eventCount: 2,
      malformedEvents: 1,
      staged: {
        facts: [],
        characterEvents: [
          {
            subjectName: "Рин",
            kind: "state",
            data: { state: "молчит", scope: "scene" },
            evidenceQuote: "молчала",
          },
          // Цитаты нет в тексте версии — событие не прижилось.
          {
            subjectName: "Рин",
            kind: "state",
            data: { state: "бежит", scope: "scene" },
            evidenceQuote: "бежала по коридору",
          },
        ],
      },
    });

    expect(tryActivateMemoryVersion(sqlite, ch, v)).toBe("activated");

    // Задание к моменту активации уже `done`: без дозаписи эти числа не
    // сохранялись нигде и жили только в консоли сервера.
    const applied = factsResultOf(v).applied;
    expect(applied).toEqual({
      inserted: 1,
      duplicates: 0,
      rejectedEvidence: 1,
      unresolved: 0,
      superseded: 0,
    });

    const status = chapterMemoryStatus(sqlite, chapterRow(ch));
    expect(status.state).toBe("fresh");
    expect(status.events).toEqual(applied);
    expect(status.malformed).toBe(1);
  });

  it("пропуск короткой главы виден в статусе, а не только в result_json", () => {
    const b = insertBook();
    const ch = insertChapter(b, 10);
    const v = insertVersion(ch, "Две фразы.");
    allCommitJobs(b, ch, v, { factCount: 0, skipped: "short" });
    tryActivateMemoryVersion(sqlite, ch, v);

    const status = chapterMemoryStatus(sqlite, chapterRow(ch));
    // Пропуск засчитан как успех задания, поэтому состояние честно «свежая» —
    // и именно поэтому причина обязана ехать рядом.
    expect(status.state).toBe("fresh");
    expect(status.skipped).toBe("short");
    expect(status.events).toBeNull();
  });

  it("память, собранная прежней версией конвейера, помечена устаревшей", () => {
    const b = insertBook();
    const ch = insertChapter(b, 10);
    const v = insertVersion(ch, "Текст главы.");
    allCommitJobs(b, ch, v, { factCount: 0 }, { pipelineVersion: 1 });
    tryActivateMemoryVersion(sqlite, ch, v);

    const status = chapterMemoryStatus(sqlite, chapterRow(ch));
    expect(status.state).toBe("fresh");
    expect(status.pipelineVersion).toBe(1);
    expect(status.outdatedPipeline).toBe(true);
    expect(outdatedPipelineChapters(sqlite, b)).toBe(1);
  });

  it("разбор текущей версией устаревшим не считается", () => {
    const b = insertBook();
    const ch = insertChapter(b, 10);
    const v = insertVersion(ch, "Текст главы.");
    allCommitJobs(b, ch, v, { factCount: 0 });
    tryActivateMemoryVersion(sqlite, ch, v);

    const status = chapterMemoryStatus(sqlite, chapterRow(ch));
    expect(status.pipelineVersion).toBe(MEMORY_PIPELINE_VERSION);
    expect(status.outdatedPipeline).toBe(false);
    expect(outdatedPipelineChapters(sqlite, b)).toBe(0);
  });

  it("считаются главы книги, а не задания: перестроенная глава из счёта уходит", () => {
    const b = insertBook();
    const oldOne = insertChapter(b, 10);
    const vOld = insertVersion(oldOne, "Первая глава.");
    allCommitJobs(b, oldOne, vOld, { factCount: 0 }, { pipelineVersion: 1 });

    const rebuilt = insertChapter(b, 20);
    const vRebuilt = insertVersion(rebuilt, "Вторая глава.");
    // Перестроение оставляет у той же версии задание новой версии конвейера
    // рядом со старым — считать надо последнее, иначе счётчик никогда не
    // опустеет и баннер не исчезнет.
    allCommitJobs(b, rebuilt, vRebuilt, { factCount: 0 }, { pipelineVersion: 1 });
    enqueueJob(b, rebuilt, vRebuilt, "facts", { factCount: 0 });

    expect(outdatedPipelineChapters(sqlite, b)).toBe(1);
    expect(
      chapterMemoryStatus(sqlite, chapterRow(rebuilt)).outdatedPipeline,
    ).toBe(false);
  });

  it("глава без зафиксированной версии ничего не выдумывает", () => {
    const b = insertBook();
    const ch = insertChapter(b, 10);
    const status = chapterMemoryStatus(sqlite, chapterRow(ch));
    expect(status).toEqual({
      state: "none",
      memoryVersionId: null,
      pipelineVersion: null,
      outdatedPipeline: false,
      skipped: null,
      events: null,
      malformed: 0,
    });
    expect(outdatedPipelineChapters(sqlite, b)).toBe(0);
  });
});

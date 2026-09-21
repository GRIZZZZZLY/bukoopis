import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Извлекатели не зовутся по-настоящему: без заглушек воркер уходит в вызов
// модели с повторами, и `drain` ждёт его несколько секунд. Здесь они обязаны
// НЕ завершаться — тесты как раз про то, что происходит, пока память не
// собрана.
vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  summarizeChapter: vi.fn(async () => {
    throw new Error("извлекатель недоступен");
  }),
  extractCanonFacts: vi.fn(async () => {
    throw new Error("извлекатель недоступен");
  }),
  extractEpisodicNotes: vi.fn(async () => {
    throw new Error("извлекатель недоступен");
  }),
  metaSummarize: vi.fn(async () => {
    throw new Error("извлекатель недоступен");
  }),
}));

import { makeTestApp, send, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import {
  claimNextMemoryJob,
  isRetryableMemoryError,
  enqueueMemoryJobs,
  COMMIT_JOB_KINDS,
} from "../memory-queue.js";

/** Высокие дефекты независимого ревью 2026-09-19, слой памяти:
 *  В1 импортированные главы числились «память актуальна», не имея её;
 *  В3 поиск был заложником LLM-извлекателей, а одна упавшая задача
 *  останавливала факты всей книги; В4 удаление главы оставляло её факты
 *  каноном; В5 «Перестроить память» ничего не стирало. */

let t: TestApp;
let bookId: number;

const doc = (text: string): unknown => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Глава короче 80 слов пропускается извлекателями без вызова модели, и вся
 *  очередь завершается сама — тест на «поиск не ждёт извлекателей» прошёл бы
 *  вхолостую. Тексты здесь заведомо длиннее порога. */
const long = (marker: string): string =>
  `${marker} ` +
  Array.from(
    { length: 14 },
    (_, i) =>
      `Абзац номер ${i + 1}: смотритель поднимался по винтовой лестнице маяка и считал ступени, потому что счёт успокаивал его сильнее любых слов.`,
  ).join(" ");

async function chapter(title: string, body: string): Promise<number> {
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title },
  );
  await send(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
    contentJson: doc(body),
  });
  return ch.id;
}

const versionOf = (chapterId: number): number =>
  (
    t.sqlite
      .prepare("SELECT current_version_id v FROM chapters WHERE id = ?")
      .get(chapterId) as { v: number }
  ).v;

function seedFact(order: number, sourceVersionId: number | null, name: string): void {
  t.sqlite
    .prepare(
      `INSERT INTO book_facts
         (book_id, entity_type, entity_name, predicate, object_text,
          valid_from_chapter, valid_to_chapter, source_version_id, confidence,
          origin, assertion_mode, created_at)
       VALUES (?, 'character', ?, 'работа', 'смотритель', ?, NULL, ?, 0.9, 'extracted', 'narrated_as_fact', ?)`,
    )
    .run(bookId, name, order, sourceVersionId, new Date().toISOString());
}

function seedNote(order: number, sourceVersionId: number | null, title: string): void {
  t.sqlite
    .prepare(
      `INSERT INTO book_notes
         (book_id, kind, chapter_order_introduced, chapter_order_resolved,
          title, body, tags, related_note_ids, source_version_id, origin, created_at)
       VALUES (?, 'thread', ?, NULL, ?, 'тело', '[]', '[]', ?, 'extracted', ?)`,
    )
    .run(bookId, order, title, sourceVersionId, new Date().toISOString());
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Память",
    premise: "p",
  });
  bookId = b.id;
});
afterEach(() => t.cleanup());

describe("поиск не ждёт извлекателей (В3)", () => {
  it("глава находится сразу после индексации, без сводки, фактов и заметок", async () => {
    const ch = await chapter("Глава", long("АЛЬФАСЕКРЕТ"));
    // Только индексация — задания через модель не выполнялись вовсе.
    await t.memoryWorker.drain({ kinds: ["index"] });

    const found = await sendJson<{ hits: Array<{ chapterId: number }> }>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("АЛЬФАСЕКРЕТ")}`,
      "GET",
    );
    expect(found.hits.map((h) => h.chapterId)).toContain(ch);
  });
});

describe("очередь памяти (В3)", () => {
  it("задача, упавшая навсегда, не останавливает факты следующих глав", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    const second = await chapter("Вторая", long("ВТОРАЯ"));

    // Первая глава: разбор фактов упал окончательно.
    t.sqlite
      .prepare(
        "UPDATE memory_jobs SET status = 'error' WHERE chapter_version_id = ? AND kind = 'facts'",
      )
      .run(versionOf(first));
    // Остальные её задания уже доделаны — блокирует только упавшее.
    t.sqlite
      .prepare(
        "UPDATE memory_jobs SET status = 'done' WHERE chapter_version_id = ? AND kind <> 'facts'",
      )
      .run(versionOf(first));

    // Время в будущем: фоновой воркер уже отложил повтор второй главы на
    // несколько секунд вперёд, и без этого нечего было бы взять по другой
    // причине — не по той, которую проверяет тест.
    const claimed = claimNextMemoryJob(t.sqlite, {
      kinds: ["facts"],
      now: "2099-01-01T00:00:00.000Z",
    });
    expect(claimed).not.toBeNull();
    expect(claimed!.chapter_version_id).toBe(versionOf(second));
  });

  it("отказ авторизации не повторяется пять раз", () => {
    expect(isRetryableMemoryError({ status: 401, message: "invalid key" })).toBe(false);
    expect(isRetryableMemoryError({ status: 403, message: "forbidden" })).toBe(false);
    // Временные отказы по-прежнему повторяются.
    expect(isRetryableMemoryError({ status: 429 })).toBe(true);
    expect(isRetryableMemoryError({ status: 500 })).toBe(true);
  });
});

describe("импортированные главы (В1)", () => {
  it("получают задания памяти и не числятся разобранными", async () => {
    const res = await sendJson<{ created: Array<{ chapterId: number }> }>(
      t.app,
      `/api/books/${bookId}/import`,
      "POST",
      {
        filename: "roman.md",
        content: `# Глава первая\n\n${long("ПЕРВАЯ")}\n\n# Глава вторая\n\n${long("ВТОРАЯ")}`,
      },
    );
    expect(res.created).toHaveLength(2);
    const chapterId = res.created[0]!.chapterId;

    // Без `index`: чанки маршрут кладёт сам, синхронно, чтобы поиск видел
    // главы сразу, и второе задание `index` означало бы повторную индексацию
    // той же версии. `scene_state` — анкета непрерывности принесённой главы.
    const jobs = t.sqlite
      .prepare(
        `SELECT kind FROM memory_jobs WHERE chapter_version_id = ? ORDER BY kind`,
      )
      .all(versionOf(chapterId)) as Array<{ kind: string }>;
    expect(jobs.map((j) => j.kind)).toEqual([
      "facts",
      "notes",
      "scene_state",
      "summary",
    ]);
    expect(
      (
        t.sqlite
          .prepare("SELECT indexed_version_id v FROM chapters WHERE id = ?")
          .get(chapterId) as { v: number | null }
      ).v,
    ).toBe(versionOf(chapterId));

    const ch = await sendJson<{ memory: { state: string } }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.memory.state).not.toBe("fresh");
  });

  it("но находятся поиском сразу, не дожидаясь извлекателей", async () => {
    const res = await sendJson<{ created: Array<{ chapterId: number }> }>(
      t.app,
      `/api/books/${bookId}/import`,
      "POST",
      {
        filename: "roman.md",
        content: `# Глава первая\n\n${long("ОРИЕНТИР")}`,
      },
    );
    const found = await sendJson<{ hits: Array<{ chapterId: number }> }>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("ОРИЕНТИР")}`,
      "GET",
    );
    expect(found.hits.map((h) => h.chapterId)).toContain(res.created[0]!.chapterId);
  });
});

describe("удаление главы (В4)", () => {
  it("уносит её факты и заметки и называет их числом", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    const second = await chapter("Вторая", long("ВТОРАЯ"));
    seedFact(10, versionOf(first), "Анна");
    seedNote(10, versionOf(first), "Линия письма");
    seedFact(20, versionOf(second), "Борис");

    const res = await sendJson<{
      deletedFacts: number;
      deletedNotes: number;
    }>(t.app, `/api/chapters/${first}`, "DELETE");
    expect(res.deletedFacts).toBe(1);
    expect(res.deletedNotes).toBe(1);

    const left = t.sqlite
      .prepare("SELECT entity_name n FROM book_facts WHERE book_id = ?")
      .all(bookId) as Array<{ n: string }>;
    expect(left.map((f) => f.n)).toEqual(["Борис"]);
    expect(
      (t.sqlite.prepare("SELECT COUNT(*) c FROM book_notes WHERE book_id = ?").get(bookId) as { c: number }).c,
    ).toBe(0);
  });

  it("ручные записи автора не уносит", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    t.sqlite
      .prepare(
        `INSERT INTO book_facts
           (book_id, entity_type, entity_name, predicate, object_text,
            valid_from_chapter, valid_to_chapter, source_version_id, confidence,
            origin, assertion_mode, created_at)
         VALUES (?, 'character', 'Анна', 'рост', 'высокая', 10, NULL, ?, 1.0, 'manual', 'narrated_as_fact', ?)`,
      )
      .run(bookId, versionOf(first), new Date().toISOString());

    await send(t.app, `/api/chapters/${first}`, "DELETE");

    expect(
      (t.sqlite.prepare("SELECT COUNT(*) c FROM book_facts WHERE book_id = ?").get(bookId) as { c: number }).c,
    ).toBe(1);
  });
});

describe("перестроение памяти (В5)", () => {
  it("стирает извлечённое с указанной главы, прежде чем ставить задания заново", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    const second = await chapter("Вторая", long("ВТОРАЯ"));
    seedFact(10, versionOf(first), "Анна");
    seedFact(20, versionOf(second), "Борис");
    seedNote(20, versionOf(second), "Линия второй главы");
    t.sqlite
      .prepare(
        `INSERT INTO book_meta_summaries
           (book_id, covers_from_order, covers_to_order, summary_text, model_id, source_fingerprint, created_at)
         VALUES (?, 10, 20, 'сводка', 'test', 'fp', ?)`,
      )
      .run(bookId, new Date().toISOString());

    const res = await sendJson<{ enqueuedChapters: number }>(
      t.app,
      `/api/books/${bookId}/memory/rebuild`,
      "POST",
      { fromOrder: 20 },
    );
    expect(res.enqueuedChapters).toBe(1);

    const facts = t.sqlite
      .prepare("SELECT entity_name n FROM book_facts WHERE book_id = ?")
      .all(bookId) as Array<{ n: string }>;
    // Факт первой главы остаётся — перестраивают со второй.
    expect(facts.map((f) => f.n)).toEqual(["Анна"]);
    expect(
      (t.sqlite.prepare("SELECT COUNT(*) c FROM book_notes WHERE book_id = ?").get(bookId) as { c: number }).c,
    ).toBe(0);
    expect(
      (
        t.sqlite
          .prepare("SELECT COUNT(*) c FROM book_meta_summaries WHERE book_id = ?")
          .get(bookId) as { c: number }
      ).c,
    ).toBe(0);
  });

  it("ручные записи переживают перестроение", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    t.sqlite
      .prepare(
        `INSERT INTO book_facts
           (book_id, entity_type, entity_name, predicate, object_text,
            valid_from_chapter, valid_to_chapter, source_version_id, confidence,
            origin, assertion_mode, created_at)
         VALUES (?, 'character', 'Анна', 'рост', 'высокая', 10, NULL, ?, 1.0, 'manual', 'narrated_as_fact', ?)`,
      )
      .run(bookId, versionOf(first), new Date().toISOString());

    await send(t.app, `/api/books/${bookId}/memory/rebuild`, "POST", { fromOrder: 10 });

    expect(
      (t.sqlite.prepare("SELECT COUNT(*) c FROM book_facts WHERE book_id = ?").get(bookId) as { c: number }).c,
    ).toBe(1);
  });
});

describe("страховка очереди", () => {
  it("enqueueMemoryJobs остаётся идемпотентным", async () => {
    const ch = await chapter("Глава", long("ГЛАВА"));
    enqueueMemoryJobs(t.sqlite, {
      bookId,
      chapterId: ch,
      chapterVersionId: versionOf(ch),
      kinds: COMMIT_JOB_KINDS,
    });
    const jobs = t.sqlite
      .prepare(
        `SELECT COUNT(*) c FROM memory_jobs
         WHERE chapter_version_id = ? AND kind IN ('index','summary','facts','notes')`,
      )
      .get(versionOf(ch)) as { c: number };
    expect(jobs.c).toBe(4);
  });
});

/** Закрытый факт: предшественник + отменивший его, связанные `superseded_by`.
 *  Возвращает id предшественника. */
function seedSupersededPair(
  fromOrder: number,
  closedAt: number,
  laterOrder: number,
  sourceVersionId: number | null,
  origin: "extracted" | "manual" = "extracted",
): number {
  const now = new Date().toISOString();
  const later = Number(
    t.sqlite
      .prepare(
        `INSERT INTO book_facts
           (book_id, entity_type, entity_name, predicate, object_text,
            valid_from_chapter, valid_to_chapter, source_version_id, confidence,
            origin, assertion_mode, created_at)
         VALUES (?, 'character', 'Анна', 'местоположение', 'в столице', ?, NULL, ?, 0.9, 'extracted', 'narrated_as_fact', ?)`,
      )
      .run(bookId, laterOrder, sourceVersionId, now).lastInsertRowid,
  );
  const earlier = Number(
    t.sqlite
      .prepare(
        `INSERT INTO book_facts
           (book_id, entity_type, entity_name, predicate, object_text,
            valid_from_chapter, valid_to_chapter, source_version_id, confidence,
            origin, assertion_mode, created_at, superseded_by)
         VALUES (?, 'character', 'Анна', 'местоположение', 'в порту', ?, ?, NULL, 0.9, ?, 'narrated_as_fact', ?, ?)`,
      )
      .run(bookId, fromOrder, closedAt, origin, now, later).lastInsertRowid,
  );
  return earlier;
}

const factBounds = (factId: number): { to: number | null; by: number | null } => {
  const row = t.sqlite
    .prepare("SELECT valid_to_chapter t, superseded_by b FROM book_facts WHERE id = ?")
    .get(factId) as { t: number | null; b: number | null };
  return { to: row.t, by: row.b };
};

describe("перестроение и удаление открывают обратно только своё", () => {
  it("перестроение не реанимирует факт, закрытый не удаляемым", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    await chapter("Вторая", long("ВТОРАЯ"));
    // Факт закрыт вручную автором: отменившего нет, ссылки нет. Такой
    // интервал ставит и перестановка глав.
    const manual = Number(
      t.sqlite
        .prepare(
          `INSERT INTO book_facts
             (book_id, entity_type, entity_name, predicate, object_text,
              valid_from_chapter, valid_to_chapter, source_version_id, confidence,
              origin, assertion_mode, created_at)
           VALUES (?, 'character', 'Борис', 'звание', 'капитан', 10, 19, ?, 1.0, 'manual', 'narrated_as_fact', ?)`,
        )
        .run(bookId, versionOf(first), new Date().toISOString()).lastInsertRowid,
    );

    await send(t.app, `/api/books/${bookId}/memory/rebuild`, "POST", { fromOrder: 10 });

    expect(factBounds(manual).to).toBe(19);
  });

  it("перестроение открывает обратно факт, чей отменивший стёрт", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    await chapter("Вторая", long("ВТОРАЯ"));
    const earlier = seedSupersededPair(10, 19, 20, versionOf(first));

    await send(t.app, `/api/books/${bookId}/memory/rebuild`, "POST", { fromOrder: 20 });

    expect(factBounds(earlier)).toEqual({ to: null, by: null });
  });

  it("удаление главы открывает обратно факт, который её факт отменял", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    const second = await chapter("Вторая", long("ВТОРАЯ"));
    const earlier = seedSupersededPair(10, 19, 20, versionOf(second));

    await send(t.app, `/api/chapters/${second}`, "DELETE");

    expect(factBounds(earlier)).toEqual({ to: null, by: null });
    expect(first).toBeGreaterThan(0);
  });

  it("перестроение не открывает обратно авторскую нить", async () => {
    const first = await chapter("Первая", long("ПЕРВАЯ"));
    t.sqlite
      .prepare(
        `INSERT INTO book_notes
           (book_id, kind, chapter_order_introduced, chapter_order_resolved,
            title, body, tags, related_note_ids, source_version_id, origin, created_at)
         VALUES (?, 'thread', 10, 10, 'Авторская нить', 'тело', '[]', '[]', ?, 'manual', ?)`,
      )
      .run(bookId, versionOf(first), new Date().toISOString());

    await send(t.app, `/api/books/${bookId}/memory/rebuild`, "POST", { fromOrder: 10 });

    const row = t.sqlite
      .prepare("SELECT chapter_order_resolved r FROM book_notes WHERE book_id = ?")
      .get(bookId) as { r: number | null };
    expect(row.r).toBe(10);
  });
});

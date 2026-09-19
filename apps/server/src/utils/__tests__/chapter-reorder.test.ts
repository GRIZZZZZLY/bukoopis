import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";

/** К1 ревью 2026-09-19: порядок главы хранится копиями в пяти таблицах
 *  (`chunks.chapter_order`, `book_facts.valid_*`, `book_notes.chapter_order_*`,
 *  `book_meta_summaries.covers_*`, `character_voice_samples.source_chapter_order`),
 *  а перестановка меняла только `chapters.order_index`. После неё фильтр «по
 *  состоянию до главы N» сравнивал номера прошлой раскладки: текст главы,
 *  ставшей поздней, проходил в подготовку ранней. */

let t: TestApp;
let bookId: number;
let A: number;
let B: number;
let C: number;

const doc = (text: string): unknown => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const SECRET = "Письмо из будущего лежало под половицей маяка.";

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

function orderOf(chapterId: number): number {
  return (
    t.sqlite
      .prepare("SELECT order_index o FROM chapters WHERE id = ?")
      .get(chapterId) as { o: number }
  ).o;
}

/** Активация памяти без LLM: поиск отдаёт чанки только той версии, которая
 *  числится разобранной (ADR 0002, I2). */
function activateMemory(): void {
  t.sqlite
    .prepare(
      "UPDATE chapters SET memory_version_id = current_version_id WHERE book_id = ? AND current_version_id IS NOT NULL",
    )
    .run(bookId);
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Порядок",
    premise: "p",
  });
  bookId = b.id;
  A = await chapter("А", `${SECRET} Смотритель поднимался по лестнице и считал ступени.`);
  B = await chapter("Б", "Ветер бил в стёкла, лампа гудела, море внизу было чёрным.");
  C = await chapter("В", "Утро пришло серым и мокрым, чайки кричали над водой.");
  await t.memoryWorker.drain({ kinds: ["index"] });
  activateMemory();
});
afterEach(() => t.cleanup());

async function reorder(chapterIds: number[]): Promise<Response> {
  return send(t.app, `/api/books/${bookId}/chapters/reorder`, "POST", {
    chapterIds,
  });
}

describe("перестановка глав (К1)", () => {
  it("переносит чанки вместе с главой: поиск с границей не видит главу, ставшую поздней", async () => {
    const res = await reorder([B, C, A]);
    expect(res.status).toBe(200);
    expect([orderOf(B), orderOf(C), orderOf(A)]).toEqual([10, 20, 30]);

    // Граница подготовки главы «В» (она теперь вторая, order 20).
    const found = await sendJson<{ hits: Array<{ chapterId: number }> }>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("письмо из будущего")}&beforeChapter=19`,
      "GET",
    );
    expect(found.hits.map((h) => h.chapterId)).not.toContain(A);

    // И наоборот: на границе последней главы «А» она по-прежнему находится.
    const late = await sendJson<{ hits: Array<{ chapterId: number }> }>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("письмо из будущего")}&beforeChapter=30`,
      "GET",
    );
    expect(late.hits.map((h) => h.chapterId)).toContain(A);
  });

  it("переносит факты канона вместе с их главой", async () => {
    const versionOf = (id: number) =>
      (
        t.sqlite
          .prepare("SELECT current_version_id v FROM chapters WHERE id = ?")
          .get(id) as { v: number }
      ).v;
    t.sqlite
      .prepare(
        `INSERT INTO book_facts
           (book_id, entity_type, entity_name, predicate, object_text,
            valid_from_chapter, valid_to_chapter, source_version_id, confidence,
            assertion_mode, created_at)
         VALUES (?, 'character', 'Анна', 'работа', 'смотритель маяка', 10, NULL, ?, 0.9, 'narrated_as_fact', ?)`,
      )
      .run(bookId, versionOf(A), new Date().toISOString());

    expect((await reorder([B, C, A])).status).toBe(200);

    const fact = t.sqlite
      .prepare("SELECT valid_from_chapter f FROM book_facts WHERE book_id = ?")
      .get(bookId) as { f: number };
    // «А» уехала в конец: факт действует с третьей главы, а не с первой.
    expect(fact.f).toBe(30);
    expect(fact.f).toBe(orderOf(A));
  });

  it("переносит заметки вместе с их главой", async () => {
    t.sqlite
      .prepare(
        `INSERT INTO book_notes
           (book_id, kind, chapter_order_introduced, chapter_order_resolved,
            title, body, tags, related_note_ids, created_at)
         VALUES (?, 'thread', 10, 30, 'Письмо', 'Линия письма', '[]', '[]', ?)`,
      )
      .run(bookId, new Date().toISOString());

    // «Б» уходит вперёд, взаимный порядок «А» и «В» сохраняется.
    expect((await reorder([B, A, C])).status).toBe(200);

    const note = t.sqlite
      .prepare(
        "SELECT chapter_order_introduced i, chapter_order_resolved r FROM book_notes WHERE book_id = ?",
      )
      .get(bookId) as { i: number; r: number };
    // Введена в главе «А» (была 10, стала 20), закрыта в «В» (осталась 30).
    expect([note.i, note.r]).toEqual([20, 30]);
    expect(note.i).toBe(orderOf(A));
    expect(note.r).toBe(orderOf(C));
  });

  it("не растягивает отменённый факт на всю книгу, если ссылки на отменивший нет", async () => {
    // Факт жил в главе «А» (10) и был закрыт перед главой «Б» (20), но ссылки
    // на отменивший факт у строки нет — такие приезжают из переносов. «Б»
    // уезжает в конец: растянуть факт до неё значило бы вернуть в канон то,
    // что отменено, — ровно та утечка, ради которой затеян К1.
    t.sqlite
      .prepare(
        `INSERT INTO book_facts
           (book_id, entity_type, entity_name, predicate, object_text,
            valid_from_chapter, valid_to_chapter, source_version_id, confidence,
            assertion_mode, created_at)
         VALUES (?, 'character', 'Анна', 'жильё', 'башня маяка', 10, 29, NULL, 0.9, 'narrated_as_fact', ?)`,
      )
      .run(bookId, new Date().toISOString());

    // Интервал покрывал «А» (10) и «Б» (20) и кончался до «В» (30). После
    // перестановки «В» встаёт между ними: натянуть интервал до «Б» значит
    // вернуть отменённый факт в главу, где его не было.
    expect((await reorder([A, C, B])).status).toBe(200);

    const fact = t.sqlite
      .prepare(
        "SELECT valid_from_chapter f, valid_to_chapter t FROM book_facts WHERE book_id = ?",
      )
      .get(bookId) as { f: number; t: number };
    expect(fact.t).toBeGreaterThanOrEqual(fact.f);
    expect(fact.t).toBeLessThan(orderOf(C));
  });

  it("не оставляет заметку закрытой раньше, чем она введена", async () => {
    t.sqlite
      .prepare(
        `INSERT INTO book_notes
           (book_id, kind, chapter_order_introduced, chapter_order_resolved,
            title, body, tags, related_note_ids, created_at)
         VALUES (?, 'thread', 10, 20, 'Линия', 'тело', '[]', '[]', ?)`,
      )
      .run(bookId, new Date().toISOString());

    // «А» уезжает в конец, «Б» становится первой: нить, открытая в «А» и
    // закрытая в «Б», после перестановки закрывалась бы до своего начала.
    expect((await reorder([B, C, A])).status).toBe(200);

    const note = t.sqlite
      .prepare(
        "SELECT chapter_order_introduced i, chapter_order_resolved r FROM book_notes WHERE book_id = ?",
      )
      .get(bookId) as { i: number; r: number | null };
    expect(note.r).not.toBeNull();
    expect(note.r!).toBeGreaterThanOrEqual(note.i);
  });

  it("переносит ожидаемую главу закрытия крючка", async () => {
    t.sqlite
      .prepare(
        `INSERT INTO hooks
           (book_id, seed_chapter_id, description, status, expected_resolution_chapter_order, created_at, updated_at)
         VALUES (?, ?, 'Письмо не прочитано', 'open', 30, ?, ?)`,
      )
      .run(bookId, A, new Date().toISOString(), new Date().toISOString());

    expect((await reorder([B, C, A])).status).toBe(200);

    const hook = t.sqlite
      .prepare("SELECT expected_resolution_chapter_order e FROM hooks WHERE book_id = ?")
      .get(bookId) as { e: number };
    // Крючок ждал развязки в главе «В» (была 30, стала 20).
    expect(hook.e).toBe(orderOf(C));
  });

  it("помечает память книги устаревшей с самой ранней сдвинувшейся главы", async () => {
    await reorder([B, C, A]);
    const book = t.sqlite
      .prepare("SELECT memory_stale_from_chapter_order s FROM books WHERE id = ?")
      .get(bookId) as { s: number | null };
    expect(book.s).toBe(10);
  });

  it("отвергает список, в котором не все главы книги", async () => {
    const res = await reorder([B, A]);
    expect(res.status).toBe(400);
    expect([orderOf(A), orderOf(B), orderOf(C)]).toEqual([10, 20, 30]);
  });

  it("перестановка того же порядка ничего не ломает и памяти не трогает", async () => {
    const res = await reorder([A, B, C]);
    expect(res.status).toBe(200);
    expect([orderOf(A), orderOf(B), orderOf(C)]).toEqual([10, 20, 30]);
    const book = t.sqlite
      .prepare("SELECT memory_stale_from_chapter_order s FROM books WHERE id = ?")
      .get(bookId) as { s: number | null };
    expect(book.s).toBeNull();
  });
});

describe("PATCH /chapters/:id (К1)", () => {
  it("больше не двигает порядок глав: для этого есть перестановка", async () => {
    const res = await send(t.app, `/api/chapters/${A}`, "PATCH", {
      orderIndex: 999,
    });
    expect(res.status).toBe(400);
    expect(orderOf(A)).toBe(10);
  });

  it("переименование по-прежнему работает", async () => {
    const res = await send(t.app, `/api/chapters/${A}`, "PATCH", {
      title: "Новое имя",
    });
    expect(res.status).toBe(200);
  });
});

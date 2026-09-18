import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { boundaryForChapter } from "@book-forge/shared";
import { makeTestApp, sendJson, type TestApp } from "./_helpers.js";
import {
  loadKnowledgeAtBoundary,
  loadEventsAtBoundary,
} from "../../utils/character-events.js";

let t: TestApp;
let bookId: number;
let rinId: number;
const chapterIds = new Map<number, number>(); // order_index → chapters.id

/** Глава без текста: границе версия не нужна, знания считаются по событиям. */
function makeChapter(order: number, title: string): number {
  const now = new Date().toISOString();
  const info = t.sqlite
    .prepare(
      `INSERT INTO chapters (book_id, title, order_index, status, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`,
    )
    .run(bookId, title, order, now, now);
  const id = Number(info.lastInsertRowid);
  chapterIds.set(order, id);
  return id;
}

function addEvent(args: {
  kind: string;
  data: unknown;
  chapterOrder: number | null;
  verification?: string;
  origin?: string;
}): void {
  const now = new Date().toISOString();
  t.sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)`,
    )
    .run(
      bookId,
      rinId,
      args.kind,
      JSON.stringify(args.data),
      args.chapterOrder === null ? null : chapterIds.get(args.chapterOrder),
      args.origin ?? "llm",
      args.verification ?? "derived",
      `k:${Math.random()}`,
      now,
    );
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  chapterIds.clear();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Границы" });
  bookId = b.id;
  const c = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  rinId = c.id;
  for (const o of [1, 2, 3, 4, 8, 9]) makeChapter(o, `Глава ${o}`);

  addEvent({ kind: "knowledge", chapterOrder: 2, data: { fact: "Станцию закрывают", acquisition: "told" } });
  addEvent({ kind: "knowledge", chapterOrder: 8, data: { fact: "Сарек — брат Селены", acquisition: "observed" } });
  addEvent({ kind: "knowledge", chapterOrder: 8, data: { fact: "Сарек погиб", acquisition: "told" } });
  addEvent({
    kind: "relation_shift",
    chapterOrder: 2,
    verification: "proposed",
    data: { quality: "доверие", from: "верит", to: "не верит" },
  });
});
afterEach(() => t.cleanup());

describe("character knowledge boundary", () => {
  it("AC-07: секрет из главы 8 не виден при подготовке главы 4", () => {
    // Событие знания записано на главу 8; граница — начало главы 4.
    const ch4Id = chapterIds.get(4)!;
    const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch4Id, null));
    expect(known.map((k) => (k.data as { fact: string }).fact)).not.toContain("Сарек — брат Селены");
  });

  it("знание из главы 2 видно при подготовке главы 4", () => {
    const ch4Id = chapterIds.get(4)!;
    const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch4Id, null));
    expect(known.map((k) => (k.data as { fact: string }).fact)).toContain("Станцию закрывают");
  });

  it("знание, полученное в САМОЙ главе, в её начальный контекст не входит", () => {
    // Граница исключающая: начало сцены строится из событий ДО неё (раздел 7).
    const ch2Id = chapterIds.get(2)!;
    const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch2Id, null));
    expect(known.map((k) => (k.data as { fact: string }).fact)).not.toContain("Станцию закрывают");
  });

  it("AC-33: флешбэк с явной ранней границей не получает поздних знаний", () => {
    const ch1Id = chapterIds.get(1)!;
    const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch1Id, null));
    expect(known).toHaveLength(0);
  });

  it("AC-26: гипотеза в контекст не попадает", () => {
    // relation_shift активируется как `proposed` и активным знанием не является.
    const ch9Id = chapterIds.get(9)!;
    const events = loadEventsAtBoundary(t.sqlite, [rinId], boundaryForChapter(bookId, ch9Id, null));
    expect(events.every((e) => e.verification !== "proposed")).toBe(true);
  });

  it("AC-09: услышанная ложь остаётся знанием героя и не становится фактом книги", () => {
    const ch9Id = chapterIds.get(9)!;
    const known = loadKnowledgeAtBoundary(t.sqlite, rinId, boundaryForChapter(bookId, ch9Id, null));
    const lie = known.find((k) => (k.data as { fact: string }).fact === "Сарек погиб");
    expect((lie?.data as { acquisition: string } | undefined)?.acquisition).toBe("told");
    // Прежде здесь стояла проверка `COUNT(*) FROM book_facts = 0`. Упасть она
    // не могла: ни фикстура, ни проверяемый код в эту таблицу не пишут.
    // Настоящее разделение «знание героя против факта книги» держит
    // `acquisition` выше и промпт POV, где услышанное подписано услышанным.
  });

  it("перенесённое ручное знание без главы видно на любой границе", () => {
    // У миграционных строк `chapter_id` может быть NULL: автор не указал главу.
    // Скрыть их было бы потерей авторских сведений (INV-07).
    addEvent({
      kind: "knowledge",
      chapterOrder: null,
      origin: "migration",
      verification: "confirmed",
      data: { fact: "Боится замкнутых пространств", acquisition: "observed" },
    });
    const ch1Id = chapterIds.get(1)!;
    const known = loadKnowledgeAtBoundary(
      t.sqlite,
      rinId,
      boundaryForChapter(bookId, ch1Id, null),
    );
    expect(known.map((k) => (k.data as { fact: string }).fact)).toContain(
      "Боится замкнутых пространств",
    );
  });

  it("AC-24: перестановка глав сразу меняет то, что видно на границе", () => {
    // Знание записано на главу 8 и на границе главы 4 невидимо.
    const at4 = () =>
      loadKnowledgeAtBoundary(
        t.sqlite,
        rinId,
        boundaryForChapter(bookId, chapterIds.get(4)!, null),
      ).map((k) => (k.data as { fact: string }).fact);
    expect(at4()).not.toContain("Сарек — брат Селены");

    // Автор переставил главы: бывшая восьмая стала первой.
    t.sqlite
      .prepare("UPDATE chapters SET order_index = 0 WHERE id = ?")
      .run(chapterIds.get(8)!);

    // Порядок берётся join'ом к `chapters`, а не денормализованной копией,
    // поэтому граница верна сразу. С денормализованным номером она осталась бы
    // тихо неверной до следующего пересчёта — и заметить это было бы нечем.
    expect(at4()).toContain("Сарек — брат Селены");
  });

  it("удаление главы уносит её знания, а не открывает их раньше времени", () => {
    // `chapter_id` пустой значит «известно с начала» и видно на любой
    // границе. С `ON DELETE SET NULL` удаление восьмой главы превращало бы
    // её секрет ровно в такую запись, и он всплывал бы на границе четвёртой.
    const at4 = () =>
      loadKnowledgeAtBoundary(
        t.sqlite,
        rinId,
        boundaryForChapter(bookId, chapterIds.get(4)!, null),
      ).map((k) => (k.data as { fact: string }).fact);
    expect(at4()).not.toContain("Сарек — брат Селены");

    t.sqlite.prepare("DELETE FROM chapters WHERE id = ?").run(chapterIds.get(8)!);

    expect(at4()).not.toContain("Сарек — брат Селены");
    const orphans = t.sqlite
      .prepare("SELECT COUNT(*) c FROM character_events WHERE chapter_id IS NULL")
      .get() as { c: number };
    expect(orphans.c).toBe(0);
  });

  it("не-знание на границу знаний не выдаётся", () => {
    // Состояние и обязательство лежат в той же таблице и проходят тот же
    // фильтр по статусу. Без проверки вида они приехали бы в список знаний
    // героя, и Писатель прочитал бы «устала» как факт, который она знает.
    addEvent({
      kind: "state",
      chapterOrder: 1,
      verification: "confirmed",
      data: { state: "смертельно устала", scope: "chapter" },
    });
    addEvent({
      kind: "commitment",
      chapterOrder: 1,
      verification: "confirmed",
      data: { commitment: "вернуться за Сареком", toWhom: "Селена" },
    });

    const boundary = boundaryForChapter(bookId, chapterIds.get(4)!, null);
    const knowledge = loadKnowledgeAtBoundary(t.sqlite, rinId, boundary);
    expect(knowledge.every((e) => e.kind === "knowledge")).toBe(true);

    // Но на общей границе событий они есть — иначе проверка выше проходила бы
    // и на реализации, которая их просто не записала.
    const all = loadEventsAtBoundary(t.sqlite, [rinId], boundary).map((e) => e.kind);
    expect(all).toContain("state");
    expect(all).toContain("commitment");
  });

  it("опровергнутое к этой главе знание не возвращается", () => {
    addEvent({
      kind: "knowledge",
      chapterOrder: 1,
      verification: "confirmed",
      data: {
        fact: "Селена мертва",
        acquisition: "told",
        disprovedFromChapterOrder: 3,
      },
    });
    const at = (order: number) =>
      loadKnowledgeAtBoundary(
        t.sqlite,
        rinId,
        boundaryForChapter(bookId, chapterIds.get(order)!, null),
      ).map((k) => (k.data as { fact: string }).fact);

    // До третьей главы герой ещё верит.
    expect(at(2)).toContain("Селена мертва");
    // С третьей — уже нет, и на границе четвёртой этого знания нет.
    expect(at(4)).not.toContain("Селена мертва");
  });
});

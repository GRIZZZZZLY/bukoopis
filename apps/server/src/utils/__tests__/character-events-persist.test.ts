import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTestApp,
  sendJson,
  type TestApp,
} from "../../routes/__tests__/_helpers.js";
import { persistCharacterEvents, dedupKeyFor } from "../character-events.js";
import type { ExtractedCharacterEvent } from "@book-forge/shared";

/**
 * Проверки самой записи, а не её кирпичей: `verifyEvidence` и `dedupKeyFor`
 * покрыты отдельно, а здесь проверяется, что они соединены правильно —
 * отказ по доказательству, неразрешённое имя, повтор и адресат в ключе.
 * Без этого файла первый отказ всплыл бы на задаче 7, далеко от причины.
 */

const TEXT = "Рин молчала. — Станцию закрывают, — сказал Сарек. Она кивнула.";
const QUOTE = "— Станцию закрывают";
const START = TEXT.indexOf(QUOTE);

let t: TestApp;
let bookId: number;
let subjectId: number;
let chapterId: number;
let versionId: number;

function makeCharacter(name: string): Promise<{ id: number }> {
  return sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/characters`,
    "POST",
    { canonicalName: name, profile: { description: "Герой." } },
  );
}

function event(
  over: Partial<ExtractedCharacterEvent> = {},
): ExtractedCharacterEvent {
  return {
    subjectName: "Рин",
    kind: "knowledge",
    data: { fact: "Станцию закрывают", acquisition: "told" },
    evidenceQuote: QUOTE,
    ...over,
  };
}

function persist(events: ExtractedCharacterEvent[], extractorVersion = 1) {
  return persistCharacterEvents(t.sqlite, {
    bookId,
    chapterId,
    sourceVersionId: versionId,
    events,
    extractorVersion,
  });
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();

  // Идентификаторы нарочно разводятся, и разным числом пустышек на таблицу:
  // в свежей базе книга, герой, глава и версия все получили бы id 1, и
  // перестановка двух колонок в INSERT на шестнадцать плейсхолдеров прошла
  // бы незамеченной. Равное число пустышек снова сделало бы их равными.
  const decoy = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Пустышка",
  });
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Запись событий",
  });
  bookId = b.id;

  await makeCharacter("Первый лишний");
  await makeCharacter("Второй лишний");
  const subject = await makeCharacter("Рин");
  subjectId = subject.id;

  const now = new Date().toISOString();
  const insertChapter = t.sqlite.prepare(
    `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
     VALUES (?, 10, 'Глава', 'draft', ?, ?)`,
  );
  for (let i = 0; i < 3; i += 1) insertChapter.run(decoy.id, now, now);
  chapterId = Number(insertChapter.run(bookId, now, now).lastInsertRowid);

  const insertVersion = t.sqlite.prepare(
    `INSERT INTO chapter_versions
       (chapter_id, content_json, content_text, word_count, source, created_at)
     VALUES (?, '{}', ?, 10, 'manual', ?)`,
  );
  for (let i = 0; i < 4; i += 1) insertVersion.run(chapterId, "Другой текст.", now);
  versionId = Number(insertVersion.run(chapterId, TEXT, now).lastInsertRowid);

  expect(new Set([bookId, subjectId, chapterId, versionId]).size).toBe(4);
});
afterEach(() => t.cleanup());

describe("persistCharacterEvents", () => {
  it("событие с сошедшимся доказательством записывается", () => {
    const out = persist([event()]);
    expect(out).toEqual({
      inserted: 1,
      rejectedEvidence: 0,
      unresolved: 0,
      duplicates: 0,
    });
    const row = t.sqlite
      .prepare("SELECT * FROM character_events")
      .get() as Record<string, unknown>;
    expect(row.book_id).toBe(bookId);
    expect(row.subject_character_id).toBe(subjectId);
    expect(row.addressee_character_id).toBe(null);
    expect(row.chapter_id).toBe(chapterId);
    expect(row.source_version_id).toBe(versionId);
    expect(row.scene_ordinal).toBe(0);
    expect(row.origin).toBe("llm");
    expect(row.verification).toBe("derived");
    expect(row.evidence_quote).toBe(QUOTE);
    expect(row.evidence_start).toBe(START);
    expect(row.evidence_end).toBe(START + QUOTE.length);
    expect(JSON.parse(row.data_json as string).fact).toBe("Станцию закрывают");
    expect(row.dedup_key).toBe(
      dedupKeyFor("knowledge", { fact: "Станцию закрывают", acquisition: "told" }),
    );
  });

  it("AC-25: пересказ вместо цитаты не записывается вовсе", () => {
    const out = persist([event({ evidenceQuote: "Станцию собирались закрыть" })]);
    expect(out.rejectedEvidence).toBe(1);
    expect(out.inserted).toBe(0);
    const c = t.sqlite
      .prepare("SELECT COUNT(*) c FROM character_events")
      .get() as { c: number };
    expect(c.c).toBe(0);
  });

  it("неизвестное имя субъекта не пришивается чужому герою", () => {
    const out = persist([event({ subjectName: "Некто" })]);
    expect(out.unresolved).toBe(1);
    expect(out.inserted).toBe(0);
  });

  it("AC-21: повторный прогон той же версии не плодит строк", () => {
    expect(persist([event()]).inserted).toBe(1);
    const second = persist([event()]);
    expect(second).toMatchObject({ inserted: 0, duplicates: 1 });
    const c = t.sqlite
      .prepare("SELECT COUNT(*) c FROM character_events")
      .get() as { c: number };
    expect(c.c).toBe(1);
  });

  it("новый номер извлекателя разбирает ту же версию заново", () => {
    expect(persist([event()], 1).inserted).toBe(1);
    expect(persist([event()], 2).inserted).toBe(1);
  });

  it("сдвиги отношения к разным адресатам не гасят друг друга", async () => {
    await makeCharacter("Сарек");
    await makeCharacter("Кай");
    const data = { quality: "доверие", from: "ровно", to: "холодно" };
    const out = persist([
      event({ kind: "relation_shift", data, addresseeName: "Сарек" }),
      event({ kind: "relation_shift", data, addresseeName: "Кай" }),
    ]);
    // Одинаковые данные, одна версия, разные адресаты. Без адресата в ключе
    // второе событие молча съел бы INSERT OR IGNORE.
    expect(out).toMatchObject({ inserted: 2, duplicates: 0 });
  });

  it("названный, но неизвестный адресат — отказ, а не событие в никуда", async () => {
    const data = { quality: "доверие", from: "ровно", to: "холодно" };
    const out = persist([
      event({ kind: "relation_shift", data, addresseeName: "Никто" }),
      event({ kind: "relation_shift", data, addresseeName: "Никто другой" }),
    ]);
    // Обнулить адресата означало бы свести оба к ключу на «-»: первое легло
    // бы, второе съел бы INSERT OR IGNORE, и оба отказа пропали бы из счёта.
    expect(out).toMatchObject({ inserted: 0, unresolved: 2, duplicates: 0 });
  });

  it("текст берётся по версии, а не со слов вызывающего", () => {
    // Доказательство сверяется с content_text ЭТОЙ версии. Соседняя версия
    // той же главы содержит другой текст, и цитата из неё не проходит.
    const otherVersionId = (
      t.sqlite
        .prepare("SELECT id FROM chapter_versions WHERE chapter_id = ? ORDER BY id LIMIT 1")
        .get(chapterId) as { id: number }
    ).id;
    expect(otherVersionId).not.toBe(versionId);
    const out = persistCharacterEvents(t.sqlite, {
      bookId,
      chapterId,
      sourceVersionId: otherVersionId,
      events: [event()],
      extractorVersion: 1,
    });
    expect(out).toMatchObject({ inserted: 0, rejectedEvidence: 1 });
  });

  it("версия из чужой главы падает, а не приписывает событие не туда", () => {
    const otherChapterId = Number(
      t.sqlite
        .prepare(
          `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
           VALUES (?, 20, 'Глава вторая', 'draft', ?, ?)`,
        )
        .run(bookId, new Date().toISOString(), new Date().toISOString())
        .lastInsertRowid,
    );
    expect(() =>
      persistCharacterEvents(t.sqlite, {
        bookId,
        chapterId: otherChapterId,
        sourceVersionId: versionId,
        events: [event()],
        extractorVersion: 1,
      }),
    ).toThrow(/принадлежит главе/);
  });

  it("негодный номер извлекателя падает, а не считается дубликатами", () => {
    // `INSERT OR IGNORE` гасит и нарушение CHECK: без проверки на входе
    // весь прогон вернул бы «всё дубликаты» и выглядел бы как повтор.
    expect(() => persist([event()], 0)).toThrow(/extractorVersion/);
  });

  it("пустой список событий — пустой итог, а не отказ", () => {
    expect(persist([])).toEqual({
      inserted: 0,
      rejectedEvidence: 0,
      unresolved: 0,
      duplicates: 0,
    });
  });

  it("итог сходится с числом поданных событий", () => {
    const out = persist([
      event(),
      event({ subjectName: "Некто" }),
      event({ evidenceQuote: "этого в главе нет" }),
      event(),
    ]);
    const total = out.inserted + out.rejectedEvidence + out.unresolved + out.duplicates;
    expect(total).toBe(4);
  });

  it("сдвиг отношения приходит на подтверждение, а не принятым", async () => {
    await makeCharacter("Сарек");
    persist([
      event({
        kind: "relation_shift",
        data: { quality: "доверие", from: "ровно", to: "холодно" },
        addresseeName: "Сарек",
      }),
    ]);
    const row = t.sqlite
      .prepare("SELECT verification FROM character_events")
      .get() as { verification: string };
    expect(row.verification).toBe("proposed");
  });
});

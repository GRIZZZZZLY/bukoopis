import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTestApp,
  sendJson,
  type TestApp,
} from "../../routes/__tests__/_helpers.js";
import { persistCharacterEvents } from "../character-events.js";
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
    evidenceStart: START,
    evidenceEnd: START + QUOTE.length,
    ...over,
  } as ExtractedCharacterEvent;
}

function persist(events: ExtractedCharacterEvent[], extractorVersion = 1) {
  return persistCharacterEvents(t.sqlite, {
    bookId,
    chapterId,
    sourceVersionId: versionId,
    contentText: TEXT,
    events,
    extractorVersion,
  });
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Запись событий",
  });
  bookId = b.id;
  await makeCharacter("Рин");

  const now = new Date().toISOString();
  chapterId = Number(
    t.sqlite
      .prepare(
        `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
         VALUES (?, 10, 'Глава первая', 'draft', ?, ?)`,
      )
      .run(bookId, now, now).lastInsertRowid,
  );
  versionId = Number(
    t.sqlite
      .prepare(
        `INSERT INTO chapter_versions
           (chapter_id, content_json, content_text, word_count, source, created_at)
         VALUES (?, '{}', ?, 10, 'manual', ?)`,
      )
      .run(chapterId, TEXT, now).lastInsertRowid,
  );
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
    expect(row.source_version_id).toBe(versionId);
    expect(row.chapter_id).toBe(chapterId);
    expect(row.origin).toBe("llm");
    expect(row.verification).toBe("derived");
    expect(row.evidence_quote).toBe(QUOTE);
  });

  it("AC-25: сдвинутое доказательство не записывается вовсе", () => {
    const out = persist([
      event({ evidenceStart: START + 3, evidenceEnd: START + 3 + QUOTE.length }),
    ]);
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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { toCharacterEvent, type CharacterEventRow } from "../rows.js";

let t: TestApp;
let bookId: number;
let charId: number;
let versionId: number;
let otherVersionId: number;

/** Версия главы нужна именно строкой в базе: уникальный индекс событий
 *  включает `source_version_id`, а внешний ключ не даст сослаться на выдумку. */
function insertVersion(chapterId: number, text: string): number {
  const info = t.sqlite
    .prepare(
      `INSERT INTO chapter_versions
         (chapter_id, content_json, content_text, word_count, source, created_at)
       VALUES (?, '{}', ?, ?, 'manual', ?)`,
    )
    .run(chapterId, text, text.split(/\s+/).length, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "События" });
  bookId = b.id;
  const c = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  charId = c.id;

  const now = new Date().toISOString();
  const chapter = t.sqlite
    .prepare(
      `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
       VALUES (?, 10, 'Глава первая', 'draft', ?, ?)`,
    )
    .run(bookId, now, now);
  const chapterId = Number(chapter.lastInsertRowid);
  versionId = insertVersion(chapterId, "Станцию закрывают.");
  otherVersionId = insertVersion(chapterId, "Станцию закрывают на зиму.");
});
afterEach(() => t.cleanup());

function insertEvent(dataJson: string, kind = "knowledge"): number {
  const info = t.sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, ?, ?, 0, 'llm', 'derived', 1, ?, ?)`,
    )
    .run(bookId, charId, kind, dataJson, `k:${Math.random()}`, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

describe("чтение строки события", () => {
  it("данные разбираются по виду события", () => {
    const id = insertEvent(
      JSON.stringify({ fact: "Станцию закрывают", acquisition: "told" }),
    );
    const row = t.sqlite
      .prepare("SELECT * FROM character_events WHERE id = ?")
      .get(id) as CharacterEventRow;
    const e = toCharacterEvent(row);
    expect(e.kind).toBe("knowledge");
    expect((e.data as { fact: string }).fact).toBe("Станцию закрывают");
    expect((e.data as { acquisition: string }).acquisition).toBe("told");
  });

  it("битый data_json не роняет чтение", () => {
    const id = insertEvent("{не json");
    const row = t.sqlite
      .prepare("SELECT * FROM character_events WHERE id = ?")
      .get(id) as CharacterEventRow;
    expect(() => toCharacterEvent(row)).not.toThrow();
    expect(toCharacterEvent(row).kind).toBe("knowledge");
  });

  it("уникальный индекс не даёт записать событие дважды", () => {
    const now = new Date().toISOString();
    const ins = t.sqlite.prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          source_version_id, origin, verification, extractor_version,
          dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{}', 0, ?, 'llm', 'derived', 1, 'same', ?)`,
    );
    ins.run(bookId, charId, versionId, now);
    expect(() => ins.run(bookId, charId, versionId, now)).toThrow();
  });

  it("то же событие в другой версии главы — отдельная запись", () => {
    const now = new Date().toISOString();
    const ins = t.sqlite.prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          source_version_id, origin, verification, extractor_version,
          dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{}', 0, ?, 'llm', 'derived', 1, 'same', ?)`,
    );
    ins.run(bookId, charId, versionId, now);
    ins.run(bookId, charId, otherVersionId, now);
    const c = t.sqlite
      .prepare("SELECT COUNT(*) c FROM character_events WHERE dedup_key = 'same'")
      .get() as { c: number };
    expect(c.c).toBe(2);
  });

  it("событие без версии-источника индексом не дедуплицируется", () => {
    // SQLite считает NULL различными в уникальном индексе. Это не дыра:
    // дедупликация нужна только извлекателю (AC-21), а он всегда пишет
    // версию. Тест закрепляет поведение, чтобы задачи 4–5 на него не
    // рассчитывали там, где версии нет.
    const now = new Date().toISOString();
    const ins = t.sqlite.prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{}', 0, 'manual', 'confirmed', 1, 'same', ?)`,
    );
    ins.run(bookId, charId, now);
    expect(() => ins.run(bookId, charId, now)).not.toThrow();
  });
});

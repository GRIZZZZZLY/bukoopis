import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { toCharacterEvent, type CharacterEventRow } from "../rows.js";

let t: TestApp;
let bookId: number;
let charId: number;
let chapterId: number;
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
  chapterId = Number(chapter.lastInsertRowid);
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

  it("каждая колонка ложится в своё поле", () => {
    // Все значения различны нарочно: перепутанная пара колонок (смещения,
    // две ссылки на персонажа, книга и глава) прошла бы любую проверку,
    // где совпадают хотя бы два числа.
    const other = t.sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
         VALUES (?, 'Кай', '{}', ?, ?)`,
      )
      .run(bookId, new Date().toISOString(), new Date().toISOString());
    const otherId = Number(other.lastInsertRowid);
    const created = "2026-09-18T10:20:30.000Z";
    const info = t.sqlite
      .prepare(
        `INSERT INTO character_events
           (book_id, subject_character_id, addressee_character_id, kind, data_json,
            chapter_id, scene_ordinal, source_version_id,
            evidence_quote, evidence_start, evidence_end,
            origin, verification, extractor_version, dedup_key, created_at)
         VALUES (?, ?, ?, 'relation_shift', '{}', ?, 0, ?, 'он солгал', 11, 22,
                 'accepted_prose', 'proposed', 1, 'map', ?)`,
      )
      .run(bookId, charId, otherId, chapterId, versionId, created);
    const row = t.sqlite
      .prepare("SELECT * FROM character_events WHERE id = ?")
      .get(Number(info.lastInsertRowid)) as CharacterEventRow;

    const e = toCharacterEvent(row);
    expect(e.id).toBe(Number(info.lastInsertRowid));
    expect(e.bookId).toBe(bookId);
    expect(e.subjectCharacterId).toBe(charId);
    expect(e.addresseeCharacterId).toBe(otherId);
    expect(e.kind).toBe("relation_shift");
    expect(e.chapterId).toBe(chapterId);
    expect(e.sceneOrdinal).toBe(0);
    expect(e.sourceVersionId).toBe(versionId);
    expect(e.evidenceQuote).toBe("он солгал");
    expect(e.evidenceStart).toBe(11);
    expect(e.evidenceEnd).toBe(22);
    expect(e.origin).toBe("accepted_prose");
    expect(e.verification).toBe("proposed");
    expect(e.createdAt).toBe(created);
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

  it("новый номер извлекателя даёт новую запись, а не отказ", () => {
    const now = new Date().toISOString();
    const ins = t.sqlite.prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          source_version_id, origin, verification, extractor_version,
          dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{}', 0, ?, 'llm', 'derived', ?, 'same', ?)`,
    );
    ins.run(bookId, charId, versionId, 1, now);
    ins.run(bookId, charId, versionId, 2, now);
    const c = t.sqlite
      .prepare("SELECT COUNT(*) c FROM character_events WHERE dedup_key = 'same'")
      .get() as { c: number };
    expect(c.c).toBe(2);
  });

  it("удаление версии-источника уносит событие вместе с доказательством", () => {
    // AC-25: событие, которое больше нечем проверить, не остаётся активным.
    const now = new Date().toISOString();
    t.sqlite
      .prepare(
        `INSERT INTO character_events
           (book_id, subject_character_id, kind, data_json, scene_ordinal,
            source_version_id, evidence_quote, evidence_start, evidence_end,
            origin, verification, extractor_version, dedup_key, created_at)
         VALUES (?, ?, 'knowledge', '{}', 0, ?, 'цитата', 0, 6,
                 'llm', 'derived', 1, 'ev', ?)`,
      )
      .run(bookId, charId, versionId, now);
    t.sqlite.prepare("DELETE FROM chapter_versions WHERE id = ?").run(versionId);
    const c = t.sqlite
      .prepare("SELECT COUNT(*) c FROM character_events WHERE dedup_key = 'ev'")
      .get() as { c: number };
    expect(c.c).toBe(0);
  });

  it("событие без версии-источника тоже дедуплицируется", () => {
    // Прежде здесь закреплялось обратное: SQLite считает NULL различными,
    // и записи без версии под ключ не попадали. Считалось, что дедупликация
    // нужна только извлекателю, который версию пишет всегда. На практике
    // повтор `POST /characters/:id/knowledge` заводил второе такое же
    // знание, и Писатель получал его в карточке дважды. Миграция 0028
    // считает ключ по COALESCE(source_version_id, -1).
    const now = new Date().toISOString();
    const ins = t.sqlite.prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{}', 0, 'manual', 'confirmed', 1, 'same', ?)`,
    );
    ins.run(bookId, charId, now);
    expect(() => ins.run(bookId, charId, now)).toThrow();
  });
});

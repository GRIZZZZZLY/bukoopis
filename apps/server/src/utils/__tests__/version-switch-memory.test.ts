import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { tryActivateMemoryVersion } from "../memory-activation.js";

/** F06 ревью 2026-09-22: в версии 1 герой узнал код 777, автор переписал
 *  главу, и в версии 2 он его не узнаёт. Память V2 активирована пустой — а
 *  знание и факт из V1 оставались действующими для следующих глав. */

let t: TestApp;
let bookId: number;
let chapterId: number;
let charId: number;
const now = () => new Date().toISOString();
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function commit(text: string): Promise<number> {
  return (await sendJson<{ id: number }>(t.app, `/api/chapters/${chapterId}/versions`, "POST", { contentJson: doc(text) })).id;
}

function fact(sourceVersionId: number, origin: string, predicate: string): void {
  t.sqlite
    .prepare(
      `INSERT INTO book_facts
         (book_id, entity_type, entity_name, predicate, object_text,
          valid_from_chapter, valid_to_chapter, source_version_id, confidence,
          origin, assertion_mode, created_at)
       VALUES (?, 'character', 'Нина', ?, '777', 10, NULL, ?, 1.0, ?, 'narrated_as_fact', ?)`,
    )
    .run(bookId, predicate, sourceVersionId, origin, now());
}

function event(sourceVersionId: number, verification: string): void {
  t.sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
          source_version_id, origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{"fact":"код 777"}', ?, 0, ?, 'llm', ?, 1, ?, ?)`,
    )
    .run(bookId, charId, chapterId, sourceVersionId, verification, `k:${verification}:${Math.random()}`, now());
}

function finishJobsEmpty(versionId: number): void {
  t.sqlite
    .prepare("UPDATE memory_jobs SET status = 'done', result_json = ? WHERE chapter_version_id = ? AND kind = 'facts'")
    .run(JSON.stringify({ factCount: 0, staged: { facts: [], characterEvents: [] } }), versionId);
  t.sqlite
    .prepare("UPDATE memory_jobs SET status = 'done', result_json = ? WHERE chapter_version_id = ? AND kind = 'notes'")
    .run(JSON.stringify({ newCount: 0, resolvedCount: 0 }), versionId);
  t.sqlite
    .prepare("UPDATE memory_jobs SET status = 'done' WHERE chapter_version_id = ? AND status <> 'done'")
    .run(versionId);
}

beforeEach(async () => {
  t = makeTestApp();
  bookId = (await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Код" })).id;
  chapterId = (await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Сейф" })).id;
  charId = Number(
    t.sqlite
      .prepare("INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at) VALUES (?, 'Нина', '{}', ?, ?)")
      .run(bookId, now(), now()).lastInsertRowid,
  );
});
afterEach(() => t.cleanup());

describe("память главы переключается вместе с версией", () => {
  it("машинные знание и факт прежней версии снимаются, авторское остаётся", async () => {
    const v1 = await commit("Нина узнала код 777.");
    fact(v1, "extracted", "знает код");
    fact(v1, "manual", "любит чай");
    event(v1, "derived");
    event(v1, "confirmed");

    const v2 = await commit("Нина так и не узнала код.");
    finishJobsEmpty(v2);
    expect(tryActivateMemoryVersion(t.sqlite, chapterId, v2)).toBe("activated");

    const facts = t.sqlite
      .prepare("SELECT predicate FROM book_facts WHERE book_id = ? ORDER BY predicate")
      .all(bookId) as Array<{ predicate: string }>;
    expect(facts.map((f) => f.predicate)).toEqual(["любит чай"]);
    const events = t.sqlite
      .prepare("SELECT verification FROM character_events WHERE book_id = ?")
      .all(bookId) as Array<{ verification: string }>;
    // Подтверждённое автором не снимается: его решение сильнее текста.
    expect(events.map((e) => e.verification)).toEqual(["confirmed"]);
  });
});

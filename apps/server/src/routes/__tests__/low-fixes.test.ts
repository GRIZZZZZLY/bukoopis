import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

/** Низкие замечания ревью 2026-09-19: повтор ручного знания давал дубль,
 *  отношения из кандидатов искали героя точным именем. */

let t: TestApp;
let bookId: number;
let annaId: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Книга",
  });
  bookId = b.id;
  const anna = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/characters`,
    "POST",
    { canonicalName: "Анна", profile: { description: "смотритель" } },
  );
  annaId = anna.id;
});
afterEach(() => t.cleanup());

describe("ручные знания героя", () => {
  it("повтор того же знания не плодит дубль", async () => {
    const body = { fact: "знает про подземный ход" };
    const first = await send(t.app, `/api/characters/${annaId}/knowledge`, "POST", body);
    expect(first.status).toBe(201);
    await send(t.app, `/api/characters/${annaId}/knowledge`, "POST", body);

    const rows = t.sqlite
      .prepare(
        "SELECT COUNT(*) c FROM character_events WHERE subject_character_id = ? AND kind = 'knowledge'",
      )
      .get(annaId) as { c: number };
    expect(rows.c).toBe(1);
  });

  it("другое знание добавляется рядом", async () => {
    await send(t.app, `/api/characters/${annaId}/knowledge`, "POST", {
      fact: "знает про ход",
    });
    await send(t.app, `/api/characters/${annaId}/knowledge`, "POST", {
      fact: "знает про письмо",
    });
    const rows = t.sqlite
      .prepare(
        "SELECT COUNT(*) c FROM character_events WHERE subject_character_id = ? AND kind = 'knowledge'",
      )
      .get(annaId) as { c: number };
    expect(rows.c).toBe(2);
  });
});

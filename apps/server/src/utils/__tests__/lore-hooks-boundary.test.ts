import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { gatherLoreContext } from "@book-forge/agents";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";

/** F02 ревью 2026-09-22: крючки брались по всей книге, без проверки главы,
 *  в которой они посеяны, — секрет второй главы уходил в подготовку первой. */

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  t = makeTestApp();
  bookId = (await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Книга" })).id;
});
afterEach(() => t.cleanup());

async function chapter(title: string): Promise<{ id: number; orderIndex: number }> {
  return sendJson(t.app, `/api/books/${bookId}/chapters`, "POST", { title });
}

function hook(seedChapterId: number | null, description: string): void {
  const now = new Date().toISOString();
  t.sqlite
    .prepare(
      `INSERT INTO hooks (book_id, seed_chapter_id, description, status, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?)`,
    )
    .run(bookId, seedChapterId, description, now, now);
}

const seen = (order: number) =>
  gatherLoreContext(t.sqlite, bookId, [], order).openHooks.map((h) => h.description);

describe("крючки на границе главы", () => {
  it("N−1 виден, N и N+1 — нет, авторский без главы — везде", async () => {
    const first = await chapter("Первая");
    const second = await chapter("Вторая");
    const third = await chapter("Третья");
    hook(first.id, "FROM_FIRST");
    hook(second.id, "FROM_SECOND");
    hook(third.id, "FROM_THIRD");
    hook(null, "AUTHOR_HOOK");

    expect(seen(second.orderIndex)).toEqual(["FROM_FIRST", "AUTHOR_HOOK"]);
    expect(seen(first.orderIndex)).toEqual(["AUTHOR_HOOK"]);
  });
});

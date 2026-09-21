import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, type TestApp } from "./_helpers.js";

let t: TestApp;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.cleanup());

function columns(table: string): string[] {
  return (t.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
}

describe("миграция 0032", () => {
  it("добавляет колонки и таблицы ветки", () => {
    expect(columns("books")).toContain("author_notes");
    expect(columns("characters")).toContain("hidden_from_prompts");
    expect(columns("prose_proposals")).toEqual(
      expect.arrayContaining(["beats_done", "beats_total"]),
    );
    expect(columns("chat_threads")).toEqual(
      expect.arrayContaining(["book_id", "chapter_id", "title"]),
    );
    expect(columns("chat_messages")).toEqual(
      expect.arrayContaining(["thread_id", "role", "content"]),
    );
  });

  it("роль сообщения ограничена CHECK", () => {
    const b = t.sqlite
      .prepare(
        "INSERT INTO books (title, language, status, created_at, updated_at) VALUES ('к', 'ru', 'draft', 'n', 'n')",
      )
      .run();
    const ch = t.sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at) VALUES (?, 10, 'г', 'draft', 'n', 'n')",
      )
      .run(b.lastInsertRowid);
    const th = t.sqlite
      .prepare(
        "INSERT INTO chat_threads (book_id, chapter_id, created_at, updated_at) VALUES (?, ?, 'n', 'n')",
      )
      .run(b.lastInsertRowid, ch.lastInsertRowid);
    expect(() =>
      t.sqlite
        .prepare(
          "INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'system', 'x', 'n')",
        )
        .run(th.lastInsertRowid),
    ).toThrow(/CHECK/);
  });
});

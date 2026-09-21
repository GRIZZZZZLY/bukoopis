import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import { assembleGenerationContext } from "../../utils/generation-context.js";
import { loadStudioContext, studioContextToPrompt } from "../../utils/studio-context.js";
import type { BookRow, ChapterRow } from "../../db/rows.js";
import { gatherCharacterContext } from "@book-forge/agents";

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

describe("заметки автора", () => {
  const SENTINEL = "ЗАМЕТКА-МАЯЧОК-7731";

  async function bookWithNotes(): Promise<{ bookId: number; chapterId: number }> {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
      title: "Книга",
      premise: "Премиса",
    });
    const patched = await sendJson<{ authorNotes: string | null }>(
      t.app,
      `/api/books/${b.id}`,
      "PATCH",
      { authorNotes: `План на завтра. ${SENTINEL}` },
    );
    expect(patched.authorNotes).toContain(SENTINEL);
    const ch = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${b.id}/chapters`,
      "POST",
      { title: "Глава 1" },
    );
    return { bookId: b.id, chapterId: ch.id };
  }

  it("сохраняются и очищаются через PATCH", async () => {
    const { bookId } = await bookWithNotes();
    const got = await sendJson<{ authorNotes: string | null }>(
      t.app,
      `/api/books/${bookId}`,
      "GET",
    );
    expect(got.authorNotes).toContain(SENTINEL);
    const cleared = await sendJson<{ authorNotes: string | null }>(
      t.app,
      `/api/books/${bookId}`,
      "PATCH",
      { authorNotes: null },
    );
    expect(cleared.authorNotes).toBeNull();
  });

  it("не попадают ни в одну сборку контекста", async () => {
    const { bookId, chapterId } = await bookWithNotes();
    const book = t.sqlite.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as BookRow;
    const chapter = t.sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(chapterId) as ChapterRow;
    const assembled = await assembleGenerationContext(t.sqlite, {
      book,
      chapter,
      hasVec: false,
      scanTexts: ["текст"],
      retrievalQuery: "текст",
      povName: null,
      label: "test",
    });
    expect(JSON.stringify(assembled)).not.toContain(SENTINEL);
    expect(studioContextToPrompt(loadStudioContext(t.sqlite, bookId)) ?? "").not.toContain(
      SENTINEL,
    );
  });

  it("уходят в полную выгрузку книги", async () => {
    const { bookId } = await bookWithNotes();
    const res = await send(t.app, `/api/books/${bookId}/export.json`, "GET");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SENTINEL);
  });
});

describe("глазок героя", () => {
  async function twoCharacters(): Promise<{ bookId: number; nina: number; vort: number }> {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    const nina = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/characters`, "POST", {
      canonicalName: "Нина",
      profile: { description: "инженер" },
    });
    const vort = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/characters`, "POST", {
      canonicalName: "Ворт",
      profile: { description: "механик" },
    });
    return { bookId: b.id, nina: nina.id, vort: vort.id };
  }

  it("переключается без роста ревизии и отдаётся в карточке", async () => {
    const { vort } = await twoCharacters();
    const hidden = await sendJson<{ hiddenFromPrompts: boolean; revision: number }>(
      t.app,
      `/api/characters/${vort}/prompt-visibility`,
      "PATCH",
      { hidden: true },
    );
    expect(hidden.hiddenFromPrompts).toBe(true);
    expect(hidden.revision).toBe(0);
    const res = await send(t.app, `/api/characters/${vort}/prompt-visibility`, "PATCH", {
      hidden: "да",
    });
    expect(res.status).toBe(400);
    expect((await send(t.app, `/api/characters/99999/prompt-visibility`, "PATCH", { hidden: true })).status).toBe(404);
  });

  it("скрытый герой не сканируется, но POV из плана берётся всегда", async () => {
    const { bookId, vort } = await twoCharacters();
    await send(t.app, `/api/characters/${vort}/prompt-visibility`, "PATCH", { hidden: true });
    const scanned = gatherCharacterContext(t.sqlite, bookId, ["Нина и Ворт спорят у мотора"], [], null);
    expect(scanned.characters.map((c) => c.character.canonicalName)).toEqual(["Нина"]);
    const withPov = gatherCharacterContext(t.sqlite, bookId, ["Нина и Ворт спорят"], [vort], null);
    expect(withPov.characters.map((c) => c.character.canonicalName).sort()).toEqual(["Ворт", "Нина"]);
  });

  it("скрытый POV из плана приходит, даже когда скрыты все герои", async () => {
    // Единственный герой книги скрыт — отфильтрованный список пуст, и это
    // единственный способ дойти до ветки `alwaysIncludeIds.length === 0` в
    // раннем возврате: с любым видимым героем список никогда не пуст, и
    // регрессия на старую проверку `allCharacters.length === 0` осталась бы
    // незамеченной (см. ревью).
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    const only = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/characters`, "POST", {
      canonicalName: "Нина",
      profile: { description: "инженер" },
    });
    await send(t.app, `/api/characters/${only.id}/prompt-visibility`, "PATCH", { hidden: true });
    // Скан без POV ничего не находит — список пуст.
    expect(
      gatherCharacterContext(t.sqlite, b.id, ["сцена без имён"], [], null).characters,
    ).toEqual([]);
    // POV назван автором в плане явно — фильтр обходится, карточка приходит.
    const withPov = gatherCharacterContext(t.sqlite, b.id, ["сцена без имён"], [only.id], null);
    expect(withPov.characters.map((c) => c.character.canonicalName)).toEqual(["Нина"]);
  });
});

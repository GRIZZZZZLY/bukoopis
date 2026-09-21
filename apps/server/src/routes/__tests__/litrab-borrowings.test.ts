import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import { assembleGenerationContext } from "../../utils/generation-context.js";
import { loadStudioContext, studioContextToPrompt } from "../../utils/studio-context.js";
import type { BookRow, ChapterRow } from "../../db/rows.js";
import { gatherCharacterContext } from "@book-forge/agents";
import type { StyleFingerprint } from "@book-forge/shared";

// Только `runStyleBlender` подменяется — остальной style-engine (парсер,
// детектор формата, счётчик усталых слов) остаётся настоящим: тест про
// бленд проверяет ветку `kind`, а не сам блендер.
vi.mock("@book-forge/style-engine", async (orig) => ({
  ...(await orig<typeof import("@book-forge/style-engine")>()),
  runStyleBlender: vi.fn(),
}));
import { runStyleBlender } from "@book-forge/style-engine";

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

describe("свежесть паспорта стиля", () => {
  const LONG = "Ключ не поворачивался. Ну конечно. Дверь он менял в апреле, руки бы оторвать. ".repeat(12);

  async function bookWithProfile(): Promise<{ bookId: number; profileId: number }> {
    const p = await sendJson<{ id: number }>(t.app, "/api/style-profiles", "POST", {
      name: "Мой",
      language: "ru",
    });
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    await send(t.app, `/api/books/${b.id}`, "PATCH", { styleProfileId: p.id });
    return { bookId: b.id, profileId: p.id };
  }

  async function chapterWithVersion(bookId: number, title: string): Promise<number> {
    const ch = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title });
    await send(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
      contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: LONG }] }] },
    });
    return ch.id;
  }

  const BLEND_FINGERPRINT: StyleFingerprint = {
    language: "ru",
    voiceSummary: "Смешанный голос.",
    sentenceLengths: { meanWords: 11, medianWords: 9, shortShare: 0.4, mediumShare: 0.4, longShare: 0.2 },
    density: { dialogue: 0.25, description: 0.35, action: 0.25, introspection: 0.15 },
    paragraphRhythm: "Плотные короткие абзацы.",
    sceneOpenings: "С детали.",
    sceneClosings: "С паузы.",
    tense: "past",
    metaphorFamilies: ["ремесло"],
    signatureSyntax: ["парцелляция"],
    signatureTropes: ["сцена держится на одном предмете"],
    thingsToImitate: ["обрывать абзац на действии"],
    thingsToAvoid: ["зеркальные конструкции"],
  };

  /** Дешёвый «извлечённый» родитель для бленда: пишем валидный отпечаток
   *  прямо в базу, минуя настоящий экстрактор — тест проверяет ветку `kind`
   *  у бленда, а не само извлечение. */
  async function makeExtractedProfile(name: string): Promise<number> {
    const p = await sendJson<{ id: number }>(t.app, "/api/style-profiles", "POST", {
      name,
      language: "ru",
    });
    t.sqlite
      .prepare("UPDATE style_profiles SET fingerprint_json = ? WHERE id = ?")
      .run(JSON.stringify(BLEND_FINGERPRINT), p.id);
    return p.id;
  }

  it("без профиля — profileId null и stale false", async () => {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    const f = await sendJson<{ profileId: number | null; stale: boolean }>(
      t.app, `/api/books/${b.id}/style-freshness`, "GET",
    );
    expect(f.profileId).toBeNull();
    expect(f.stale).toBe(false);
  });

  it("три главы после извлечения — stale", async () => {
    const { bookId, profileId } = await bookWithProfile();
    t.sqlite
      .prepare("UPDATE style_profiles SET last_extracted_at = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", profileId);
    for (const title of ["1", "2"]) await chapterWithVersion(bookId, title);
    let f = await sendJson<{ chaptersSince: number; stale: boolean }>(
      t.app, `/api/books/${bookId}/style-freshness`, "GET",
    );
    expect(f.chaptersSince).toBe(2);
    expect(f.stale).toBe(false);
    await chapterWithVersion(bookId, "3");
    f = await sendJson(t.app, `/api/books/${bookId}/style-freshness`, "GET");
    expect(f.chaptersSince).toBe(3);
    expect(f.stale).toBe(true);
  });

  it("не извлекался ни разу — не stale, сколько бы глав ни было", async () => {
    const { bookId } = await bookWithProfile();
    for (const title of ["1", "2", "3"]) await chapterWithVersion(bookId, title);
    const f = await sendJson<{ stale: boolean; lastExtractedAt: string | null }>(
      t.app, `/api/books/${bookId}/style-freshness`, "GET",
    );
    expect(f.lastExtractedAt).toBeNull();
    expect(f.stale).toBe(false);
  });

  it("добор глав кладёт корпус в профиль книги, старые корпуса не трогает", async () => {
    const { bookId, profileId } = await bookWithProfile();
    for (const title of ["1", "2", "3", "4"]) await chapterWithVersion(bookId, title);
    const before = (t.sqlite.prepare("SELECT COUNT(*) c FROM reference_corpora WHERE profile_id = ?").get(profileId) as { c: number }).c;
    const res = await sendJson<{ corpusId: number; chapters: Array<{ title: string }> }>(
      t.app, `/api/books/${bookId}/style/refresh-from-chapters`, "POST", {},
    );
    expect(res.chapters.map((c) => c.title)).toEqual(["2", "3", "4"]);
    const row = t.sqlite
      .prepare("SELECT profile_id, scene_count FROM reference_corpora WHERE id = ?")
      .get(res.corpusId) as { profile_id: number; scene_count: number };
    expect(row.profile_id).toBe(profileId);
    expect(row.scene_count).toBeGreaterThan(0);
    const after = (t.sqlite.prepare("SELECT COUNT(*) c FROM reference_corpora WHERE profile_id = ?").get(profileId) as { c: number }).c;
    expect(after).toBe(before + 1);
  });

  it("без принятых глав или без профиля — 400", async () => {
    const { bookId } = await bookWithProfile();
    expect((await send(t.app, `/api/books/${bookId}/style/refresh-from-chapters`, "POST", {})).status).toBe(400);
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    expect((await send(t.app, `/api/books/${b.id}/style/refresh-from-chapters`, "POST", {})).status).toBe(400);
  });

  it("бленд не устаревает и не принимает добор — у него нет своего корпуса", async () => {
    vi.mocked(runStyleBlender).mockResolvedValueOnce(BLEND_FINGERPRINT);
    const a = await makeExtractedProfile("Первый");
    const b = await makeExtractedProfile("Второй");
    const blend = await sendJson<{ id: number; kind: string }>(
      t.app, "/api/style-profiles/blend", "POST",
      { name: "Смесь", sources: [{ profileId: a, weight: 0.5 }, { profileId: b, weight: 0.5 }] },
    );
    expect(blend.kind).toBe("blend");

    const book = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
    await send(t.app, `/api/books/${book.id}`, "PATCH", { styleProfileId: blend.id });
    for (const title of ["1", "2", "3"]) await chapterWithVersion(book.id, title);

    const f = await sendJson<{ kind: string | null; stale: boolean }>(
      t.app, `/api/books/${book.id}/style-freshness`, "GET",
    );
    expect(f.kind).toBe("blend");
    expect(f.stale).toBe(false);

    const res = await send(t.app, `/api/books/${book.id}/style/refresh-from-chapters`, "POST", {});
    expect(res.status).toBe(400);
  });
});

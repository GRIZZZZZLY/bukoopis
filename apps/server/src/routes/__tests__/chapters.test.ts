import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTestApp,
  send,
  sendJson,
  SAMPLE_DOC,
  type TestApp,
} from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
  orderIndex: number;
  title: string;
  status: string;
  currentVersionId: number | null;
  currentVersion?: VersionJson | null;
}
interface VersionJson {
  id: number;
  parentVersionId: number | null;
  wordCount: number;
  contentText: string;
}

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Книга",
  });
  bookId = b.id;
});
afterEach(() => {
  t.cleanup();
});

describe("chapters CRUD", () => {
  it("GET /api/books/:id/chapters returns empty initially", async () => {
    const res = await send(t.app, `/api/books/${bookId}/chapters`, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST chapters set order_index = 10, 20", async () => {
    const c1 = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Гл1" },
    );
    expect(c1.orderIndex).toBe(10);
    const c2 = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Гл2" },
    );
    expect(c2.orderIndex).toBe(20);
  });

  it("POST chapter rejects invalid body (400)", async () => {
    const res = await send(t.app, `/api/books/${bookId}/chapters`, "POST", {});
    expect(res.status).toBe(400);
  });

  it("GET /api/chapters/:id returns 404 for missing", async () => {
    const res = await send(t.app, "/api/chapters/9999", "GET");
    expect(res.status).toBe(404);
  });

  it("GET /api/chapters/:id includes currentVersion=null when no versions", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Гл" },
    );
    const res = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${c.id}`,
      "GET",
    );
    expect(res.currentVersion).toBeNull();
  });

  it("PATCH /api/chapters/:id updates title + status", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "A" },
    );
    const res = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${c.id}`,
      "PATCH",
      { title: "B", status: "in_review" },
    );
    expect(res.title).toBe("B");
    expect(res.status).toBe("in_review");
  });

  it("DELETE /api/chapters/:id cascades to versions", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "A" },
    );
    await send(t.app, `/api/chapters/${c.id}/versions`, "POST", {
      contentJson: SAMPLE_DOC,
    });
    const del = await send(t.app, `/api/chapters/${c.id}`, "DELETE");
    expect(del.status).toBe(200);
    const versions = await send(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "GET",
    );
    expect(versions.status).toBe(404);
  });

  it("DELETE называет записи знаний, которые уходят вместе с главой", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Глава со знанием" },
    );
    const now = new Date().toISOString();
    const charId = Number(
      t.sqlite
        .prepare(
          `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
           VALUES (?, 'Рин', '{"description":"герой"}', ?, ?)`,
        )
        .run(bookId, now, now).lastInsertRowid,
    );
    // Авторская запись и извлечённая — считаются обе, но названы раздельно:
    // вернуть автору можно только то, что он вводил сам.
    const insert = t.sqlite.prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, origin,
          verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', '{"fact":"x"}', ?, ?, 'confirmed', 1, ?, ?)`,
    );
    insert.run(bookId, charId, c.id, "manual", "k:manual", now);
    insert.run(bookId, charId, c.id, "llm", "k:llm", now);

    const del = await send(t.app, `/api/chapters/${c.id}`, "DELETE");
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({
      deletedCharacterEvents: 2,
      deletedAuthoredEvents: 1,
      // В4 ревью 2026-09-19: факты и заметки удалённой главы тоже уходят и
      // тоже названы. Здесь их не было — счёт честно нулевой.
      deletedFacts: 0,
      deletedNotes: 0,
    });
    // И они действительно исчезли — счёт описывает потерю, а не намерение.
    const left = t.sqlite
      .prepare("SELECT COUNT(*) n FROM character_events WHERE book_id = ?")
      .get(bookId) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("chapter versions", () => {
  it("POST creates version, sets it as current", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "A" },
    );
    const v = await sendJson<VersionJson>(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "POST",
      { contentJson: SAMPLE_DOC },
    );
    expect(v.id).toBeGreaterThan(0);
    expect(v.parentVersionId).toBeNull();
    expect(v.wordCount).toBe(4);
    expect(v.contentText).toContain("Привет");

    const ch = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${c.id}`,
      "GET",
    );
    expect(ch.currentVersionId).toBe(v.id);
    expect(ch.currentVersion?.id).toBe(v.id);
  });

  it("second version has parent = previous current", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "A" },
    );
    const v1 = await sendJson<VersionJson>(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "POST",
      { contentJson: SAMPLE_DOC },
    );
    const v2 = await sendJson<VersionJson>(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "POST",
      { contentJson: SAMPLE_DOC },
    );
    expect(v2.parentVersionId).toBe(v1.id);
  });

  it("POST version rejects bad JSON (400)", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "A" },
    );
    const res = await send(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "POST",
      { contentJson: "not an object" },
    );
    expect(res.status).toBe(400);
  });

  it("restore sets currentVersionId without creating new version", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "A" },
    );
    const v1 = await sendJson<VersionJson>(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "POST",
      { contentJson: SAMPLE_DOC },
    );
    await send(t.app, `/api/chapters/${c.id}/versions`, "POST", {
      contentJson: SAMPLE_DOC,
    });
    const restored = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${c.id}/restore/${v1.id}`,
      "POST",
    );
    expect(restored.currentVersionId).toBe(v1.id);
    const versions = await sendJson<VersionJson[]>(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "GET",
    );
    expect(versions.length).toBe(2);
  });

  it("restore returns 404 when version doesn't belong to chapter", async () => {
    const c = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "A" },
    );
    const res = await send(
      t.app,
      `/api/chapters/${c.id}/restore/999`,
      "POST",
    );
    expect(res.status).toBe(404);
  });
});

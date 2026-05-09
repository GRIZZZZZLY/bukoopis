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
    expect(del.status).toBe(204);
    const versions = await send(
      t.app,
      `/api/chapters/${c.id}/versions`,
      "GET",
    );
    expect(versions.status).toBe(404);
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

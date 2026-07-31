import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
}

const FIVE_WORD_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "один два три четыре пять" }],
    },
  ],
};

describe("GET /api/books/stats", () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => {
    t.cleanup();
  });

  it("returns empty object when there are no chapters", async () => {
    const res = await send(t.app, "/api/books/stats", "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("aggregates chapters, done count and words per book", async () => {
    const book = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "Книга",
    });
    const bookId = book.id;

    const c1 = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Гл1" },
    );
    await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Гл2" },
    );

    await send(t.app, `/api/chapters/${c1.id}/versions`, "POST", {
      contentJson: FIVE_WORD_DOC,
    });
    await send(t.app, `/api/chapters/${c1.id}`, "PATCH", {
      status: "final",
    });

    const res = await send(t.app, "/api/books/stats", "GET");
    expect(res.status).toBe(200);
    const stats = (await res.json()) as Record<
      string,
      { chapters: number; done: number; words: number }
    >;
    const entry = stats[String(bookId)];
    expect(entry).toBeDefined();
    expect(entry?.chapters).toBe(2);
    expect(entry?.done).toBe(1);
    expect(entry?.words).toBe(5);
  });
});

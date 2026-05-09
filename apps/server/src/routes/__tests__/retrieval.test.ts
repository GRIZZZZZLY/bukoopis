import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTestApp,
  send,
  sendJson,
  type TestApp,
} from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
  orderIndex: number;
}
interface SearchHitJson {
  chunkId: number;
  chapterId: number | null;
  text: string;
  score: number;
  vecRank: number | null;
  ftsRank: number | null;
}
interface SearchResponse {
  query: string;
  vecEnabled: boolean;
  hits: SearchHitJson[];
}

function docFor(text: string): unknown {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  };
}

let t: TestApp;
let bookId: number;
let chapter1Id: number;
let chapter2Id: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Книга про драконов",
  });
  bookId = b.id;
  const c1 = await sendJson<ChapterJson>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава 1: знакомство" },
  );
  chapter1Id = c1.id;
  const c2 = await sendJson<ChapterJson>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава 2: путешествие" },
  );
  chapter2Id = c2.id;
});
afterEach(() => {
  t.cleanup();
});

describe("retrieval", () => {
  it("indexes a saved version and finds it via FTS", async () => {
    await send(t.app, `/api/chapters/${chapter1Id}/versions`, "POST", {
      contentJson: docFor(
        "Дракон спал в пещере на самой вершине горы. Под скалами тёк ручей.",
      ),
    });
    const res = await sendJson<SearchResponse>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("дракон")}`,
      "GET",
    );
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0]!.text).toContain("Дракон");
  });

  it("respects beforeChapter spoiler filter", async () => {
    await send(t.app, `/api/chapters/${chapter1Id}/versions`, "POST", {
      contentJson: docFor("Главный герой заходит в пещеру и видит дракона."),
    });
    await send(t.app, `/api/chapters/${chapter2Id}/versions`, "POST", {
      contentJson: docFor("Спойлер: дракон оказывается союзником."),
    });
    const res = await sendJson<SearchResponse>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("дракон")}&beforeChapter=10`,
      "GET",
    );
    for (const h of res.hits) {
      expect(h.chapterId).toBe(chapter1Id);
    }
  });

  it("re-indexes when a new version is saved", async () => {
    await send(t.app, `/api/chapters/${chapter1Id}/versions`, "POST", {
      contentJson: docFor("Первая версия с упоминанием эльфа."),
    });
    await send(t.app, `/api/chapters/${chapter1Id}/versions`, "POST", {
      contentJson: docFor("Вторая версия с упоминанием орка."),
    });
    // After second save, the chapter's current_version_id points to the new
    // version. Search filters chunks to current versions only, so 'эльф'
    // (only in old version) must not return any FTS hit. Vec search may still
    // return noise for the stub provider — only assert on FTS rank.
    const elfResults = await sendJson<SearchResponse>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("эльф")}`,
      "GET",
    );
    const orcResults = await sendJson<SearchResponse>(
      t.app,
      `/api/books/${bookId}/search?q=${encodeURIComponent("орк")}`,
      "GET",
    );
    expect(elfResults.hits.filter((h) => h.ftsRank !== null).length).toBe(0);
    expect(
      orcResults.hits.filter((h) => h.ftsRank !== null).length,
    ).toBeGreaterThan(0);
  });

  it("returns 400 when query is empty", async () => {
    const res = await send(t.app, `/api/books/${bookId}/search?q=`, "GET");
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing book", async () => {
    const res = await send(t.app, `/api/books/9999/search?q=test`, "GET");
    expect(res.status).toBe(404);
  });
});

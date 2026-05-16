import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@book-forge/retrieval", () => ({
  hybridSearch: vi.fn(),
}));

import { gatherRetrievedChunks } from "../chapter-retrieval.js";
import { hybridSearch } from "@book-forge/retrieval";
import type { Database as DatabaseType } from "better-sqlite3";

const hybridSearchMock = vi.mocked(hybridSearch);

const fakeDb = {} as DatabaseType;

function hit(
  chunkId: number,
  chapterId: number | null,
  chapterOrder: number | null,
  text: string,
  score: number,
) {
  return {
    chunkId,
    bookId: 1,
    chapterId,
    chapterOrder,
    text,
    score,
    vecRank: chunkId,
    ftsRank: null,
  };
}

beforeEach(() => hybridSearchMock.mockReset());

describe("gatherRetrievedChunks", () => {
  it("returns empty on blank query without calling hybridSearch", async () => {
    const r = await gatherRetrievedChunks(fakeDb, {
      bookId: 1,
      queryText: "   \n  ",
      currentChapterOrder: 5,
      hasVec: true,
    });
    expect(r.chunks).toEqual([]);
    expect(r.promptBlock).toBeNull();
    expect(hybridSearchMock).not.toHaveBeenCalled();
  });

  it("passes beforeChapterOrder = currentChapterOrder - 1 (excludes current + later)", async () => {
    hybridSearchMock.mockResolvedValue([]);
    await gatherRetrievedChunks(fakeDb, {
      bookId: 7,
      queryText: "набег на деревню",
      currentChapterOrder: 5,
      hasVec: false,
    });
    expect(hybridSearchMock).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({
        bookId: 7,
        query: "набег на деревню",
        beforeChapterOrder: 4,
        hasVec: false,
      }),
    );
  });

  it("dedupes by chapterId keeping first-ranked, caps at topK, builds prompt block", async () => {
    hybridSearchMock.mockResolvedValue([
      hit(1, 10, 2, "Фрагмент A", 9),
      hit(2, 10, 2, "Фрагмент A2 (тот же чаптер)", 8),
      hit(3, 11, 3, "Фрагмент B", 7),
      hit(4, 12, 4, "Фрагмент C", 6),
    ]);
    const r = await gatherRetrievedChunks(fakeDb, {
      bookId: 1,
      queryText: "q",
      currentChapterOrder: 9,
      hasVec: true,
      topK: 2,
    });
    expect(r.chunks.map((c) => c.text)).toEqual(["Фрагмент A", "Фрагмент B"]);
    expect(r.promptBlock).toContain("Релевантные фрагменты предыдущих глав");
    expect(r.promptBlock).toContain("Глава #2");
    expect(r.promptBlock).toContain("Глава #3");
    expect(r.promptBlock).not.toContain("Фрагмент C");
  });

  // NOTE: best-effort failure (hybridSearch rejects → util swallows, returns
  // empty) is asserted at the PLOT ROUTE layer in plot.test.ts, not here.
  // vitest 2.1.9 attributes errors thrown by a vi.mock-factory vi.fn() to the
  // test even when the caller catches them, *unless* consumed through an async
  // boundary like Hono app.request() (cf. concept-refine.test.ts which passes
  // with the identical mockRejectedValue pattern). Codebase convention
  // (CLAUDE.md): failure paths covered indirectly via route tests.

  it("returns null promptBlock when no hits", async () => {
    hybridSearchMock.mockResolvedValue([]);
    const r = await gatherRetrievedChunks(fakeDb, {
      bookId: 1,
      queryText: "q",
      currentChapterOrder: 3,
      hasVec: true,
    });
    expect(r.chunks).toEqual([]);
    expect(r.promptBlock).toBeNull();
  });
});

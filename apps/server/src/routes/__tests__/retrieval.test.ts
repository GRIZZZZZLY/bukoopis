import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setEmbeddingProvider, stubProvider } from "@book-forge/retrieval";

// ADR 0002: retrieval reads by memory_version_id, which flips only when ALL
// commit-kind jobs (index+summary+facts+notes) are done. Mock the LLM-backed
// agents so a full worker drain() activates memory without network calls.
vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  summarizeChapter: vi.fn(),
  extractCanonFacts: vi.fn(),
  extractEpisodicNotes: vi.fn(),
  metaSummarize: vi.fn(),
}));

import {
  summarizeChapter,
  extractCanonFacts,
  extractEpisodicNotes,
  metaSummarize,
} from "@book-forge/agents";
import {
  makeTestApp,
  send,
  sendJson,
  type TestApp,
} from "./_helpers.js";

const NO_TOKENS = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

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
  vi.mocked(summarizeChapter).mockResolvedValue({
    summary: "Сводка.",
    modelId: "noop",
    tokens: NO_TOKENS,
  } as never);
  vi.mocked(extractCanonFacts).mockResolvedValue({ facts: [] } as never);
  vi.mocked(extractEpisodicNotes).mockResolvedValue({
    newNotes: [],
    resolvedNoteIds: [],
    notes: null,
  } as never);
  vi.mocked(metaSummarize).mockResolvedValue({
    summary: "",
    modelId: "noop",
    tokens: NO_TOKENS,
  } as never);
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
      finalize: true,
    });
    // ADR 0002: indexing is async via the memory worker — drain the index
    // jobs so the search below observes the committed chunks.
    await t.memoryWorker.drain();
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
      finalize: true,
    });
    await send(t.app, `/api/chapters/${chapter2Id}/versions`, "POST", {
      contentJson: docFor("Спойлер: дракон оказывается союзником."),
      finalize: true,
    });
    await t.memoryWorker.drain();
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
      finalize: true,
    });
    await send(t.app, `/api/chapters/${chapter1Id}/versions`, "POST", {
      contentJson: docFor("Вторая версия с упоминанием орка."),
      finalize: true,
    });
    // Drain both queued index jobs: the superseded first version's job goes
    // obsolete, only the current one is indexed.
    await t.memoryWorker.drain();
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

  it("still indexes for FTS when embedding fails (degrades to lexical)", async () => {
    // Simulate the embedding model being unavailable during indexing while
    // search-side embedding still works, so the assertion isolates the index
    // path. FTS must survive: chunks get inserted, only vectors are skipped.
    const failingIndex = {
      name: "failing-index",
      dim: stubProvider.dim,
      embed: stubProvider.embed.bind(stubProvider),
      embedBatch: async () => {
        throw new Error("model unavailable");
      },
    };
    setEmbeddingProvider(failingIndex);
    try {
      const res = await send(
        t.app,
        `/api/chapters/${chapter1Id}/versions`,
        "POST",
        {
          contentJson: docFor("Единорог скакал по радужному лугу."),
          finalize: true,
        },
      );
      expect(res.status).toBe(201);
      // Drain while the failing provider is active — the index job must
      // still complete FTS-only (ADR test scenario 9).
      await t.memoryWorker.drain();
      const search = await sendJson<SearchResponse>(
        t.app,
        `/api/books/${bookId}/search?q=${encodeURIComponent("единорог")}`,
        "GET",
      );
      expect(
        search.hits.filter((h) => h.ftsRank !== null).length,
      ).toBeGreaterThan(0);
    } finally {
      setEmbeddingProvider(stubProvider);
    }
  });

  it("search degrades to FTS when the embedding model is fully unavailable", async () => {
    // Index with the working stub so chunks + FTS exist, then take the model
    // fully offline (both embed and embedBatch throw). Search must not 500.
    await send(t.app, `/api/chapters/${chapter1Id}/versions`, "POST", {
      contentJson: docFor("Дракон охранял золотой клад в пещере."),
      finalize: true,
    });
    // Index with the working stub BEFORE taking the provider offline.
    await t.memoryWorker.drain();
    const offline = {
      name: "offline",
      dim: stubProvider.dim,
      embed: async () => {
        throw new Error("model unavailable");
      },
      embedBatch: async () => {
        throw new Error("model unavailable");
      },
    };
    setEmbeddingProvider(offline);
    try {
      const search = await sendJson<SearchResponse>(
        t.app,
        `/api/books/${bookId}/search?q=${encodeURIComponent("дракон")}`,
        "GET",
      );
      expect(
        search.hits.filter((h) => h.ftsRank !== null).length,
      ).toBeGreaterThan(0);
    } finally {
      setEmbeddingProvider(stubProvider);
    }
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

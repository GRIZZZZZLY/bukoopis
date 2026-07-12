import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// POST /versions is always a commit now (ADR 0002 Step 6) and enqueues memory
// jobs; mock the LLM agents so the background worker never hits the network.
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

interface ChapterDraftJson {
  chapterId: number;
  contentJson: string;
  wordCount: number;
  updatedAt: string;
}
interface ChapterJson {
  id: number;
  currentVersionId: number | null;
  draft: ChapterDraftJson | null;
  memory: { state: string };
}
interface VersionJson {
  id: number;
}

function docFor(text: string): unknown {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

let t: TestApp;
let chapterId: number;

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
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Черновики",
  });
  const c1 = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${b.id}/chapters`,
    "POST",
    { title: "Глава 1" },
  );
  chapterId = c1.id;
});
afterEach(() => {
  t.cleanup();
});

describe("chapter drafts (ADR 0002, Step 6)", () => {
  it("PUT /draft upserts the single working draft without creating versions or jobs", async () => {
    const r1 = await send(t.app, `/api/chapters/${chapterId}/draft`, "PUT", {
      contentJson: docFor("Первый черновой абзац."),
    });
    expect(r1.status).toBe(200);
    await send(t.app, `/api/chapters/${chapterId}/draft`, "PUT", {
      contentJson: docFor("Второй черновой абзац, подлиннее."),
    });

    const ch = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.draft).not.toBeNull();
    expect(ch.draft!.contentJson).toContain("Второй черновой абзац");
    // No immutable versions were created by autosave.
    expect(ch.currentVersionId).toBeNull();
    const versions = await sendJson<VersionJson[]>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "GET",
    );
    expect(versions).toHaveLength(0);
  });

  it("commit (POST /versions) deletes the draft and enqueues the memory pipeline", async () => {
    await send(t.app, `/api/chapters/${chapterId}/draft`, "PUT", {
      contentJson: docFor("Черновик перед коммитом."),
    });
    const res = await send(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      { contentJson: docFor("Зафиксированный текст главы.") },
    );
    expect(res.status).toBe(201);

    const ch = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.draft).toBeNull();
    expect(ch.currentVersionId).not.toBeNull();
    // Memory pipeline is queued/ran for the commit — state is not "none".
    expect(["updating", "fresh"]).toContain(ch.memory.state);
  });

  it("a draft on top of a committed version downgrades memory state to 'none'", async () => {
    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: docFor("Коммит."),
    });
    await t.memoryWorker.drain();
    let ch = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.memory.state).toBe("fresh");
    await send(t.app, `/api/chapters/${chapterId}/draft`, "PUT", {
      contentJson: docFor("Коммит. И новый недокоммиченный текст."),
    });
    ch = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.draft).not.toBeNull();
    expect(ch.memory.state).toBe("none");
  });

  it("restoring a version discards the lingering draft", async () => {
    const v1 = await sendJson<VersionJson>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      { contentJson: docFor("Версия один.") },
    );
    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: docFor("Версия два."),
    });
    await send(t.app, `/api/chapters/${chapterId}/draft`, "PUT", {
      contentJson: docFor("Черновик поверх версии два."),
    });
    await send(
      t.app,
      `/api/chapters/${chapterId}/restore/${v1.id}`,
      "POST",
    );
    const ch = await sendJson<ChapterJson>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.currentVersionId).toBe(v1.id);
    expect(ch.draft).toBeNull();
  });
});

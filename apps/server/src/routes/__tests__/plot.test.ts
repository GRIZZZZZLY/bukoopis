import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the LLM agent + retrieval BEFORE importing the app (createApp wires the
// plot route at module load). Keep every other agent/retrieval export real so
// the rest of the app still boots.
vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterPlan: vi.fn(),
}));
vi.mock("@book-forge/retrieval", async (orig) => ({
  ...(await orig<typeof import("@book-forge/retrieval")>()),
  hybridSearch: vi.fn(),
}));

import Database from "better-sqlite3";
import { runChapterPlan } from "@book-forge/agents";
import { hybridSearch } from "@book-forge/retrieval";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runChapterPlanMock = vi.mocked(runChapterPlan);
const hybridSearchMock = vi.mocked(hybridSearch);

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  runChapterPlanMock.mockReset();
  hybridSearchMock.mockReset();
  // Endpoint trusts the agent output; a single minimal variant is enough.
  runChapterPlanMock.mockResolvedValue([
    {
      label: "v1",
      pov: "Аня",
      emotionalGoal: "надежда",
      estimatedWords: 1200,
      beats: [
        {
          index: 0,
          type: "scene",
          summary: "s",
          goal: "g",
          conflict: "c",
          outcome: "o",
        },
      ],
    },
  ] as unknown as Awaited<ReturnType<typeof runChapterPlan>>);
});
afterEach(() => t.cleanup());

async function createBook(): Promise<number> {
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Retrieval test",
  });
  return b.id;
}

async function createChapter(bookId: number): Promise<number> {
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава 2" },
  );
  return ch.id;
}

function hit(chapterId: number, chapterOrder: number, text: string) {
  return {
    chunkId: chapterId * 10,
    bookId: 1,
    chapterId,
    chapterOrder,
    text,
    score: 1,
    vecRank: 1,
    ftsRank: null,
  };
}

describe("POST /api/chapters/:id/plan — retrieval wiring (Phase 1)", () => {
  it("injects retrieved chunks into runChapterPlan input", async () => {
    hybridSearchMock.mockResolvedValue([
      hit(101, 1, "В деревне сожгли мельницу."),
    ]);
    const bookId = await createBook();
    const chId = await createChapter(bookId);

    const r = await send(t.app, `/api/chapters/${chId}/plan`, "POST", {
      intent: "Аня возвращается в сожжённую деревню",
    });
    expect(r.status).toBe(200);

    expect(hybridSearchMock).toHaveBeenCalledTimes(1);
    const arg = runChapterPlanMock.mock.calls[0]![0];
    expect(arg.retrievedContext).toContain(
      "Релевантные фрагменты предыдущих глав",
    );
    expect(arg.retrievedContext).toContain("В деревне сожгли мельницу.");
  });

  it("best-effort: hybridSearch failure does not break plan generation", async () => {
    hybridSearchMock.mockRejectedValue(new Error("vec backend down"));
    const bookId = await createBook();
    const chId = await createChapter(bookId);

    const r = await send(t.app, `/api/chapters/${chId}/plan`, "POST", {
      intent: "любой интент",
    });
    expect(r.status).toBe(200);

    expect(runChapterPlanMock).toHaveBeenCalledTimes(1);
    const arg = runChapterPlanMock.mock.calls[0]![0];
    expect(arg.retrievedContext).toBeUndefined();
  });

  it("omits retrievedContext when no chunks found", async () => {
    hybridSearchMock.mockResolvedValue([]);
    const bookId = await createBook();
    const chId = await createChapter(bookId);

    const r = await send(t.app, `/api/chapters/${chId}/plan`, "POST", {
      intent: "интент без релевантных фрагментов",
    });
    expect(r.status).toBe(200);
    const arg = runChapterPlanMock.mock.calls[0]![0];
    expect(arg.retrievedContext).toBeUndefined();
  });
});

describe("POST /api/books/:id/plan/approve", () => {
  it("создаёт главы по плану и возвращает их вместе со счётом", async () => {
    const bookId = await createBook();
    // Маршрут генерации мы не зовём — кладём план прямо в колонку, как это
    // делает приём материала.
    const outline = {
      variants: [
        {
          label: "из ваших материалов: Оглавление",
          estimatedChapters: 2,
          source: "author_material",
          chapters: [{ title: "Порог", pov: "Рин" }, { title: "Мост" }],
        },
      ],
      selectedIndex: 0,
      generatedAt: "2026-09-06T10:00:00.000Z",
    };
    const db = new Database(`${t.dbDir}/test.sqlite`);
    db.prepare("UPDATE books SET outline_json = ? WHERE id = ?").run(
      JSON.stringify(outline),
      bookId,
    );
    db.close();

    const out = await sendJson<{
      created: number;
      updated: number;
      chapters: Array<{ title: string; intent: string | null }>;
    }>(t.app, `/api/books/${bookId}/plan/approve`, "POST", {});

    expect(out.created).toBe(2);
    expect(out.updated).toBe(0);
    expect(out.chapters.map((ch) => ch.title)).toEqual(["Порог", "Мост"]);
    expect(out.chapters[0]!.intent).toContain("POV: Рин");
  });

  it("книга без плана отвечает 400 с причиной", async () => {
    const bookId = await createBook();
    const r = await send(t.app, `/api/books/${bookId}/plan/approve`, "POST", {});
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string; details: { reason: string } };
    expect(body.error).toBe("plan_not_approvable");
    expect(body.details.reason).toBe("no_outline");
  });

  it("404 для несуществующей книги", async () => {
    const r = await send(t.app, "/api/books/9999/plan/approve", "POST", {});
    expect(r.status).toBe(404);
  });
});

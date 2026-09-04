import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the critique graph BEFORE importing the app so the route wires the mock.
vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runCritique: vi.fn(),
  runChapterPlan: vi.fn(),
}));

import { runChapterPlan, runCritique } from "@book-forge/agents";
import { makeTestApp, sendJson, type TestApp } from "./_helpers.js";

const runCritiqueMock = vi.mocked(runCritique);
const runChapterPlanMock = vi.mocked(runChapterPlan);

let t: TestApp;
let chapterId: number;
let versionId: number;

const CHAPTER_TEXT =
  "Он не спал, а ждал. Сердце упало в живот. Он был тих, бледен и упрям. Дверь закрылась.";

beforeEach(async () => {
  t = makeTestApp();
  runCritiqueMock.mockReset();
  runChapterPlanMock.mockReset();
  runCritiqueMock.mockResolvedValue({
    report: { chapterVersionId: 0, critics: [], createdAt: "" },
    errors: [],
  } as unknown as Awaited<ReturnType<typeof runCritique>>);
  runChapterPlanMock.mockResolvedValue([
    {
      label: "v1",
      pov: "Иван",
      emotionalGoal: "тревога",
      estimatedWords: 1200,
      beats: [
        {
          index: 0,
          type: "hook",
          summary: "s",
          goal: "g",
          conflict: "c",
          outcome: "o",
        },
      ],
      closing: { mode: "cut_mid_action", note: "Обрыв на пороге." },
    },
  ] as unknown as Awaited<ReturnType<typeof runChapterPlan>>);

  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Tells",
    premise: "p",
  });
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${b.id}/chapters`,
    "POST",
    { title: "Глава" },
  );
  chapterId = ch.id;
  const v = await sendJson<{ id: number }>(
    t.app,
    `/api/chapters/${ch.id}/versions`,
    "POST",
    {
      contentJson: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: CHAPTER_TEXT }] },
        ],
      },
    },
  );
  versionId = v.id;
});
afterEach(() => t.cleanup());

describe("POST /api/chapter-versions/:id/critique — structural tells", () => {
  it("measures the chapter and hands the rendered block to the critics", async () => {
    await sendJson(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

    expect(runCritiqueMock).toHaveBeenCalledTimes(1);
    const input = runCritiqueMock.mock.calls[0]![0]!.input;
    expect(input.structuralTellsContext).toContain("Структурные маркеры ИИ-прозы");
    // The block quotes the text it measured, not a stale or foreign one.
    expect(input.structuralTellsContext).toContain("не спал, а ждал");
  });

  it("appends the chapter's closing decision to the beat-sheet block", async () => {
    await sendJson(t.app, `/api/chapters/${chapterId}/plan`, "POST", {
      intent: "Завязка",
    });
    await sendJson(t.app, `/api/chapters/${chapterId}/plan/select`, "POST", {
      selectedIndex: 0,
    });

    await sendJson(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

    const input = runCritiqueMock.mock.calls[0]![0]!.input;
    expect(input.beatSheet).toContain("Финал главы: обрыв посреди действия — Обрыв на пороге.");
  });
});

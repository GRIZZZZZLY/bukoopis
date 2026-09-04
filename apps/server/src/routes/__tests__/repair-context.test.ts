import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the agents BEFORE importing the app: the repair handler streams from
// reviseChapter, and the critique POST is only used here to persist a report.
vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runCritique: vi.fn(),
  runChapterPlan: vi.fn(),
  runBookPlanning: vi.fn(),
  reviseChapter: vi.fn(),
}));

import {
  reviseChapter,
  runBookPlanning,
  runChapterPlan,
  runCritique,
} from "@book-forge/agents";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const reviseChapterMock = vi.mocked(reviseChapter);
const runCritiqueMock = vi.mocked(runCritique);
const runChapterPlanMock = vi.mocked(runChapterPlan);
const runBookPlanningMock = vi.mocked(runBookPlanning);

const ARCHITECTURE = {
  themeHandling: "implied",
  subplot: "contrasting",
  resolutionDriver: "external",
  endingMode: "partial",
  timeStructure: "moderate_anachrony",
  revelationPacing: "back_loaded",
  emotionMode: "behavior_led",
  rarityMove: "Победа достаётся антагонисту.",
  humanMoves: ["a", "b", "c"],
};

const REPORT = {
  critics: [
    {
      critic: "style",
      overallNotes: "Есть клише.",
      issues: [
        {
          severity: "suggestion",
          summary: "Клише в первом абзаце",
          excerpt: "сердце упало",
          suggestion: "Заменить на действие",
        },
      ],
    },
  ],
  blockingCount: 0,
  suggestionCount: 1,
  nitCount: 0,
  generatedAt: "2026-09-04T00:00:00.000Z",
};

let t: TestApp;
let bookId: number;
let chapterId: number;
let versionId: number;

beforeEach(async () => {
  t = makeTestApp();
  for (const m of [
    reviseChapterMock,
    runCritiqueMock,
    runChapterPlanMock,
    runBookPlanningMock,
  ]) {
    m.mockReset();
  }

  runCritiqueMock.mockResolvedValue({
    report: REPORT,
    errors: [],
  } as unknown as Awaited<ReturnType<typeof runCritique>>);

  runBookPlanningMock.mockResolvedValue([
    {
      label: "тёмный",
      logline: "l",
      synopsis: "s",
      themes: ["t"],
      protagonist: "p",
      antagonist: null,
      setting: "s",
      arcs: [
        { title: "a", summary: "s", keyBeats: ["b"] },
        { title: "b", summary: "s", keyBeats: ["b"] },
      ],
      estimatedChapters: 10,
      architecture: ARCHITECTURE,
    },
  ] as unknown as Awaited<ReturnType<typeof runBookPlanning>>);

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

  // eslint-disable-next-line require-yield
  reviseChapterMock.mockImplementation((async function* () {
    return {
      text: "Переработанный текст главы.",
      modelId: "test-model",
      tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
    };
  }) as unknown as typeof reviseChapter);

  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Repair-context",
    premise: "p",
  });
  bookId = b.id;
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава" },
  );
  chapterId = ch.id;
  const v = await sendJson<{ id: number }>(
    t.app,
    `/api/chapters/${chapterId}/versions`,
    "POST",
    {
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Сердце упало. Он не спал, а ждал." }],
          },
        ],
      },
    },
  );
  versionId = v.id;
});
afterEach(() => t.cleanup());

// The repair handler assembles its own copy of the prose context. Adding a
// context field for the critics therefore does not reach the Reviser unless it
// is added twice — that is how the architecture sheet was missed once already.
// These pin the structural decisions on the repair path specifically.
describe("POST /api/chapter-versions/:id/repair — structural context", () => {
  async function selectOutlineAndPlan(): Promise<void> {
    await sendJson(t.app, `/api/books/${bookId}/outline`, "POST", {});
    await sendJson(t.app, `/api/books/${bookId}/outline/select`, "POST", {
      selectedIndex: 0,
    });
    await sendJson(t.app, `/api/chapters/${chapterId}/plan`, "POST", {
      intent: "Завязка",
    });
    await sendJson(t.app, `/api/chapters/${chapterId}/plan/select`, "POST", {
      selectedIndex: 0,
    });
  }

  it("hands the Reviser the architecture sheet and the chapter's closing", async () => {
    await selectOutlineAndPlan();
    await sendJson(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/repair`,
      "POST",
      {},
    );
    await res.text(); // drain the SSE stream so the handler completes

    expect(reviseChapterMock).toHaveBeenCalledTimes(1);
    const input = reviseChapterMock.mock.calls[0]![0]!;
    expect(input.architectureContext).toContain("Финал: частичный");
    expect(input.architectureContext).toContain("Тема: подразумевается");
    expect(input.beatSheet).toContain("Финал главы: обрыв посреди действия");
  });

  it("leaves both fields empty when the book has no outline or plan", async () => {
    await sendJson(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/repair`,
      "POST",
      {},
    );
    await res.text();

    const input = reviseChapterMock.mock.calls[0]![0]!;
    expect(input.architectureContext).toBeNull();
    expect(input.beatSheet).toBeNull();
  });
});

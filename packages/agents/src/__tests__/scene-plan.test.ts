import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@book-forge/llm", async (orig) => {
  const actual = await orig<typeof import("@book-forge/llm")>();
  return { ...actual, dispatchStructured: vi.fn() };
});

import { dispatchStructured } from "@book-forge/llm";
import {
  buildScenePlanPrompt,
  runScenePlan,
  SCENE_PLAN_SYSTEM,
  type ScenePlanAgentInput,
} from "../scene-plan.js";

const input: ScenePlanAgentInput = {
  bookTitle: "Книга",
  chapterTitle: "Глава",
  chapterContent: "Мира находит письмо и идёт на вокзал.",
  beats: null,
  closingNote: "Мира садится в поезд",
  previousTail: "Хвост прошлой главы: дверь хлопнула.",
  previousSummary: null,
  characterContext: null,
  worldContext: null,
  sceneCount: 3,
};

const scene = (n: number) => ({
  events: [1, 2, 3].map((i) => `Событие ${n}.${i}`),
});

beforeEach(() => vi.mocked(dispatchStructured).mockReset());

describe("scene_plan", () => {
  it("промпт содержит содержание, число сцен, финал и хвост", () => {
    const p = buildScenePlanPrompt(input);
    expect(p).toContain("Мира находит письмо");
    expect(p).toContain("3");
    expect(p).toContain("Мира садится в поезд");
    expect(p).toContain("дверь хлопнула");
    expect(SCENE_PLAN_SYSTEM).toContain("6–8");
  });

  it("runScenePlan возвращает план; иное число сцен не правится", async () => {
    const raw = { scenes: [scene(1), scene(2)] };
    vi.mocked(dispatchStructured).mockResolvedValue({
      raw,
      diagnostics: { modelId: "m", inputTokens: 1, outputTokens: 1 },
    } as never);
    const out = await runScenePlan(input);
    expect(out).toEqual(raw);
    expect(out.scenes).toHaveLength(2);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@book-forge/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@book-forge/llm")>();
  return { ...actual, dispatchStructured: vi.fn() };
});

import { dispatchStructured } from "@book-forge/llm";
import type { CriticType } from "@book-forge/shared";
import type { CriticInput } from "../critics/base.js";
import { runCanonGuard } from "../critics/canon.js";
import { runCharacterCritic } from "../critics/character.js";
import { runEditorAgent } from "../critics/editor.js";
import { runReaderExperienceAgent } from "../critics/reader.js";
import { runStyleAgent } from "../critics/style.js";

/** F11 ревью 2026-09-22: обёртки критиков брали из ответа только `raw`, и
 *  `onUsage` маршрута не вызывался ни разу — расход критики в журнал не
 *  попадал. */

const base: CriticInput = {
  chapterText: "Текст главы.",
  chapterTitle: "Глава",
  pov: "Рин",
  emotionalGoal: "тревога",
  bookContext: "Книга",
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
};

beforeEach(() => {
  vi.mocked(dispatchStructured).mockReset().mockResolvedValue({
    raw: { overallNotes: "ок", issues: [] },
    diagnostics: {
      modelId: "claude-sonnet-4-6",
      backend: "api",
      inputTokens: 1200,
      outputTokens: 300,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 50,
      latencyMs: 1,
    },
  } as never);
});

describe("расход критиков", () => {
  const cases: Array<[CriticType, (i: CriticInput) => Promise<unknown>]> = [
    ["canon", runCanonGuard],
    ["character", runCharacterCritic],
    ["editor", runEditorAgent],
    ["reader", runReaderExperienceAgent],
    ["style", runStyleAgent],
  ];
  for (const [critic, run] of cases) {
    it(`${critic} передаёт расход в onUsage`, async () => {
      const onUsage = vi.fn();
      await run({ ...base, onUsage });
      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({ critic, inputTokens: 1200, outputTokens: 300, modelId: "claude-sonnet-4-6" }),
      );
    });
  }
});

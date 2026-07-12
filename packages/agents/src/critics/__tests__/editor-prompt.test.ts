import { describe, it, expect } from "vitest";
import { buildEditorPrompt } from "../editor.js";
import type { CriticInput } from "../base.js";

const base: CriticInput = {
  chapterText: "Текст главы.",
  chapterTitle: "Глава 1",
  pov: "Иван",
  emotionalGoal: "тревога",
  bookContext: "Контекст книги",
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
};

describe("buildEditorPrompt — optional beat-sheet", () => {
  it("includes the beat-sheet block and beat-aware task when provided", () => {
    const p = buildEditorPrompt({
      ...base,
      beatSheet: "1. [setup] Завязка\n   Цель: показать город",
    });
    expect(p).toContain("Принятый beat-sheet:\n1. [setup] Завязка");
    expect(p).toContain("Сверь главу с принятым beat-sheet");
    expect(p).not.toContain("Beat-sheet не передан");
  });

  it("omits the block and forbids false beat-sheet claims when absent", () => {
    const p = buildEditorPrompt(base);
    expect(p).not.toContain("Принятый beat-sheet:");
    expect(p).toContain("Beat-sheet не передан");
    expect(p).toContain("не утверждай, что глава ему противоречит");
  });
});

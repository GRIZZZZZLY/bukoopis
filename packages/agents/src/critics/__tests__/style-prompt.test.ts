import { describe, it, expect } from "vitest";
import { buildStylePrompt, STYLE_CRITIC_SYSTEM } from "../style.js";
import { CRITIC_CALIBRATION_RULE, type CriticInput } from "../base.js";

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

// The style critic used to judge from impression alone. It now receives the
// measured structural-tell block (counts per 1000 words with quotes) and a
// calibration rule shared with the other critics: quote or no signal,
// clusters not single hits, and a list of things that are not defects in
// Russian prose.

describe("buildStylePrompt — measured structural tells", () => {
  it("includes the measured block before the chapter text when provided", () => {
    const p = buildStylePrompt({
      ...base,
      structuralTellsContext: "Структурные маркеры ИИ-прозы (измерено; всего 10 слов)",
    });
    expect(p).toContain("Структурные маркеры ИИ-прозы (измерено; всего 10 слов)");
    expect(p.indexOf("Структурные маркеры")).toBeLessThan(p.indexOf("Текст главы:"));
  });

  it("omits the block when nothing was measured", () => {
    const p = buildStylePrompt(base);
    expect(p).not.toContain("Структурные маркеры");
    expect(p).not.toContain("измерен");
  });
});

describe("style critic system prompt", () => {
  it("carries the shared calibration rule", () => {
    expect(STYLE_CRITIC_SYSTEM).toContain(CRITIC_CALIBRATION_RULE);
  });

  it("tells the critic how to read the measured counters", () => {
    expect(STYLE_CRITIC_SYSTEM).toMatch(/на 1000 слов/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/каденци/i);
  });
});

describe("CRITIC_CALIBRATION_RULE", () => {
  it("requires a quote per signal and counts clusters, not single hits", () => {
    expect(CRITIC_CALIBRATION_RULE).toMatch(/нет цитаты/i);
    expect(CRITIC_CALIBRATION_RULE).toMatch(/кластер/i);
  });

  it("exempts тире and a prescribed dense style from being flagged", () => {
    expect(CRITIC_CALIBRATION_RULE).toMatch(/тире/);
    expect(CRITIC_CALIBRATION_RULE).toMatch(/«Стиль»/);
  });

  it("names over-correction as a separate failure mode", () => {
    expect(CRITIC_CALIBRATION_RULE).toMatch(/перегиб|over-correction/i);
  });
});

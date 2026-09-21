import { describe, it, expect } from "vitest";
import { buildWriterVolatilePrompt, type WriteChapterInput } from "../writer.js";

const beat = (i: number, summary: string) => ({
  index: i,
  type: "rising_action" as const,
  summary,
  goal: `цель ${i}`,
  conflict: `конфликт ${i}`,
  outcome: `исход ${i}`,
});

const base: WriteChapterInput = {
  bookTitle: "К",
  bookPremise: "п",
  bookOutline: null,
  studioContext: null,
  retrievedContext: null,
  chapterTitle: "Глава 4",
  beatSheet: {
    label: "v1",
    pov: "Нина",
    emotionalGoal: "тревога",
    estimatedWords: 3000,
    beats: [beat(0, "Нина у мотора"), beat(1, "Приходит Ворт"), beat(2, "Ссора")],
    closing: { mode: "open", note: "дверь остаётся открытой" },
  },
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
  styleContext: null,
  fatigueWords: [],
};

describe("промпт беата", () => {
  it("несёт уже написанное, требует только текущий беат и не завершать главу", () => {
    const p = buildWriterVolatilePrompt({
      ...base,
      beat: { index: 1, textSoFar: "Нина стояла у мотора и молчала." },
    });
    expect(p).toContain("Нина стояла у мотора и молчала.");
    expect(p).toMatch(/ТОЛЬКО беат 2 из 3/);
    expect(p).toContain("Приходит Ворт");
    expect(p).toMatch(/не завершай главу/i);
    expect(p).toMatch(/~1000 слов/);
    expect(p).not.toContain("Напиши главу.");
  });

  it("последний беат получает финал главы, первый — пометку о начале", () => {
    const last = buildWriterVolatilePrompt({ ...base, beat: { index: 2, textSoFar: "…" } });
    expect(last).toMatch(/последний беат/i);
    expect(last).toContain("дверь остаётся открытой");
    expect(last).not.toMatch(/не завершай главу/i);
    const first = buildWriterVolatilePrompt({ ...base, beat: { index: 0, textSoFar: "" } });
    expect(first).toMatch(/глава только начинается/i);
  });

  it("без beat промпт прежний — целая глава", () => {
    const p = buildWriterVolatilePrompt(base);
    expect(p).toContain("Напиши главу.");
    expect(p).not.toMatch(/ТОЛЬКО беат/);
  });
});

import { describe, it, expect } from "vitest";
import { buildWriterStableSystem, type WriteChapterInput } from "../writer.js";

const base: WriteChapterInput = {
  bookTitle: "Книга",
  bookPremise: "Премиса",
  bookOutline: null,
  studioContext: null,
  retrievedContext: null,
  chapterTitle: "Глава 2",
  beatSheet: {
    pov: "Иван",
    emotionalGoal: "тревога",
    beats: [],
  } as unknown as WriteChapterInput["beatSheet"],
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
  styleContext: null,
  fatigueWords: [],
};

describe("buildWriterStableSystem — previous chapter tail", () => {
  it("includes the verbatim tail with an instruction to continue from it", () => {
    const system = buildWriterStableSystem({
      ...base,
      previousChapterTail: "Он закрыл дверь и не обернулся.",
    });

    expect(system).toContain("Он закрыл дверь и не обернулся.");
    expect(system).toContain("Финал предыдущей главы");
  });

  it("omits the tail block when there is no preceding chapter", () => {
    const system = buildWriterStableSystem(base);

    expect(system).not.toContain("Финал предыдущей главы");
  });

  it("keeps the tail distinct from the previous-chapters summary", () => {
    const system = buildWriterStableSystem({
      ...base,
      previousChaptersSummary: "Иван приехал в город.",
      previousChapterTail: "Он закрыл дверь и не обернулся.",
    });

    expect(system).toContain("Краткое содержание предыдущих глав:");
    expect(system).toContain("Финал предыдущей главы");
    // The tail must come after the summary — nearest context sits closest to
    // the task, and the summary stays a stable cache prefix for longer.
    expect(system.indexOf("Финал предыдущей главы")).toBeGreaterThan(
      system.indexOf("Краткое содержание предыдущих глав:"),
    );
  });
});

import { describe, it, expect } from "vitest";
import { estimatePerChapterUsd } from "./chapter-cost";

describe("estimatePerChapterUsd", () => {
  it("returns a positive number for sonnet/sonnet/sonnet", () => {
    expect(estimatePerChapterUsd("sonnet", "sonnet", "sonnet")).toBeGreaterThan(0);
  });

  it("opus writer costs more than sonnet writer (plot/critic fixed)", () => {
    const opus = estimatePerChapterUsd("opus", "sonnet", "sonnet");
    const sonnet = estimatePerChapterUsd("sonnet", "sonnet", "sonnet");
    expect(opus).toBeGreaterThan(sonnet);
  });
});

describe("PER_CHAPTER_TOKENS", () => {
  it("пачка критиков считается по их числу, а не константой четырёх (F11)", async () => {
    const { PER_CHAPTER_TOKENS } = await import("./chapter-cost");
    const { ALL_CRITIC_TYPES } = await import("@book-forge/shared");
    // +1 — второй вызов критика стиля (проверка отдельных фраз).
    expect(PER_CHAPTER_TOKENS.critic.input).toBe(3000 * (ALL_CRITIC_TYPES.length + 1));
  });
});

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

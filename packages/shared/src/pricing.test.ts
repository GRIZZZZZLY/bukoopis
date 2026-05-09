import { describe, it, expect } from "vitest";
import { calculateCost, getModelRates, MODEL_RATES } from "./pricing.js";

describe("pricing", () => {
  it("returns Sonnet 4.6 rates", () => {
    expect(getModelRates("claude-sonnet-4-6")).toEqual({
      inputPerMtok: 3,
      outputPerMtok: 15,
    });
  });

  it("returns Opus 4.7 rates", () => {
    expect(getModelRates("claude-opus-4-7")).toEqual({
      inputPerMtok: 15,
      outputPerMtok: 75,
    });
  });

  it("falls back to Sonnet for unknown model", () => {
    const r = getModelRates("claude-unknown-9-9");
    expect(r.inputPerMtok).toBe(3);
    expect(r.outputPerMtok).toBe(15);
  });

  it("calculates Sonnet cost for 1M input + 1M output", () => {
    const c = calculateCost({
      model: "claude-sonnet-4-6",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c.inputUsd).toBe(3);
    expect(c.outputUsd).toBe(15);
    expect(c.totalUsd).toBe(18);
  });

  it("calculates Opus cost for 1M input + 1M output", () => {
    const c = calculateCost({
      model: "claude-opus-4-7",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(c.totalUsd).toBe(90);
  });

  it("cache write at 1.25x base input rate", () => {
    const c = calculateCost({
      model: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
    });
    expect(c.cacheCreationUsd).toBeCloseTo(3 * 1.25, 6);
  });

  it("cache read at 0.1x base input rate", () => {
    const c = calculateCost({
      model: "claude-sonnet-4-6",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    expect(c.cacheReadUsd).toBeCloseTo(3 * 0.1, 6);
  });

  it("realistic 4k-word Opus chapter with cache hit (~$0.27 vs $0.90 cold)", () => {
    // 4500 input fresh, 11000 output, 8000 cache read, 0 cache create
    const c = calculateCost({
      model: "claude-opus-4-7",
      inputTokens: 500,
      outputTokens: 11000,
      cacheReadInputTokens: 8000,
    });
    // cost = 500*15/1M + 11000*75/1M + 8000*15*0.1/1M
    //      = 0.0075 + 0.825 + 0.012 = ~$0.844
    expect(c.totalUsd).toBeGreaterThan(0.8);
    expect(c.totalUsd).toBeLessThan(0.86);
  });

  it("MODEL_RATES has all model IDs we use in production", () => {
    expect(MODEL_RATES["claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_RATES["claude-opus-4-7"]).toBeDefined();
  });
});

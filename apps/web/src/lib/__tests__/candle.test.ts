import { describe, it, expect, beforeEach } from "vitest";
import {
  candleLevel,
  DEFAULT_WORD_GOAL,
  readWordGoal,
  saveWordGoal,
} from "../candle";

describe("candleLevel", () => {
  it("clamps to 0..1", () => {
    expect(candleLevel(0, 500)).toBe(0);
    expect(candleLevel(250, 500)).toBe(0.5);
    expect(candleLevel(700, 500)).toBe(1);
    expect(candleLevel(-10, 500)).toBe(0);
  });
  it("guards nonsense goals", () => {
    expect(candleLevel(100, 0)).toBe(0);
    expect(candleLevel(100, -5)).toBe(0);
    expect(candleLevel(100, Number.NaN)).toBe(0);
  });
});

describe("word goal storage", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to DEFAULT_WORD_GOAL", () => {
    expect(readWordGoal()).toBe(DEFAULT_WORD_GOAL);
  });
  it("persists and restores", () => {
    saveWordGoal(800);
    expect(readWordGoal()).toBe(800);
  });
  it("falls back on junk values", () => {
    localStorage.setItem("bf-word-goal", "-3");
    expect(readWordGoal()).toBe(DEFAULT_WORD_GOAL);
    localStorage.setItem("bf-word-goal", "abc");
    expect(readWordGoal()).toBe(DEFAULT_WORD_GOAL);
  });
});

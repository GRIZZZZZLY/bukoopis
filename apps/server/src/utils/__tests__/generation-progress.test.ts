import { describe, it, expect } from "vitest";
import {
  ESTIMATED_TOTAL_MS,
  ProgressTracker,
  progressPct,
} from "../generation-progress.js";

describe("progressPct", () => {
  it("pins short phases to their floor", () => {
    expect(progressPct("context", 0)).toBe(3);
    expect(progressPct("dispatch", 50_000)).toBe(8);
    expect(progressPct("validating", 1_000)).toBe(95);
  });

  it("interpolates the waiting phase by elapsed time", () => {
    expect(progressPct("writing", 0)).toBe(20);
    const half = progressPct("writing", ESTIMATED_TOTAL_MS / 2);
    expect(half).toBeGreaterThan(20);
    expect(half).toBeLessThan(88);
  });

  it("never exceeds the waiting-phase ceiling, however long it runs", () => {
    expect(progressPct("writing", ESTIMATED_TOTAL_MS * 10)).toBe(88);
  });

  it("reports 100 only for done", () => {
    expect(progressPct("done", 0)).toBe(100);
  });
});

describe("ProgressTracker", () => {
  it("never moves backwards within one attempt", () => {
    const t = new ProgressTracker();
    t.setPhase("writing", ESTIMATED_TOTAL_MS / 2);
    const mid = t.pct;
    t.setPhase("model", ESTIMATED_TOTAL_MS / 2);
    expect(t.pct).toBe(mid);
  });

  it("rolls the percent back on retry and re-bases the estimate", () => {
    const t = new ProgressTracker();
    t.setPhase("writing", ESTIMATED_TOTAL_MS);
    expect(t.pct).toBe(88);
    // Попытка 2 началась на 80-й секунде общего времени.
    t.markAttempt(2, ESTIMATED_TOTAL_MS);
    expect(t.attempt).toBe(2);
    expect(t.pct).toBe(8);
    expect(t.attemptElapsedMs(ESTIMATED_TOTAL_MS)).toBe(0);
    // Через полминуты второй попытки процент считается от её начала, а не от
    // общего времени — иначе полоса сразу упиралась бы в потолок.
    t.setPhase("model", ESTIMATED_TOTAL_MS + 30_000);
    expect(t.pct).toBeGreaterThan(8);
    expect(t.pct).toBeLessThan(60);
  });

  it("stays below 100 until finish()", () => {
    const t = new ProgressTracker();
    t.setPhase("validating", ESTIMATED_TOTAL_MS * 5);
    expect(t.pct).toBeLessThan(100);
    expect(t.finish()).toBe(100);
    expect(t.phase).toBe("done");
  });
});

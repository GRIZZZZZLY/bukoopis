import { describe, it, expect } from "vitest";
import {
  shelfProgress,
  spineHeight,
  spineTone,
  spineWidth,
  titleSeed,
} from "../shelf";

describe("shelf geometry", () => {
  it("titleSeed is deterministic and differs across titles", () => {
    expect(titleSeed("Маяк")).toBe(titleSeed("Маяк"));
    expect(titleSeed("Маяк")).not.toBe(titleSeed("Зима"));
  });

  it("spineWidth grows with chapters and clamps", () => {
    expect(spineWidth(0)).toBe(46);
    expect(spineWidth(5)).toBe(56);
    expect(spineWidth(100)).toBe(78);
    expect(spineWidth(Number.NaN)).toBe(46);
    expect(spineWidth(-3)).toBe(46);
  });

  it("spineHeight stays within the shelf row", () => {
    for (const ch of [0, 1, 12, 24, 60]) {
      for (const seed of [0, 1, 2, 7, 12345]) {
        const h = spineHeight(ch, seed);
        expect(h).toBeGreaterThanOrEqual(170);
        expect(h).toBeLessThanOrEqual(234);
      }
    }
  });

  it("spineTone maps seed to 0..3", () => {
    expect([0, 1, 2, 3]).toContain(spineTone(titleSeed("Маяк")));
    expect(spineTone(7)).toBe(3);
  });

  it("shelfProgress clamps and guards zero chapters", () => {
    expect(shelfProgress(0, 0)).toBe(0);
    expect(shelfProgress(1, 2)).toBe(0.5);
    expect(shelfProgress(5, 2)).toBe(1);
  });
});

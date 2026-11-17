import { describe, it, expect } from "vitest";
import { shouldShowDust } from "../DustLayer";

describe("shouldShowDust", () => {
  it("only in full atmosphere and never on chapter route", () => {
    expect(shouldShowDust("full", "books")).toBe(true);
    expect(shouldShowDust("full", "chapter")).toBe(false);
    expect(shouldShowDust("calm", "books")).toBe(false);
    expect(shouldShowDust("off", "books")).toBe(false);
  });
});

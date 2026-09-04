import { describe, it, expect } from "vitest";
import { READER_CRITIC_SYSTEM } from "../reader.js";
import { CRITIC_CALIBRATION_RULE } from "../base.js";

// Discourse-level tells from the 2026-09-04 review that only a reader notices:
// the reflection tail, the predictable middle, one cadence for the whole
// chapter, the narrator explaining the theme.

describe("reader critic system prompt — discourse checks", () => {
  it("flags the reflection tail", () => {
    expect(READER_CRITIC_SYSTEM).toMatch(/осмыслени/i);
  });

  it("flags a middle the opening already predicts", () => {
    expect(READER_CRITIC_SYSTEM).toMatch(/середин/i);
  });

  it("flags the narrator explaining the theme", () => {
    expect(READER_CRITIC_SYSTEM).toMatch(/объясняет тему|тему словами/i);
  });

  it("carries the shared calibration rule", () => {
    expect(READER_CRITIC_SYSTEM).toContain(CRITIC_CALIBRATION_RULE);
  });
});

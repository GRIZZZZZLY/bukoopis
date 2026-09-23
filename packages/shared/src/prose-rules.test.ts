import { describe, it, expect } from "vitest";
import { LLM_CLICHE_PHRASES_RU, renderClicheRule } from "./prose-rules.js";

describe("renderClicheRule — обороты «тело раньше сознания»", () => {
  it("names the concrete phrases, not just the device", () => {
    const rule = renderClicheRule();
    for (const p of LLM_CLICHE_PHRASES_RU) expect(rule).toContain(`«${p}»`);
  });
});

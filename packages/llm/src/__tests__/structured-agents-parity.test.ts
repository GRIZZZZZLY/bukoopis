import { describe, it, expect } from "vitest";
import { AGENT_NAMES, STRUCTURED_AGENT_NAMES, type AgentName } from "../index.js";

/**
 * Drift guard: keeps STRUCTURED_AGENT_NAMES in sync with AgentName as
 * agents migrate phase-by-phase. When Phase 3 lands a new structured
 * contract (e.g. critic_style), the contributor must (a) add the agent
 * to STRUCTURED_AGENT_NAMES in types.ts and (b) remove it from this
 * exclusion list. The test fails until both edits land.
 */
const KNOWN_FREE_TEXT_OR_NOLLM: AgentName[] = [
  "writer",
  "editor",
  "summarizer",
  "inline",
  "lore",
  "character",
  "book_chat",
];

describe("STRUCTURED_AGENT_NAMES drift guard", () => {
  it("covers every AgentName except the documented exclusion list", () => {
    const expected = new Set(
      AGENT_NAMES.filter((n) => !KNOWN_FREE_TEXT_OR_NOLLM.includes(n)),
    );
    const actual = new Set(STRUCTURED_AGENT_NAMES);
    expect(actual).toEqual(expected);
  });
});

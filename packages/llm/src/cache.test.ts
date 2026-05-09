import { describe, expect, it } from "vitest";
import { buildSystemParam } from "./stream.js";

describe("buildSystemParam", () => {
  it("wraps string system in ephemeral cache block when cacheable", () => {
    const out = buildSystemParam("hello", true);
    expect(out).toEqual([
      { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("returns plain string when caching disabled", () => {
    const out = buildSystemParam("hello", false);
    expect(out).toBe("hello");
  });

  it("passes pre-built block array through unchanged regardless of flag", () => {
    const blocks = [
      { type: "text" as const, text: "a" },
      {
        type: "text" as const,
        text: "b",
        cache_control: { type: "ephemeral" as const },
      },
    ];
    expect(buildSystemParam(blocks, true)).toBe(blocks);
    expect(buildSystemParam(blocks, false)).toBe(blocks);
  });
});

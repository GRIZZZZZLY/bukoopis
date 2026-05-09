import { describe, it, expect } from "vitest";
import {
  findInvariantViolations,
  assertStudioStateInvariants,
  type StudioInvariantViolation,
} from "./studio-invariants.js";
import type { StudioState } from "./studio-state.js";
import { emptyStudioState } from "./studio-state.js";

function withWorld(s: StudioState, aspects: StudioState["stages"]["world"]["aspects"]): StudioState {
  return {
    ...s,
    stages: {
      ...s.stages,
      world: {
        status: "in_progress",
        playbookGenerated: true,
        aspects,
      },
    },
  };
}

describe("studio-invariants", () => {
  it("empty state has no violations", () => {
    expect(findInvariantViolations(emptyStudioState())).toEqual([]);
  });

  it("accepted aspect without finalPayload → violation", () => {
    const s = withWorld(emptyStudioState(), [
      {
        id: "a1",
        name: "география",
        status: "accepted",
        order: 0,
        required: true,
        source: "llm",
        payloadKind: "markdown",
        variants: [],
        // finalPayload missing
      },
    ]);
    const v = findInvariantViolations(s);
    expect(v.map((x) => x.code)).toContain("accepted_without_final_payload");
  });

  it("selectedVariantId must reference existing variant", () => {
    const s = withWorld(emptyStudioState(), [
      {
        id: "a1",
        name: "география",
        status: "reviewing",
        order: 0,
        required: true,
        source: "llm",
        payloadKind: "markdown",
        variants: [],
        selectedVariantId: "ghost",
      },
    ]);
    const v = findInvariantViolations(s);
    expect(v.map((x) => x.code)).toContain("selected_variant_missing");
  });

  it("more than one accepted variant → violation", () => {
    const s = withWorld(emptyStudioState(), [
      {
        id: "a1",
        name: "география",
        status: "reviewing",
        order: 0,
        required: true,
        source: "llm",
        payloadKind: "markdown",
        variants: [
          { id: "v1", label: "1", payloadKind: "markdown", payload: "x", status: "accepted", editSource: "llm", generatedAt: "2026-05-09T20:00:00.000Z" },
          { id: "v2", label: "2", payloadKind: "markdown", payload: "x", status: "accepted", editSource: "llm", generatedAt: "2026-05-09T20:00:00.000Z" },
        ],
      },
    ]);
    const v = findInvariantViolations(s);
    expect(v.map((x) => x.code)).toContain("multiple_accepted_variants");
  });

  it("parentVariantId must reference existing variant; parent must be superseded", () => {
    const s = withWorld(emptyStudioState(), [
      {
        id: "a1",
        name: "география",
        status: "reviewing",
        order: 0,
        required: true,
        source: "llm",
        payloadKind: "markdown",
        variants: [
          { id: "child", label: "c", payloadKind: "markdown", payload: "x", status: "generated", editSource: "refine", generatedAt: "2026-05-09T20:00:00.000Z", parentVariantId: "ghost" },
        ],
      },
    ]);
    const v = findInvariantViolations(s);
    expect(v.map((x) => x.code)).toContain("parent_variant_missing");
  });

  it("variant payloadKind must match aspect.payloadKind", () => {
    const s = withWorld(emptyStudioState(), [
      {
        id: "a1",
        name: "география",
        status: "reviewing",
        order: 0,
        required: true,
        source: "llm",
        payloadKind: "markdown",
        variants: [
          { id: "v1", label: "1", payloadKind: "entity_set", payload: { candidates: [] }, status: "generated", editSource: "llm", generatedAt: "2026-05-09T20:00:00.000Z" },
        ],
      },
    ]);
    const v = findInvariantViolations(s);
    expect(v.map((x) => x.code)).toContain("variant_payload_kind_mismatch");
  });

  it("stage complete with required pending aspect → violation", () => {
    const s = withWorld(emptyStudioState(), [
      {
        id: "a1",
        name: "география",
        status: "pending",
        order: 0,
        required: true,
        source: "llm",
        payloadKind: "markdown",
        variants: [],
      },
    ]);
    s.stages.world!.status = "complete";
    const v = findInvariantViolations(s);
    expect(v.map((x) => x.code)).toContain("stage_complete_with_pending_required");
  });

  it("assertStudioStateInvariants throws with all violations in message", () => {
    const s = withWorld(emptyStudioState(), [
      {
        id: "a1",
        name: "география",
        status: "accepted",
        order: 0,
        required: true,
        source: "llm",
        payloadKind: "markdown",
        variants: [],
      },
    ]);
    expect(() => assertStudioStateInvariants(s)).toThrow(/accepted_without_final_payload/);
  });
});

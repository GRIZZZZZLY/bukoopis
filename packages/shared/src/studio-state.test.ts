import { describe, it, expect } from "vitest";
import {
  studioStateSchema,
  stageAspectSchema,
  aspectVariantSchema,
  entitySetPayloadSchema,
  studioEventPayloadSchema,
  PAYLOAD_KINDS,
  ASPECT_STATUSES,
  VARIANT_STATUSES,
  STAGE_IDS,
  emptyStudioState,
} from "./studio-state.js";

describe("studio-state schemas", () => {
  it("emptyStudioState is schemaVersion 1, revision 0, no stages", () => {
    const s = emptyStudioState();
    expect(s.schemaVersion).toBe(1);
    expect(s.revision).toBe(0);
    expect(s.stages).toEqual({});
    expect(studioStateSchema.parse(s)).toEqual(s);
  });

  it("STAGE_IDS contains all 7 stages", () => {
    expect(STAGE_IDS).toEqual([
      "concept",
      "world",
      "lore",
      "characters",
      "items",
      "plot",
      "chapters",
    ]);
  });

  it("PAYLOAD_KINDS lists 4 kinds", () => {
    expect(PAYLOAD_KINDS).toEqual([
      "markdown",
      "premise_field",
      "entity_set",
      "import_candidate",
    ]);
  });

  it("aspectVariantSchema accepts a valid markdown variant", () => {
    const v = aspectVariantSchema.parse({
      id: "01J0000",
      label: "Север",
      payloadKind: "markdown",
      payload: "Архипелаг на севере…",
      status: "generated",
      editSource: "llm",
      generatedAt: "2026-05-09T20:00:00.000Z",
    });
    expect(v.status).toBe("generated");
    expect(v.parentVariantId).toBeUndefined();
  });

  it("aspectVariantSchema rejects unknown payloadKind", () => {
    const r = aspectVariantSchema.safeParse({
      id: "01J0000",
      label: "X",
      payloadKind: "weird",
      payload: "x",
      status: "generated",
      editSource: "llm",
      generatedAt: "2026-05-09T20:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("entitySetPayloadSchema accepts character candidate set", () => {
    const set = entitySetPayloadSchema.parse({
      candidates: [
        {
          tempId: "t1",
          kind: "character",
          profile: { name: "Айрис" },
          status: "proposed",
        },
      ],
    });
    expect(set.candidates).toHaveLength(1);
  });

  it("stageAspectSchema requires order >= 0 and required boolean", () => {
    const ok = stageAspectSchema.parse({
      id: "01J1",
      name: "география",
      status: "pending",
      order: 0,
      required: true,
      source: "llm",
      payloadKind: "markdown",
      variants: [],
    });
    expect(ok.order).toBe(0);
    const bad = stageAspectSchema.safeParse({
      id: "01J1",
      name: "география",
      status: "pending",
      order: -1,
      required: true,
      source: "llm",
      payloadKind: "markdown",
      variants: [],
    });
    expect(bad.success).toBe(false);
  });

  it("studioEventPayloadSchema permits all-optional payload", () => {
    expect(studioEventPayloadSchema.parse({})).toEqual({});
  });

  it("VARIANT_STATUSES + ASPECT_STATUSES match spec", () => {
    expect(VARIANT_STATUSES).toEqual([
      "generated",
      "edited",
      "accepted",
      "rejected",
      "superseded",
    ]);
    expect(ASPECT_STATUSES).toEqual([
      "pending",
      "generating",
      "reviewing",
      "accepted",
      "skipped",
    ]);
  });

  it("studioStateSchema rejects unknown stageId in stages map", () => {
    const r = studioStateSchema.safeParse({
      schemaVersion: 1,
      revision: 0,
      stages: { unknown_stage: { status: "not_started", playbookGenerated: false, aspects: [] } },
    });
    expect(r.success).toBe(false);
  });
});

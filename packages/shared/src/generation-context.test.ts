import { describe, it, expect } from "vitest";
import {
  snapshotFingerprint,
  contextManifestSchema,
  type ContextSourceRef,
} from "./generation-context.js";

const ref = (
  kind: ContextSourceRef["kind"],
  id: number,
  versionId: number | null = null,
  revision: number | null = null,
): ContextSourceRef => ({ kind, id, versionId, revision });

describe("отпечаток набора источников", () => {
  it("не зависит от порядка перечисления", () => {
    const a = snapshotFingerprint([ref("chapter_version", 1, 7), ref("character", 2, null, 3)]);
    const b = snapshotFingerprint([ref("character", 2, null, 3), ref("chapter_version", 1, 7)]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("меняется, когда меняется версия источника", () => {
    // Ради этого он и существует: критика по другой версии главы обязана
    // отличаться от Writer'а, даже если список источников тот же.
    expect(snapshotFingerprint([ref("chapter_version", 1, 7)])).not.toBe(
      snapshotFingerprint([ref("chapter_version", 1, 8)]),
    );
    expect(snapshotFingerprint([ref("character", 1, null, 0)])).not.toBe(
      snapshotFingerprint([ref("character", 1, null, 1)]),
    );
  });

  it("различает одинаковые id разных видов и пустой набор", () => {
    expect(snapshotFingerprint([ref("character", 1)])).not.toBe(
      snapshotFingerprint([ref("event", 1)]),
    );
    expect(snapshotFingerprint([])).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshotFingerprint([])).not.toBe(snapshotFingerprint([ref("character", 1)]));
  });

  it("manifest читается, недостающие версии становятся null", () => {
    const r = contextManifestSchema.safeParse({
      purpose: "writer",
      sources: [{ kind: "character", id: 3 }],
      includedSections: ["characters"],
      droppedSections: [{ id: "style", tokens: 120 }],
      budgetTokens: 80000,
      usedTokens: 120,
      promptVersion: "stage4-1",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.sources[0]?.versionId).toBeNull();
    expect(r.data.sources[0]?.revision).toBeNull();
  });

  it("неизвестная цель или вид источника отвергаются", () => {
    expect(
      contextManifestSchema.safeParse({
        purpose: "planner",
        sources: [],
        includedSections: [],
        droppedSections: [],
        budgetTokens: 1,
        usedTokens: 0,
        promptVersion: "x",
      }).success,
    ).toBe(false);
  });
});

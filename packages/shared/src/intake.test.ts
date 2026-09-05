import { describe, it, expect } from "vitest";
import {
  INTAKE_TARGETS,
  INTAKE_TARGET_LABELS,
  intakeFragmentSchema,
  buildImportedMarkdownAspect,
  buildImportedEntityAspect,
  mergeAspectsIntoStage,
  summarizeIntake,
  type IntakeFragment,
} from "./intake.js";
import { assertStudioStateInvariants } from "./studio-invariants.js";
import { emptyStudioState } from "./studio-state.js";

const NOW = "2026-09-05T10:00:00.000Z";

const WORLD: IntakeFragment = {
  target: "world",
  title: "Карта и маршруты",
  body: "Барьер делит два мира. Караваны идут ритуальными коридорами.",
  note: "география и логистика",
};

const PEOPLE: IntakeFragment = {
  target: "characters",
  title: "Связи и конфликты",
  body: "Нейла — проводница каравана.\nРахир — пустынный метролог.",
  note: "два героя",
  entities: [
    { name: "Нейла", summary: "Проводница каравана, верит карте больше, чем себе." },
    { name: "Рахир", summary: "Пустынный метролог, читает соляные пласты." },
  ],
};

describe("INTAKE_TARGETS", () => {
  it("covers every stage the author can receive material into, plus skip", () => {
    expect([...INTAKE_TARGETS]).toEqual([
      "concept", "world", "lore", "characters", "items", "plot", "chapters", "skip",
    ]);
  });

  it("every target has a Russian label", () => {
    for (const t of INTAKE_TARGETS) {
      expect(INTAKE_TARGET_LABELS[t].length).toBeGreaterThan(0);
    }
    expect(INTAKE_TARGET_LABELS.chapters).toBe("Готовые главы");
    expect(INTAKE_TARGET_LABELS.skip).toBe("Не пригодилось");
  });
});

describe("intakeFragmentSchema", () => {
  it("accepts a markdown fragment without entities", () => {
    expect(intakeFragmentSchema.safeParse(WORLD).success).toBe(true);
  });

  it("rejects an empty body", () => {
    expect(intakeFragmentSchema.safeParse({ ...WORLD, body: "  " }).success).toBe(false);
  });

  it("accepts entities only as name plus summary", () => {
    expect(intakeFragmentSchema.safeParse(PEOPLE).success).toBe(true);
    expect(
      intakeFragmentSchema.safeParse({ ...PEOPLE, entities: [{ name: "", summary: "x" }] }).success,
    ).toBe(false);
  });
});

describe("buildImportedMarkdownAspect", () => {
  it("produces a reviewing draft with one generated variant and no finalPayload", () => {
    const a = buildImportedMarkdownAspect(WORLD, 3, NOW);
    expect(a.status).toBe("reviewing");
    expect(a.finalPayload).toBeUndefined();
    expect(a.source).toBe("import");
    expect(a.payloadKind).toBe("markdown");
    expect(a.required).toBe(false);
    expect(a.order).toBe(3);
    expect(a.name).toBe("Карта и маршруты");
    expect(a.variants).toHaveLength(1);
    const v = a.variants[0]!;
    expect(v.payloadKind).toBe("markdown");
    expect(v.payload).toBe(WORLD.body);
    expect(v.status).toBe("generated");
    expect(v.editSource).toBe("manual");
    expect(v.generatedAt).toBe(NOW);
    expect(v.label).toBe("из ваших материалов");
    expect(a.selectedVariantId).toBeUndefined();
  });

  it("carries the classifier's note into the aspect description", () => {
    expect(buildImportedMarkdownAspect(WORLD, 0, NOW).description).toBe("география и логистика");
  });

  it("gives each aspect and variant distinct ids", () => {
    const a = buildImportedMarkdownAspect(WORLD, 0, NOW);
    const b = buildImportedMarkdownAspect(WORLD, 1, NOW);
    expect(a.id).not.toBe(b.id);
    expect(a.variants[0]!.id).not.toBe(b.variants[0]!.id);
    expect(a.id).not.toBe(a.variants[0]!.id);
  });
});

describe("buildImportedEntityAspect", () => {
  it("produces an entity_set draft whose variant payload holds proposed candidates", () => {
    const a = buildImportedEntityAspect(PEOPLE, 0, NOW)!;
    expect(a.payloadKind).toBe("entity_set");
    expect(a.status).toBe("reviewing");
    expect(a.finalPayload).toBeUndefined();
    const v = a.variants[0]!;
    expect(v.payloadKind).toBe("entity_set");
    const payload = v.payload as { candidates: Array<Record<string, unknown>> };
    expect(payload.candidates).toHaveLength(2);
    expect(payload.candidates[0]).toMatchObject({ kind: "character", status: "proposed" });
    expect(payload.candidates[0]!.profile).toEqual({
      name: "Нейла",
      summary: "Проводница каравана, верит карте больше, чем себе.",
    });
    expect(new Set(payload.candidates.map((c) => c.tempId)).size).toBe(2);
  });

  it("uses the item kind for the items stage", () => {
    const a = buildImportedEntityAspect({ ...PEOPLE, target: "items" }, 0, NOW)!;
    const payload = a.variants[0]!.payload as { candidates: Array<{ kind: string }> };
    expect(payload.candidates.every((c) => c.kind === "item")).toBe(true);
  });

  it("returns undefined when the fragment carries no entities", () => {
    expect(buildImportedEntityAspect({ ...PEOPLE, entities: [] }, 0, NOW)).toBeUndefined();
  });
});

describe("mergeAspectsIntoStage", () => {
  it("appends after existing aspects, continues the order and never lowers the stage status", () => {
    const stage = {
      status: "complete" as const,
      playbookGenerated: true,
      aspects: [
        {
          id: "old", name: "Уже принято", status: "accepted" as const, order: 0,
          required: true, source: "llm" as const, payloadKind: "markdown" as const,
          variants: [], finalPayload: "текст",
        },
      ],
    };
    const fresh = [buildImportedMarkdownAspect(WORLD, 0, NOW)];
    const next = mergeAspectsIntoStage(stage, fresh, NOW);
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects[1]!.order).toBe(1);
    expect(next.aspects[0]!.id).toBe("old");
    expect(next.status).toBe("complete");
    expect(next.updatedAt).toBe(NOW);
  });

  it("moves an untouched stage into in_progress", () => {
    const next = mergeAspectsIntoStage(
      { status: "not_started", playbookGenerated: false, aspects: [] },
      [buildImportedMarkdownAspect(WORLD, 0, NOW)],
      NOW,
    );
    expect(next.status).toBe("in_progress");
    expect(next.aspects[0]!.order).toBe(0);
  });

  it("reopens a stage the author had skipped when their own material lands on it", () => {
    // `deriveStageStatus` treats an explicit skip as the author's word and never
    // overrides it — so unless the merge reopens the stage here, drafts dropped
    // onto a skipped stage stay invisible forever.
    const next = mergeAspectsIntoStage(
      {
        status: "skipped",
        skippedReason: "Пропущен автором",
        playbookGenerated: false,
        aspects: [],
      },
      [buildImportedMarkdownAspect(WORLD, 0, NOW)],
      NOW,
    );
    expect(next.status).toBe("in_progress");
    expect(next.skippedReason).toBeUndefined();
  });

  it("leaves the stage alone when there is nothing fresh to add", () => {
    const stage = {
      status: "skipped" as const,
      skippedReason: "Пропущен автором",
      playbookGenerated: false,
      aspects: [],
    };
    expect(mergeAspectsIntoStage(stage, [], NOW)).toEqual(stage);
  });

  it("produces a state the studio invariants accept", () => {
    const state = emptyStudioState();
    state.stages.world = mergeAspectsIntoStage(
      { status: "not_started", playbookGenerated: false, aspects: [] },
      [buildImportedMarkdownAspect(WORLD, 0, NOW)],
      NOW,
    );
    state.stages.characters = mergeAspectsIntoStage(
      { status: "not_started", playbookGenerated: false, aspects: [] },
      [buildImportedEntityAspect(PEOPLE, 0, NOW)!],
      NOW,
    );
    expect(() => assertStudioStateInvariants(state)).not.toThrow();
  });
});

describe("summarizeIntake", () => {
  it("counts what landed where and keeps the order of INTAKE_TARGETS", () => {
    const s = summarizeIntake([
      { target: "world", title: "Карта", kind: "aspect" },
      { target: "world", title: "Кухня", kind: "aspect" },
      { target: "chapters", title: "Глава 01", kind: "chapter" },
      { target: "concept", title: "Задумка", kind: "idea" },
    ]);
    expect(s.map((row) => [row.target, row.count])).toEqual([
      ["concept", 1], ["world", 2], ["chapters", 1],
    ]);
    expect(s[1]!.titles).toEqual(["Карта", "Кухня"]);
    expect(s[0]!.label).toBe(INTAKE_TARGET_LABELS.concept);
  });

  it("returns an empty list when nothing landed", () => {
    expect(summarizeIntake([])).toEqual([]);
  });
});

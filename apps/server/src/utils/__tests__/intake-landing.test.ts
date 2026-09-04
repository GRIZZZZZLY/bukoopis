import { describe, it, expect } from "vitest";
import {
  intakeRequestKey,
  landFragments,
  describeExistingStages,
} from "../intake-landing.js";
import {
  emptyStudioState,
  assertStudioStateInvariants,
  type IntakeFragment,
  type StudioState,
} from "@book-forge/shared";

const NOW = "2026-09-05T10:00:00.000Z";

function frag(over: Partial<IntakeFragment> = {}): IntakeFragment {
  return { target: "world", title: "Карта", body: "Барьер делит два мира.", ...over };
}

describe("intakeRequestKey", () => {
  it("is stable regardless of file order", () => {
    const a = [{ filename: "b.md", content: "два" }, { filename: "a.md", content: "один" }];
    const b = [{ filename: "a.md", content: "один" }, { filename: "b.md", content: "два" }];
    expect(intakeRequestKey(a)).toBe(intakeRequestKey(b));
  });

  it("changes when a file's content changes", () => {
    const a = [{ filename: "a.md", content: "один" }];
    const b = [{ filename: "a.md", content: "один и ещё" }];
    expect(intakeRequestKey(a)).not.toBe(intakeRequestKey(b));
  });
});

describe("landFragments", () => {
  it("lands a markdown fragment as a reviewing draft on its stage", () => {
    const { next, landed, chapterFragments } = landFragments(emptyStudioState(), [frag()], NOW);
    const stage = next.stages.world!;
    expect(stage.aspects).toHaveLength(1);
    expect(stage.aspects[0]!.status).toBe("reviewing");
    expect(stage.aspects[0]!.finalPayload).toBeUndefined();
    expect(stage.status).toBe("in_progress");
    expect(landed).toEqual([{ target: "world", title: "Карта", kind: "aspect" }]);
    expect(chapterFragments).toEqual([]);
    expect(() => assertStudioStateInvariants(next)).not.toThrow();
  });

  it("groups several fragments for one stage and numbers them in order", () => {
    const { next } = landFragments(
      emptyStudioState(),
      [frag({ title: "Карта" }), frag({ title: "Кухня" }), frag({ target: "lore", title: "Барьер" })],
      NOW,
    );
    expect(next.stages.world!.aspects.map((a) => [a.name, a.order])).toEqual([
      ["Карта", 0], ["Кухня", 1],
    ]);
    expect(next.stages.lore!.aspects).toHaveLength(1);
  });

  it("appends after aspects a stage already has", () => {
    const state: StudioState = emptyStudioState();
    state.stages.world = {
      status: "in_progress",
      playbookGenerated: true,
      aspects: [{
        id: "old", name: "Старое", status: "accepted", order: 0, required: true,
        source: "llm", payloadKind: "markdown", variants: [], finalPayload: "текст",
      }],
    };
    const { next } = landFragments(state, [frag()], NOW);
    expect(next.stages.world!.aspects.map((a) => a.order)).toEqual([0, 1]);
    expect(next.stages.world!.aspects[0]!.id).toBe("old");
  });

  it("lands people as entity candidates, not markdown", () => {
    const { next, landed } = landFragments(
      emptyStudioState(),
      [frag({
        target: "characters", title: "Связи",
        entities: [{ name: "Нейла", summary: "Проводница." }],
      })],
      NOW,
    );
    const aspect = next.stages.characters!.aspects[0]!;
    expect(aspect.payloadKind).toBe("entity_set");
    const payload = aspect.variants[0]!.payload as { candidates: unknown[] };
    expect(payload.candidates).toHaveLength(1);
    expect(landed[0]!.kind).toBe("aspect");
    expect(() => assertStudioStateInvariants(next)).not.toThrow();
  });

  it("falls back to a markdown draft when an entity fragment carries no entities", () => {
    const { next } = landFragments(
      emptyStudioState(),
      [frag({ target: "characters", title: "Связи", entities: [] })],
      NOW,
    );
    expect(next.stages.characters!.aspects[0]!.payloadKind).toBe("markdown");
  });

  it("hands chapter fragments back untouched instead of making aspects of them", () => {
    const { next, landed, chapterFragments } = landFragments(
      emptyStudioState(),
      [frag({ target: "chapters", title: "Глава 01", body: "Караван вышел на рассвете." })],
      NOW,
    );
    expect(next.stages.chapters).toBeUndefined();
    expect(landed).toEqual([]);
    expect(chapterFragments).toHaveLength(1);
  });

  it("ignores concept and skip fragments — the route owns the idea, and skip lands nowhere", () => {
    const { next, landed } = landFragments(
      emptyStudioState(),
      [frag({ target: "concept", title: "Замысел" }), frag({ target: "skip", title: "Черновик" })],
      NOW,
    );
    expect(Object.keys(next.stages)).toEqual([]);
    expect(landed).toEqual([]);
  });

  it("leaves the incoming state untouched", () => {
    const state = emptyStudioState();
    const before = JSON.stringify(state);
    landFragments(state, [frag()], NOW);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("describeExistingStages", () => {
  it("names each stage that holds aspects, with their titles", () => {
    const state = emptyStudioState();
    state.stages.world = {
      status: "in_progress", playbookGenerated: true,
      aspects: [
        { id: "a", name: "География", status: "accepted", order: 0, required: true,
          source: "llm", payloadKind: "markdown", variants: [], finalPayload: "x" },
        { id: "b", name: "Климат", status: "pending", order: 1, required: false,
          source: "llm", payloadKind: "markdown", variants: [] },
      ],
    };
    expect(describeExistingStages(state)).toEqual(["Мир: География, Климат"]);
  });

  it("returns an empty list for a fresh book", () => {
    expect(describeExistingStages(emptyStudioState())).toEqual([]);
  });
});

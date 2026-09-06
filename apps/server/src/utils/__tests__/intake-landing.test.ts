import { describe, it, expect } from "vitest";
import {
  intakeFileKey,
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

  it("does not collide when the field boundary shifts between filename and content", () => {
    const a = [{ filename: "notes.md", content: "hello world" }];
    const b = [{ filename: "notes.md hello", content: "world" }];
    expect(intakeRequestKey(a)).not.toBe(intakeRequestKey(b));
  });
});

describe("intakeFileKey", () => {
  it("is the same for the same file and different for the same name with other text", () => {
    const a = { filename: "Связи.md", content: "один" };
    expect(intakeFileKey(a)).toBe(intakeFileKey({ ...a }));
    // Одинаковые имена в разных подпапках — обычное дело для брошенной папки:
    // по имени их различать нельзя, поэтому ключ считается и по содержимому.
    expect(intakeFileKey(a)).not.toBe(intakeFileKey({ ...a, content: "другой текст" }));
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

  it("sends an entity-less fragment to lore instead of a stage that cannot render it", () => {
    // A relationships file that names nobody cleanly is plausible classifier
    // output. A markdown payload on `characters` used to be the fallback, and
    // EntityStageRunner hands every variant payload to a renderer that reads
    // `.candidates` — a string there took the whole app to its error screen.
    // Prose about people belongs in lore, which renders markdown natively.
    const { next, landed } = landFragments(
      emptyStudioState(),
      [frag({ target: "characters", title: "Связи", entities: [] })],
      NOW,
    );
    expect(next.stages.characters).toBeUndefined();
    const aspect = next.stages.lore!.aspects[0]!;
    expect(aspect.payloadKind).toBe("markdown");
    expect(aspect.name).toBe("Связи");
    // The summary must name where the material actually went, not where the
    // classifier aimed it.
    expect(landed).toEqual([{ target: "lore", title: "Связи", kind: "aspect" }]);
    expect(() => assertStudioStateInvariants(next)).not.toThrow();
  });

  it("keeps the redirected fragment in order behind lore fragments of its own", () => {
    const { next } = landFragments(
      emptyStudioState(),
      [
        frag({ target: "lore", title: "Барьер" }),
        frag({ target: "items", title: "Реликвии", entities: [] }),
      ],
      NOW,
    );
    expect(next.stages.lore!.aspects.map((a) => [a.name, a.order])).toEqual([
      ["Барьер", 0],
      ["Реликвии", 1],
    ]);
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

describe("landFragments и цель plot", () => {
  it("разобранное оглавление становится вариантом плана, а не аспектом", () => {
    const fragment: IntakeFragment = {
      target: "plot",
      title: "Оглавление",
      body: "Глава 1. Порог",
      chapters: [{ title: "Порог", pov: "Рин" }],
    };
    const result = landFragments(emptyStudioState(), [fragment], NOW);

    expect(result.planVariants).toHaveLength(1);
    expect(result.planVariants[0]?.chapters?.[0]?.title).toBe("Порог");
    expect(result.next.stages["plot"]?.aspects ?? []).toHaveLength(0);
    expect(result.landed[0]).toMatchObject({ target: "plot", kind: "plan" });
  });

  it("проза о сюжете без списка глав по-прежнему ложится заметкой", () => {
    const fragment: IntakeFragment = {
      target: "plot",
      title: "Мысли о структуре",
      body: "Хочу три части.",
    };
    const result = landFragments(emptyStudioState(), [fragment], NOW);

    expect(result.planVariants).toHaveLength(0);
    expect(result.next.stages["plot"]?.aspects).toHaveLength(1);
    expect(result.landed[0]).toMatchObject({ target: "plot", kind: "aspect" });
  });

  it("два оглавления в одной папке дают два варианта", () => {
    const mk = (title: string): IntakeFragment => ({
      target: "plot",
      title,
      body: "b",
      chapters: [{ title: "Глава" }],
    });
    const result = landFragments(emptyStudioState(), [mk("Первое"), mk("Второе")], NOW);
    expect(result.planVariants).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import {
  computeStudioProgress,
  computeStudioWarnings,
  computeRecommendedNextStage,
  effectiveStageStatus,
} from "./studio-warnings.js";
import { isPlanApproved } from "./plot.js";
import { emptyBookConcept, PITCH_FIELD_LABELS } from "./concept.js";
import { emptyStudioState } from "./studio-state.js";

const emptyCanon = { characterCount: 0, locationCount: 0, itemCount: 0 };

describe("computeStudioWarnings", () => {
  it("warns about an empty canon once real chapters exist, not just a stage flag", () => {
    const out = computeStudioWarnings({
      concept: emptyBookConcept(),
      studioState: emptyStudioState(),
      canon: emptyCanon,
      chapters: { total: 2, finalized: 0 },
    });
    expect(out.map((w) => w.id)).toContain("chapters_without_characters");
  });

  it("stays quiet about the canon while no chapter has been created", () => {
    const out = computeStudioWarnings({
      concept: emptyBookConcept(),
      studioState: emptyStudioState(),
      canon: emptyCanon,
      chapters: { total: 0, finalized: 0 },
    });
    expect(out.map((w) => w.id)).not.toContain("chapters_without_characters");
  });

  it("warns when concept.genres is empty and any non-concept stage in_progress", () => {
    const concept = emptyBookConcept();
    const state = emptyStudioState();
    state.stages.world = { status: "in_progress", playbookGenerated: false, aspects: [] };
    const w = computeStudioWarnings({ concept, studioState: state, canon: emptyCanon });
    expect(w.find((x) => x.id === "concept_genres_empty_for_world")).toBeDefined();
  });

  it("danger when chapters started with zero characters", () => {
    const state = emptyStudioState();
    state.stages.chapters = { status: "in_progress", playbookGenerated: false, aspects: [] };
    const w = computeStudioWarnings({
      concept: emptyBookConcept(),
      studioState: state,
      canon: emptyCanon,
    });
    expect(w.find((x) => x.severity === "danger")).toBeDefined();
  });

  it("info when world complete but lore not started", () => {
    const state = emptyStudioState();
    state.stages.world = { status: "complete", playbookGenerated: true, aspects: [] };
    const w = computeStudioWarnings({
      concept: emptyBookConcept(),
      studioState: state,
      canon: emptyCanon,
    });
    expect(w.find((x) => x.id === "lore_not_started_after_world")).toBeDefined();
  });

  it("warns when plot started but logline empty", () => {
    const state = emptyStudioState();
    state.stages.plot = { status: "in_progress", playbookGenerated: false, aspects: [] };
    const w = computeStudioWarnings({
      concept: emptyBookConcept(),
      studioState: state,
      canon: emptyCanon,
    });
    const warning = w.find((x) => x.id === "plot_without_logline");
    expect(warning).toBeDefined();
    // Внутренних имён полей автор в интерфейсе не видит — строку называют её
    // подписью из PITCH_FIELD_LABELS.
    expect(warning!.message).not.toMatch(/логлайн/i);
    expect(warning!.message).toContain(PITCH_FIELD_LABELS.logline);
  });

  it("no warnings on a healthy minimal state", () => {
    const concept = emptyBookConcept();
    concept.genre = "фэнтези";
    concept.premise.logline = "Герой ищет правду";
    const w = computeStudioWarnings({
      concept,
      studioState: emptyStudioState(),
      canon: emptyCanon,
    });
    expect(w).toEqual([]);
  });
});

import type { StudioState } from "./studio-state.js";

describe("computeStudioProgress", () => {
  function stateWith(
    statuses: Partial<Record<string, "complete" | "skipped" | "in_progress">>,
  ): StudioState {
    const s = emptyStudioState();
    for (const [id, status] of Object.entries(statuses)) {
      s.stages[id] = { status: status!, playbookGenerated: false, aspects: [] };
    }
    return s;
  }

  it("empty studio: nothing done, recommended is concept", () => {
    const p = computeStudioProgress(emptyBookConcept(), emptyStudioState());
    expect(p.total).toBe(7);
    expect(p.doneCount).toBe(0);
    expect(p.recommended).toBe("concept");
    expect(p.stages).toHaveLength(7);
    expect(p.stages[0]).toEqual({ id: "concept", status: "current", done: false });
  });

  it("counts complete and skipped as done", () => {
    const p = computeStudioProgress(
      emptyBookConcept(),
      stateWith({ concept: "complete", world: "skipped", lore: "complete" }),
    );
    expect(p.doneCount).toBe(3);
    const byId = Object.fromEntries(p.stages.map((s) => [s.id, s]));
    expect(byId.concept!.done).toBe(true);
    expect(byId.world!.done).toBe(true);
    expect(byId.lore!.done).toBe(true);
    expect(byId.characters!.done).toBe(false);
  });

  it("marks the recommended stage as current", () => {
    const p = computeStudioProgress(
      emptyBookConcept(),
      stateWith({ concept: "complete" }),
    );
    expect(p.recommended).toBe("world");
    const world = p.stages.find((s) => s.id === "world")!;
    expect(world.status).toBe("current");
  });

  it("all done: doneCount 7, recommended undefined, no current", () => {
    const all = stateWith({
      concept: "complete", world: "complete", lore: "complete",
      characters: "complete", items: "complete", plot: "complete", chapters: "complete",
    });
    const p = computeStudioProgress(emptyBookConcept(), all);
    expect(p.doneCount).toBe(7);
    expect(p.recommended).toBeUndefined();
    expect(p.stages.every((s) => s.status === "done")).toBe(true);
  });
});

describe("computeRecommendedNextStage", () => {
  it("recommends concept on empty state", () => {
    expect(
      computeRecommendedNextStage({
        concept: emptyBookConcept(),
        studioState: emptyStudioState(),
      }),
    ).toBe("concept");
  });

  it("stays on chapters while the book is unwritten or unfinished", () => {
    const concept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Л" },
    };
    const state = emptyStudioState();
    for (const s of ["world", "lore", "characters", "items", "plot"] as const) {
      state.stages[s] = { status: "complete", playbookGenerated: false, aspects: [] };
    }
    expect(
      computeRecommendedNextStage({ concept, studioState: state }),
    ).toBe("chapters");
    expect(
      computeRecommendedNextStage({
        concept,
        studioState: state,
        chapters: { total: 12, finalized: 11 },
      }),
    ).toBe("chapters");
  });

  it("has nothing left to recommend once every chapter is final", () => {
    const concept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Л" },
    };
    const state = emptyStudioState();
    for (const s of ["world", "lore", "characters", "items", "plot"] as const) {
      state.stages[s] = { status: "complete", playbookGenerated: false, aspects: [] };
    }
    expect(
      computeRecommendedNextStage({
        concept,
        studioState: state,
        chapters: { total: 12, finalized: 12 },
      }),
    ).toBeUndefined();
  });

  it("an empty book is not a finished book", () => {
    const concept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Л" },
    };
    const state = emptyStudioState();
    for (const s of ["world", "lore", "characters", "items", "plot"] as const) {
      state.stages[s] = { status: "complete", playbookGenerated: false, aspects: [] };
    }
    expect(
      computeRecommendedNextStage({
        concept,
        studioState: state,
        chapters: { total: 0, finalized: 0 },
      }),
    ).toBe("chapters");
  });

  it("moves past concept once it is locked, not on the logline alone", () => {
    const concept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Картограф ищет остров." },
    };
    expect(
      computeRecommendedNextStage({ concept, studioState: emptyStudioState() }),
    ).toBe("world");
  });

  it("skips skipped stages", () => {
    const state = emptyStudioState();
    state.stages.concept = { status: "complete", playbookGenerated: false, aspects: [] };
    state.stages.world = { status: "skipped", playbookGenerated: false, aspects: [] };
    expect(
      computeRecommendedNextStage({ concept: emptyBookConcept(), studioState: state }),
    ).toBe("lore");
  });

  it("returns undefined when all 7 stages complete", () => {
    const state = emptyStudioState();
    for (const s of ["concept", "world", "lore", "characters", "items", "plot", "chapters"] as const) {
      state.stages[s] = { status: "complete", playbookGenerated: false, aspects: [] };
    }
    expect(
      computeRecommendedNextStage({ concept: emptyBookConcept(), studioState: state }),
    ).toBeUndefined();
  });
});

describe("effectiveStageStatus", () => {
  const withLogline = { ...emptyBookConcept(), premise: { logline: "Л" } };

  it("shows concept as complete only once locked, not on the logline alone", () => {
    expect(
      effectiveStageStatus(withLogline, emptyStudioState(), "concept"),
    ).toBe("in_progress");
    const locked = {
      ...withLogline,
      lockedAt: "2026-09-04T10:00:00.000Z",
    };
    expect(
      effectiveStageStatus(locked, emptyStudioState(), "concept"),
    ).toBe("complete");
  });

  it("shows a half-filled concept as in progress", () => {
    const partial = {
      ...emptyBookConcept(),
      premise: { protagonist: "Нейла, проводница каравана." },
    };
    expect(effectiveStageStatus(partial, emptyStudioState(), "concept")).toBe(
      "in_progress",
    );
  });

  it("leaves an untouched concept alone", () => {
    expect(
      effectiveStageStatus(emptyBookConcept(), emptyStudioState(), "concept"),
    ).toBe("not_started");
  });

  it("reads chapters off the chapter list, not studio_state", () => {
    const state = emptyStudioState();
    expect(
      effectiveStageStatus(withLogline, state, "chapters", {
        total: 0,
        finalized: 0,
      }),
    ).toBe("not_started");
    expect(
      effectiveStageStatus(withLogline, state, "chapters", {
        total: 3,
        finalized: 1,
      }),
    ).toBe("in_progress");
    expect(
      effectiveStageStatus(withLogline, state, "chapters", {
        total: 3,
        finalized: 3,
      }),
    ).toBe("complete");
  });

  it("respects an explicit skip over anything derived", () => {
    const state = emptyStudioState();
    state.stages.chapters = {
      status: "skipped",
      playbookGenerated: false,
      aspects: [],
    };
    expect(
      effectiveStageStatus(withLogline, state, "chapters", {
        total: 3,
        finalized: 3,
      }),
    ).toBe("skipped");
  });

  it("concept stage is in_progress once pitches exist and complete only when locked", () => {
    const withPitches = { ...emptyBookConcept(), idea: "Девочка находит карту города, которого нет." };
    expect(effectiveStageStatus(withPitches, emptyStudioState(), "concept")).toBe("in_progress");
    const locked = { ...withPitches, lockedAt: "2026-09-04T10:00:00.000Z" };
    expect(effectiveStageStatus(locked, emptyStudioState(), "concept")).toBe("complete");
    expect(
      computeRecommendedNextStage({ concept: locked, studioState: emptyStudioState() }),
    ).toBe("world");
  });
});

describe("готовность этапа плана", () => {
  /** Утверждённый замысел: без него рекомендация не сдвинется с первого этапа. */
  function conceptFixture() {
    return { ...emptyBookConcept(), lockedAt: "2026-09-06T10:00:00.000Z" };
  }
  const concept = conceptFixture();
  const emptyState = { schemaVersion: 1 as const, revision: 0, stages: {} };

  it("план не утверждён — этап не пройден", () => {
    const progress = computeStudioProgress(concept, emptyState, undefined, {
      approved: false,
    });
    expect(progress.stages.find((s) => s.id === "plot")?.done).toBe(false);
  });

  it("план утверждён — этап пройден, даже если аспектов на нём нет", () => {
    const progress = computeStudioProgress(concept, emptyState, undefined, {
      approved: true,
    });
    expect(progress.stages.find((s) => s.id === "plot")?.done).toBe(true);
  });

  it("без признака плана поведение прежнее: этап не пройден", () => {
    const progress = computeStudioProgress(concept, emptyState);
    expect(progress.stages.find((s) => s.id === "plot")?.done).toBe(false);
  });

  it("утверждённый план сдвигает рекомендацию на главы", () => {
    const done = {
      schemaVersion: 1 as const,
      revision: 0,
      stages: {
        world: { status: "skipped" as const, playbookGenerated: false, aspects: [] },
        lore: { status: "skipped" as const, playbookGenerated: false, aspects: [] },
        characters: { status: "complete" as const, playbookGenerated: true, aspects: [] },
        items: { status: "skipped" as const, playbookGenerated: false, aspects: [] },
      },
    };
    expect(
      computeRecommendedNextStage({ concept, studioState: done, plan: { approved: true } }),
    ).toBe("chapters");
  });
});

describe("isPlanApproved", () => {
  const withChapters = JSON.stringify({
    variants: [{ label: "план", estimatedChapters: 1, chapters: [{ title: "Порог" }] }],
    selectedIndex: 0,
    generatedAt: "2026-09-06T10:00:00.000Z",
  });

  it("выбранный вариант с поглавными строками — утверждён", () => {
    expect(isPlanApproved(withChapters)).toBe(true);
  });

  it("вариант выбран, но поглавных строк нет — не утверждён", () => {
    expect(
      isPlanApproved(
        JSON.stringify({
          variants: [{ label: "план", estimatedChapters: 12 }],
          selectedIndex: 0,
          generatedAt: "2026-09-06T10:00:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("вариант не выбран — не утверждён", () => {
    expect(
      isPlanApproved(
        JSON.stringify({
          variants: [{ label: "план", estimatedChapters: 1, chapters: [{ title: "Порог" }] }],
          selectedIndex: null,
          generatedAt: "2026-09-06T10:00:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("мусор и пустота не роняют проверку", () => {
    expect(isPlanApproved(null)).toBe(false);
    expect(isPlanApproved("не json")).toBe(false);
    expect(isPlanApproved("{}")).toBe(false);
  });
});

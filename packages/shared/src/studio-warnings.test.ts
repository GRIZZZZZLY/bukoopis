import { describe, it, expect } from "vitest";
import {
  computeStudioWarnings,
  computeRecommendedNextStage,
} from "./studio-warnings.js";
import { emptyBookConcept } from "./concept.js";
import { emptyStudioState } from "./studio-state.js";

const emptyCanon = { characterCount: 0, locationCount: 0, itemCount: 0 };

describe("computeStudioWarnings", () => {
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

  it("warns on incompatible genres pair from registry", () => {
    const concept = emptyBookConcept();
    concept.genres = ["sci_fi.hard_sci_fi", "fantasy"];
    const w = computeStudioWarnings({
      concept,
      studioState: emptyStudioState(),
      canon: emptyCanon,
    });
    expect(w.find((x) => x.id.startsWith("incompatible_genres"))).toBeDefined();
    // Dedup: symmetric pair must not produce duplicate warnings.
    const incompatPair = w.filter((x) => x.id.startsWith("incompatible_genres"));
    expect(incompatPair).toHaveLength(1);
  });

  it("warns when plot started but logline empty", () => {
    const state = emptyStudioState();
    state.stages.plot = { status: "in_progress", playbookGenerated: false, aspects: [] };
    const w = computeStudioWarnings({
      concept: emptyBookConcept(),
      studioState: state,
      canon: emptyCanon,
    });
    expect(w.find((x) => x.id === "plot_without_logline")).toBeDefined();
  });

  it("no warnings on a healthy minimal state", () => {
    const concept = emptyBookConcept();
    concept.genres = ["fantasy"];
    concept.premise.logline = "Герой ищет правду";
    const w = computeStudioWarnings({
      concept,
      studioState: emptyStudioState(),
      canon: emptyCanon,
    });
    expect(w).toEqual([]);
  });
});

import { computeStudioProgress } from "./studio-warnings.js";
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

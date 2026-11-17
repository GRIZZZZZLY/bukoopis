import { describe, expect, it } from "vitest";
import { chapterPlanForGeneration } from "../chapter-plan.js";

const beat = (index: number) => ({
  index,
  type: "setup" as const,
  summary: "s",
  goal: "g",
  conflict: "c",
  outcome: "o",
});
const variant = {
  label: "A",
  pov: "Лис",
  emotionalGoal: "тревога",
  estimatedWords: 1000,
  beats: [beat(0), beat(1), beat(2)],
};
const plan = (selectedIndex: number | null) =>
  JSON.stringify({ variants: [variant], selectedIndex, generatedAt: "x" });

describe("chapterPlanForGeneration", () => {
  it("возвращает выбранный вариант при beats", () => {
    const r = chapterPlanForGeneration({
      active_plan_kind: "beats",
      plan_json: plan(0),
      intent: "Лис идёт",
    });
    expect(r).toEqual({ kind: "beats", variant });
  });

  it("beats без выбора или с битым JSON откатывается к intent, иначе none", () => {
    expect(
      chapterPlanForGeneration({
        active_plan_kind: "beats",
        plan_json: plan(null),
        intent: " Лис идёт ",
      }),
    ).toEqual({ kind: "intent", intent: "Лис идёт" });
    expect(
      chapterPlanForGeneration({
        active_plan_kind: "beats",
        plan_json: "{broken",
        intent: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("null и theses дают intent", () => {
    for (const k of [null, "theses"] as const) {
      expect(
        chapterPlanForGeneration({
          active_plan_kind: k,
          plan_json: plan(0),
          intent: "  Лис идёт  ",
        }),
      ).toEqual({ kind: "intent", intent: "Лис идёт" });
    }
  });

  it("всё пусто — none", () => {
    expect(
      chapterPlanForGeneration({
        active_plan_kind: null,
        plan_json: null,
        intent: "   ",
      }),
    ).toEqual({ kind: "none" });
  });
});

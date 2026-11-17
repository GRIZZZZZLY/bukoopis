import { describe, it, expect } from "vitest";
import { scenePlanWriteSchema, parseStoredScenePlan } from "./scene-plan.js";

const ev = (n: number) => Array.from({ length: n }, (_, i) => `событие ${i}`);
const plan = (scenes: { events: string[] }[]) => ({ scenes });

describe("scenePlanWriteSchema", () => {
  it("принимает нормальный план", () => {
    expect(scenePlanWriteSchema.safeParse(plan([{ events: ev(3) }])).success).toBe(true);
  });
  it("отвергает 0 и 13 сцен", () => {
    expect(scenePlanWriteSchema.safeParse(plan([])).success).toBe(false);
    expect(
      scenePlanWriteSchema.safeParse(plan(Array.from({ length: 13 }, () => ({ events: ev(3) })))).success,
    ).toBe(false);
  });
  it("отвергает сцену из 2 событий", () => {
    expect(scenePlanWriteSchema.safeParse(plan([{ events: ev(2) }])).success).toBe(false);
  });
  it("отвергает событие в 301 знак и пустое", () => {
    expect(scenePlanWriteSchema.safeParse(plan([{ events: ["а".repeat(301), "б", "в"] }])).success).toBe(false);
    expect(scenePlanWriteSchema.safeParse(plan([{ events: ["а", "   ", "в"] }])).success).toBe(false);
  });
});

describe("parseStoredScenePlan", () => {
  it("мусор и null читаются как null", () => {
    expect(parseStoredScenePlan("garbage")).toBeNull();
    expect(parseStoredScenePlan(null)).toBeNull();
    expect(parseStoredScenePlan('{"scenes":[]}')).toBeNull();
  });
  it("читает сохранённый план", () => {
    const raw = JSON.stringify({ scenes: [{ events: ev(3) }], basedOn: 7 });
    expect(parseStoredScenePlan(raw)?.basedOn).toBe(7);
  });
});

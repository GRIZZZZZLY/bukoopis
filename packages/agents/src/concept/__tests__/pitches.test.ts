import { describe, it, expect } from "vitest";
import {
  buildPitchGeneratorPrompt,
  toPitches,
  pitchDraftSchema,
  type PitchDraft,
} from "../pitches.js";

const DRAFT: PitchDraft = {
  workingTitle: "  Маршрут, который врёт ",
  logline: "Когда карта рода расходится с морем, Нейла должна выбрать между кодексом и глазами.",
  protagonist: "Нейла, проводница каравана.",
  conflict: "Маршрут ведёт в аномалию.",
  stakes: "Караван и репутация семьи.",
  hook: "В архивах маршрута — невозможная правка.",
  genre: "фантастика выживания",
  tone: "холодный",
  audience: "adult",
  strength: "Понятный конфликт долга и наблюдения.",
  risk: "Много мира до первого выбора.",
};

describe("buildPitchGeneratorPrompt", () => {
  it("carries the idea, the count and the direction", () => {
    const p = buildPitchGeneratorPrompt({
      idea: "Шестеро героев из двух враждующих миров.",
      direction: "мрачнее",
      count: 4,
    });
    expect(p).toContain("Шестеро героев из двух враждующих миров.");
    expect(p).toContain("ровно 4");
    expect(p).toContain("мрачнее");
  });

  it("defaults to four pitches and lists pitches to avoid", () => {
    const p = buildPitchGeneratorPrompt({
      idea: "Шестеро героев из двух враждующих миров.",
      avoid: [{ workingTitle: "Соляной архив", logline: "Инженер читает регистр." }],
    });
    expect(p).toContain("ровно 4");
    expect(p).toContain("«Соляной архив»");
    expect(p).toContain("Инженер читает регистр.");
  });

  it("omits the avoid block when there is nothing to avoid", () => {
    const p = buildPitchGeneratorPrompt({ idea: "Шестеро героев из двух враждующих миров." });
    expect(p).not.toContain("УЖЕ ПОКАЗАННЫЕ");
  });
});

describe("toPitches", () => {
  it("assigns ids in order and trims every string field", () => {
    let n = 0;
    const out = toPitches([DRAFT, { ...DRAFT, workingTitle: "Второй" }], () => `id-${++n}`);
    expect(out.map((p) => p.id)).toEqual(["id-1", "id-2"]);
    expect(out[0]?.workingTitle).toBe("Маршрут, который врёт");
    expect(out[1]?.workingTitle).toBe("Второй");
    expect(out[0]?.audience).toBe("adult");
  });
});

describe("pitchDraftSchema", () => {
  it("has no id and rejects blanks", () => {
    expect(pitchDraftSchema.safeParse(DRAFT).success).toBe(true);
    expect(pitchDraftSchema.safeParse({ ...DRAFT, id: "x" }).success).toBe(true);
    expect(pitchDraftSchema.safeParse({ ...DRAFT, risk: "" }).success).toBe(false);
  });
});

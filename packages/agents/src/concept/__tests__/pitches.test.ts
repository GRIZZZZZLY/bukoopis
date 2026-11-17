import { describe, it, expect } from "vitest";
import { renderClicheRule, AUDIENCE_LABELS } from "@book-forge/shared";
import {
  PITCH_GENERATOR_SYSTEM,
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

describe("PITCH_GENERATOR_SYSTEM", () => {
  it("carries the shared cliche rule", () => {
    expect(PITCH_GENERATOR_SYSTEM).toContain(renderClicheRule());
  });

  it("does not force the «Когда» logline template", () => {
    expect(PITCH_GENERATOR_SYSTEM).not.toContain("Схема: «Когда");
    expect(PITCH_GENERATOR_SYSTEM).toContain("начинаться по-разному");
  });

  it("defaults audience to adult and says a young hero is not a reason for ya", () => {
    expect(PITCH_GENERATOR_SYSTEM).toContain("По умолчанию adult");
    expect(PITCH_GENERATOR_SYSTEM).toContain("Юный герой сам по себе не повод для ya");
  });

  it("forbids invented facts", () => {
    expect(PITCH_GENERATOR_SYSTEM).toContain("не добавляй биографических фактов");
  });

  it("uses the plain label for ya", () => {
    expect(AUDIENCE_LABELS.ya).toBe("подростки и молодёжь");
  });
});

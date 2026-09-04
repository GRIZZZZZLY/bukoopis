import { describe, it, expect } from "vitest";
import {
  bookConceptSchema,
  emptyBookConcept,
  audienceSchema,
  isConceptComplete,
  normalizeConcept,
  lockConceptToPitch,
  unlockConcept,
  pitchSchema,
  PITCH_MIX_FIELDS,
  PITCH_FIELD_LABELS,
  type Pitch,
} from "./concept.js";

const PITCH: Pitch = {
  id: "p1",
  workingTitle: "Маршрут, который врёт",
  logline: "Когда карта рода расходится с морем, Нейла должна выбрать между кодексом и глазами.",
  protagonist: "Нейла, проводница каравана, верит карте больше, чем себе.",
  conflict: "Ритуальный маршрут ведёт в аномалию, а признать это — предать род.",
  stakes: "Караван и репутация семьи.",
  hook: "В архивах маршрута находится невозможная правка.",
  genre: "фантастика выживания",
  tone: "холодный, с редкими прорывами тепла",
  audience: "adult",
  strength: "Конфликт долга и наблюдения понятен с первой сцены.",
  risk: "Много мира до первого выбора героини.",
};

describe("bookConceptSchema", () => {
  it("emptyBookConcept passes schema and has no pitches", () => {
    const c = emptyBookConcept();
    expect(bookConceptSchema.parse(c)).toEqual(c);
    expect(c.pitches).toEqual([]);
    expect(c.audience).toBe("adult");
    expect(c.lockedAt).toBeUndefined();
  });

  it("parses a legacy concept without the pitches field", () => {
    const c = bookConceptSchema.parse({
      schemaVersion: 1,
      genres: ["fantasy"],
      tones: ["dark"],
      audience: "adult",
      premise: { logline: "Герой ищет правду" },
    });
    expect(c.pitches).toEqual([]);
  });

  it("audienceSchema rejects unknown value", () => {
    expect(audienceSchema.safeParse("everyone").success).toBe(false);
  });

  it("pitchSchema requires every field non-empty", () => {
    expect(pitchSchema.safeParse({ ...PITCH, hook: "" }).success).toBe(false);
    expect(pitchSchema.safeParse(PITCH).success).toBe(true);
  });

  it("every mixable field has a human label", () => {
    for (const f of PITCH_MIX_FIELDS) {
      expect(PITCH_FIELD_LABELS[f].length).toBeGreaterThan(0);
    }
    expect(PITCH_FIELD_LABELS.logline).toBe("О чём книга, одной фразой");
  });
});

describe("normalizeConcept", () => {
  it("folds legacy genre/tone arrays into free-text genre/tone", () => {
    const c = normalizeConcept({
      ...emptyBookConcept(),
      genres: ["fantasy", "fantasy"],
      customGenres: ["магический реализм"],
      tones: ["dark"],
    });
    expect(c.genre).toBe("fantasy, магический реализм");
    expect(c.tone).toBe("dark");
  });

  it("keeps an explicit genre/tone over legacy arrays", () => {
    const c = normalizeConcept({
      ...emptyBookConcept(),
      genres: ["fantasy"],
      genre: "камерная антиутопия",
    });
    expect(c.genre).toBe("камерная антиутопия");
  });

  it("leaves genre undefined when nothing is known", () => {
    expect(normalizeConcept(emptyBookConcept()).genre).toBeUndefined();
  });
});

describe("isConceptComplete", () => {
  it("an empty concept is not complete", () => {
    expect(isConceptComplete(emptyBookConcept())).toBe(false);
  });

  it("a logline alone no longer completes the stage", () => {
    const c = emptyBookConcept();
    c.premise = { logline: "Герой ищет правду" };
    expect(isConceptComplete(c)).toBe(false);
  });

  it("lockedAt completes the stage", () => {
    const c = { ...emptyBookConcept(), lockedAt: "2026-09-04T10:00:00.000Z" };
    expect(isConceptComplete(c)).toBe(true);
  });
});

describe("lockConceptToPitch / unlockConcept", () => {
  it("copies the pitch into the concept and marks it locked", () => {
    const c = { ...emptyBookConcept(), pitches: [PITCH] };
    const locked = lockConceptToPitch(c, "p1", "2026-09-04T10:00:00.000Z");
    expect(locked.lockedAt).toBe("2026-09-04T10:00:00.000Z");
    expect(locked.selectedPitchId).toBe("p1");
    expect(locked.genre).toBe(PITCH.genre);
    expect(locked.tone).toBe(PITCH.tone);
    expect(locked.hook).toBe(PITCH.hook);
    expect(locked.audience).toBe("adult");
    expect(locked.premise).toEqual({
      protagonist: PITCH.protagonist,
      conflict: PITCH.conflict,
      stakes: PITCH.stakes,
      logline: PITCH.logline,
    });
    expect(locked.pitches).toEqual([PITCH]);
  });

  it("throws on an unknown pitch id", () => {
    const c = { ...emptyBookConcept(), pitches: [PITCH] };
    expect(() => lockConceptToPitch(c, "nope", "2026-09-04T10:00:00.000Z")).toThrow(/nope/);
  });

  it("unlock drops lockedAt but keeps everything else", () => {
    const locked = lockConceptToPitch(
      { ...emptyBookConcept(), pitches: [PITCH] },
      "p1",
      "2026-09-04T10:00:00.000Z",
    );
    const open = unlockConcept(locked);
    expect(open.lockedAt).toBeUndefined();
    expect(open.selectedPitchId).toBe("p1");
    expect(open.premise.logline).toBe(PITCH.logline);
    expect(isConceptComplete(open)).toBe(false);
  });
});

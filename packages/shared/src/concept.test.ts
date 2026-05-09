import { describe, it, expect } from "vitest";
import {
  bookConceptSchema,
  emptyBookConcept,
  audienceSchema,
} from "./concept.js";
import { GENRES, TONES, getGenreById, getToneById } from "./genre-registry.js";

describe("concept", () => {
  it("emptyBookConcept passes schema", () => {
    const c = emptyBookConcept();
    expect(bookConceptSchema.parse(c)).toEqual(c);
    expect(c.genres).toEqual([]);
    expect(c.tones).toEqual([]);
    expect(c.audience).toBe("adult");
  });

  it("audienceSchema rejects unknown value", () => {
    expect(audienceSchema.safeParse("everyone").success).toBe(false);
  });

  it("bookConceptSchema accepts custom genres + tones", () => {
    const c = bookConceptSchema.parse({
      schemaVersion: 1,
      genres: ["fantasy"],
      customGenres: ["solar_punk_cozy"],
      tones: ["dark"],
      audience: "adult",
      premise: { logline: "Герой ищет правду" },
    });
    expect(c.customGenres).toEqual(["solar_punk_cozy"]);
  });
});

describe("genre-registry seed", () => {
  it("includes fantasy with subgenres", () => {
    expect(getGenreById("fantasy")).toBeDefined();
    expect(getGenreById("fantasy.dark_fantasy")?.parentId).toBe("fantasy");
  });

  it("includes core tones", () => {
    expect(getToneById("dark")).toBeDefined();
    expect(getToneById("romantic")).toBeDefined();
  });

  it("returns undefined for unknown id", () => {
    expect(getGenreById("nope")).toBeUndefined();
    expect(getToneById("nope")).toBeUndefined();
  });

  it("GENRES + TONES are non-empty", () => {
    expect(GENRES.length).toBeGreaterThan(3);
    expect(TONES.length).toBeGreaterThan(3);
  });
});

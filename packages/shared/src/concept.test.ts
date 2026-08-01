import { describe, it, expect } from "vitest";
import {
  bookConceptSchema,
  emptyBookConcept,
  audienceSchema,
  isConceptComplete,
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

describe("isConceptComplete", () => {
  it("an empty concept is not complete", () => {
    expect(isConceptComplete(emptyBookConcept())).toBe(false);
  });

  it("a logline alone completes it — genres are not a gate", () => {
    expect(
      isConceptComplete({
        ...emptyBookConcept(),
        premise: { logline: "Картограф ищет остров, которого нет." },
      }),
    ).toBe(true);
  });

  it("genres without a logline do not complete it", () => {
    expect(
      isConceptComplete({ ...emptyBookConcept(), genres: ["fantasy"] }),
    ).toBe(false);
  });

  it("a whitespace-only logline does not count", () => {
    expect(
      isConceptComplete({ ...emptyBookConcept(), premise: { logline: "  \n " } }),
    ).toBe(false);
  });
});

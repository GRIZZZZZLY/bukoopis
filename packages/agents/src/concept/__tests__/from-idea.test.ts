import { describe, it, expect } from "vitest";
import { toBookConcept, type ConceptFromIdeaOutput } from "../from-idea.js";

const BASE: ConceptFromIdeaOutput = {
  genres: ["fantasy"],
  tones: ["melancholic"],
  audience: "ya",
  protagonist: "Девочка-картограф",
  conflict: "Город не хочет быть найденным",
  stakes: "Потеряет мать",
  logline: "Когда карта показывает город, которого нет, девочка идёт туда.",
};

describe("toBookConcept", () => {
  it("maps premise fields and registry ids straight through", () => {
    const c = toBookConcept(BASE);
    expect(c.schemaVersion).toBe(1);
    expect(c.genres).toEqual(["fantasy"]);
    expect(c.tones).toEqual(["melancholic"]);
    expect(c.audience).toBe("ya");
    expect(c.premise).toEqual({
      protagonist: "Девочка-картограф",
      conflict: "Город не хочет быть найденным",
      stakes: "Потеряет мать",
      logline: BASE.logline,
    });
    expect(c.customGenres).toBeUndefined();
    expect(c.customTones).toBeUndefined();
  });

  it("routes labels the registry does not know into customGenres/customTones", () => {
    const c = toBookConcept({
      ...BASE,
      genres: ["fantasy", "магический реализм"],
      tones: ["звенящий"],
    });
    expect(c.genres).toEqual(["fantasy"]);
    expect(c.customGenres).toEqual(["магический реализм"]);
    expect(c.tones).toEqual([]);
    expect(c.customTones).toEqual(["звенящий"]);
  });

  it("drops blank labels and deduplicates", () => {
    const c = toBookConcept({
      ...BASE,
      genres: ["fantasy", "fantasy", "  ", "свой жанр", "свой жанр"],
    });
    expect(c.genres).toEqual(["fantasy"]);
    expect(c.customGenres).toEqual(["свой жанр"]);
  });

  it("keeps a nested registry id such as fantasy.dark_fantasy", () => {
    const c = toBookConcept({ ...BASE, genres: ["fantasy.dark_fantasy"] });
    expect(c.genres).toEqual(["fantasy.dark_fantasy"]);
    expect(c.customGenres).toBeUndefined();
  });
});

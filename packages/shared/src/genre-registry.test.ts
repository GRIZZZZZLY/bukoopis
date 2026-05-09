import { describe, it, expect } from "vitest";
import {
  GENRES,
  TONES,
  getGenreById,
  getToneById,
  getRootGenres,
  getGenreChildren,
} from "./genre-registry.js";

describe("genre-registry expanded seed", () => {
  it("has at least 15 genres covering core trees", () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(15);
    expect(getGenreById("fantasy")).toBeDefined();
    expect(getGenreById("sci_fi")).toBeDefined();
    expect(getGenreById("mystery")).toBeDefined();
    expect(getGenreById("horror")).toBeDefined();
    expect(getGenreById("romance")).toBeDefined();
  });

  it("has at least 8 tones", () => {
    expect(TONES.length).toBeGreaterThanOrEqual(8);
    expect(getToneById("dark")).toBeDefined();
    expect(getToneById("hopeful")).toBeDefined();
  });

  it("getRootGenres returns only genres without parentId", () => {
    const roots = getRootGenres();
    for (const g of roots) expect(g.parentId).toBeUndefined();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThan(GENRES.length);
  });

  it("getGenreChildren returns direct descendants", () => {
    const fantasyKids = getGenreChildren("fantasy");
    expect(fantasyKids.length).toBeGreaterThan(0);
    for (const k of fantasyKids) expect(k.parentId).toBe("fantasy");
  });

  it("getGenreChildren returns empty array for leaf genre", () => {
    const leafId = GENRES.find((g) => getGenreChildren(g.id).length === 0)?.id;
    expect(leafId).toBeDefined();
    if (leafId) expect(getGenreChildren(leafId)).toEqual([]);
  });

  it("incompatibleWith references resolve to existing genres", () => {
    for (const g of GENRES) {
      if (!g.incompatibleWith) continue;
      for (const ref of g.incompatibleWith) {
        expect(getGenreById(ref)).toBeDefined();
      }
    }
  });

  it("parentId references resolve", () => {
    for (const g of GENRES) {
      if (!g.parentId) continue;
      expect(getGenreById(g.parentId)).toBeDefined();
    }
  });
});

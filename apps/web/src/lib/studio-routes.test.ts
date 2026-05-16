import { describe, it, expect } from "vitest";
import { stageRoute } from "./studio-routes";

describe("stageRoute", () => {
  it("concept maps to the studio dashboard", () => {
    expect(stageRoute(3, "concept")).toBe("/books/3/studio");
  });
  it("chapters maps to the chapters page", () => {
    expect(stageRoute(3, "chapters")).toBe("/books/3/studio/chapters");
  });
  it("aspect/entity stages map to their stage route", () => {
    expect(stageRoute(3, "world")).toBe("/books/3/studio/world");
    expect(stageRoute(3, "lore")).toBe("/books/3/studio/lore");
    expect(stageRoute(3, "plot")).toBe("/books/3/studio/plot");
    expect(stageRoute(3, "characters")).toBe("/books/3/studio/characters");
    expect(stageRoute(3, "items")).toBe("/books/3/studio/items");
  });
});

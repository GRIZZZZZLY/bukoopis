import { describe, it, expect } from "vitest";
import { annotationFor, booksPerRow, coverPalette, shelfLayout, titleSeed } from "../shelf";

describe("витрина — детерминированные обложки и раскладка", () => {
  it("titleSeed один и тот же для названия и разный для разных", () => {
    expect(titleSeed("Маяк")).toBe(titleSeed("Маяк"));
    expect(titleSeed("Маяк")).not.toBe(titleSeed("Зима"));
  });

  it("палитра обложки выводится из названия", () => {
    expect(coverPalette(titleSeed("Маяк"))).toEqual(coverPalette(titleSeed("Маяк")));
  });

  it("раскладка центрирует неполный последний ряд", () => {
    const slots = shelfLayout(5, 3, 1.4, 2);
    expect(slots.map((s) => s.row)).toEqual([0, 0, 0, 1, 1]);
    expect(slots[3]!.x).toBeCloseTo(-0.7);
    expect(slots[4]!.x).toBeCloseTo(0.7);
    expect(slots[0]!.y).toBeGreaterThan(slots[3]!.y);
  });

  it("в ряд не больше шести книг и не больше, чем их есть", () => {
    expect(booksPerRow(20, 2.2)).toBe(6);
    expect(booksPerRow(2, 2.2)).toBe(2);
  });
});

describe("аннотация книги", () => {
  it("собирается из утверждённого замысла по порядку", () => {
    expect(
      annotationFor({
        idea: "сырая идея",
        premise: { logline: "О чём", protagonist: "Кто", conflict: "", stakes: "Ставки" },
      }),
    ).toEqual(["О чём", "Кто", "Ставки"]);
  });

  it("без замысла — исходная идея автора", () => {
    expect(annotationFor({ idea: "  Смотритель находит рыбу ", premise: {} })).toEqual([
      "Смотритель находит рыбу",
    ]);
  });

  it("пусто — null, текст не выдумывается", () => {
    expect(annotationFor({ premise: {} })).toBeNull();
    expect(annotationFor(null)).toBeNull();
  });
});

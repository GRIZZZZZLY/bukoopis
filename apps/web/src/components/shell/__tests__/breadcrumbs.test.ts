import { describe, it, expect } from "vitest";
import type { Book, Chapter } from "@book-forge/shared";
import { breadcrumbs, parseRoute } from "../AppShell";

const book = { id: 3, title: "Соляной берег" } as Book;
const chapters = [
  { id: 30, title: "Сети на рассвете" },
  { id: 31, title: "Капитан Горн" },
] as Chapter[];

function crumbs(path: string) {
  return breadcrumbs(parseRoute(path), book, chapters, "Северная проза");
}

describe("крошки", () => {
  it("называют книгу по имени и ведут в её дом", () => {
    expect(crumbs("/books/3/canon")).toEqual([
      { label: "Полка", to: "/books" },
      { label: "Соляной берег", to: "/books/3" },
      { label: "Канон" },
    ]);
  });

  it("обзор — корень дома книги", () => {
    expect(crumbs("/books/3").at(-1)).toEqual({ label: "Обзор" });
  });

  it("этап — «Мастерская · этап», замысел — корень Мастерской", () => {
    expect(crumbs("/books/3/studio/plot").at(-1)).toEqual({ label: "Мастерская · План" });
    expect(crumbs("/books/3/studio").at(-1)).toEqual({ label: "Мастерская · Замысел" });
  });

  it("глава — порядковый номер в книге, а не order_index", () => {
    expect(crumbs("/books/3/chapters/31").at(-1)).toEqual({ label: "Глава 2 · Капитан Горн" });
  });

  it("профиль стиля — по имени", () => {
    expect(crumbs("/style-profiles/5")).toEqual([
      { label: "Профили стиля", to: "/style-profiles" },
      { label: "Северная проза" },
    ]);
  });

  it("расходы — одним словом", () => {
    expect(crumbs("/usage")).toEqual([{ label: "Расходы" }]);
  });
});

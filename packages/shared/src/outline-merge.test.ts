import { describe, it, expect } from "vitest";
import {
  MAX_OUTLINE_VARIANTS,
  mergeOutlineVariants,
  type BookOutline,
  type BookOutlineVariant,
} from "./plot.js";

/** F04 ревью 2026-09-22: при переполнении интейк переставлял авторские
 *  варианты вперёд и сохранял старый индекс — выбор молча переезжал. */

const v = (label: string, source?: "llm" | "author_material"): BookOutlineVariant =>
  ({ label, estimatedChapters: 3, ...(source ? { source } : {}) });
const outline = (variants: BookOutlineVariant[], selectedIndex: number | null): BookOutline => ({
  variants,
  selectedIndex,
  generatedAt: "t",
});
const titles = (o: BookOutline) => o.variants.map((x) => x.label);
const selectedTitle = (o: BookOutline) =>
  o.selectedIndex === null ? null : o.variants[o.selectedIndex]!.label;

describe("mergeOutlineVariants", () => {
  it("выбор остаётся на том же варианте после добавления авторского", () => {
    const gen = Array.from({ length: MAX_OUTLINE_VARIANTS }, (_, i) => v(`G${i}`, "llm"));
    const { outline: next, dropped } = mergeOutlineVariants(outline(gen, 1), [v("A", "author_material")], "n");
    expect(dropped).toBe(0);
    expect(selectedTitle(next)).toBe("G1");
    expect(titles(next)).toContain("A");
    expect(titles(next)).not.toContain("G0"); // самый старый невыбранный сгенерированный
    expect(next.variants).toHaveLength(MAX_OUTLINE_VARIANTS);
  });

  it("авторские не вытесняются, а не влезшие — считаются, а не пропадают молча", () => {
    const authors = Array.from({ length: MAX_OUTLINE_VARIANTS + 1 }, (_, i) => v(`A${i}`, "author_material"));
    const { outline: next, dropped } = mergeOutlineVariants(null, authors, "n");
    expect(next.variants).toHaveLength(MAX_OUTLINE_VARIANTS);
    expect(dropped).toBe(1);
  });

  it("перегенерация сохраняет выбранный и авторский, вытесняя старые сгенерированные", () => {
    const current = outline([v("G0", "llm"), v("A", "author_material"), v("G1", "llm")], 2);
    const fresh = Array.from({ length: MAX_OUTLINE_VARIANTS }, (_, i) => v(`N${i}`, "llm"));
    const { outline: next } = mergeOutlineVariants(current, fresh, "n");
    expect(selectedTitle(next)).toBe("G1");
    expect(titles(next)).toContain("A");
    expect(titles(next)).not.toContain("G0");
    expect(next.variants).toHaveLength(MAX_OUTLINE_VARIANTS);
  });
});

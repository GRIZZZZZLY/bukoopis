/** Витрина полки: всё выводится из данных книги детерминированно, без
 *  Math.random — обложки и раскладка не «прыгают» между заходами. */
import type { BookConcept } from "@book-forge/shared";

export interface BookStats {
  chapters: number;
  done: number;
  words: number;
}

export function titleSeed(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) >>> 0;
  }
  return h;
}

export interface CoverPalette {
  /** Ткань переплёта. */
  base: string;
  /** Тень к краям и корешок. */
  dark: string;
  /** Тиснение: рамка, линии, название. */
  foil: string;
}

/** Переплёты в тон «Чернильной ночи»: глубокие ткани и латунное тиснение. */
const PALETTES: CoverPalette[] = [
  { base: "#2B3A5C", dark: "#1B2540", foil: "#E8B65C" }, // чернильно-синий
  { base: "#5A2E2E", dark: "#3A1C1D", foil: "#E4C48A" }, // бордо
  { base: "#2F4A3E", dark: "#1D2F27", foil: "#D9B46A" }, // мох
  { base: "#4A3A5E", dark: "#2E2440", foil: "#E2BF7E" }, // слива
  { base: "#5B4630", dark: "#3A2C1E", foil: "#EBCB8B" }, // табак
  { base: "#23434F", dark: "#152B33", foil: "#DDB870" }, // морская волна
];

export function coverPalette(seed: number): CoverPalette {
  return PALETTES[Math.abs(seed) % PALETTES.length]!;
}

/** Аннотация — из того, что автор утвердил в замысле: «о чём книга»,
 *  герой, конфликт, ставки. Отдельного поля аннотации в системе нет, и
 *  выдумывать текст мы не вправе. Замысел не утверждён — исходная идея;
 *  нет и её — null. */
export function annotationFor(concept: Pick<BookConcept, "premise" | "idea"> | null): string[] | null {
  if (!concept) return null;
  const p = concept.premise ?? {};
  const parts = [p.logline, p.protagonist, p.conflict, p.stakes]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
  if (parts.length > 0) return parts;
  const idea = (concept.idea ?? "").trim();
  return idea ? [idea] : null;
}

export interface Slot {
  x: number;
  y: number;
  row: number;
}

/** Раскладка по полкам: не больше `perRow` книг в ряд, ряды сверху вниз,
 *  каждый ряд отцентрован. Координаты — центры книг в единицах сцены. */
export function shelfLayout(count: number, perRow: number, step: number, rowStep: number): Slot[] {
  const rows = Math.max(1, Math.ceil(count / perRow));
  const out: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const col = i % perRow;
    out.push({
      x: (col - (inRow - 1) / 2) * step,
      y: ((rows - 1) / 2 - row) * rowStep,
      row,
    });
  }
  return out;
}

/** Сколько книг в ряд: до шести, и не больше, чем влезает по ширине. */
export function booksPerRow(count: number, aspect: number): number {
  const byWidth = Math.max(2, Math.floor(aspect * 3.2));
  return Math.max(1, Math.min(6, byWidth, count));
}

import type { BookNote } from "@book-forge/shared";

/** Раскладка пробковой доски: колонка = глава появления заметки,
    строка = позиция в стопке этой главы. Всё детерминировано от данных. */

export const COLUMN_W = 200;
export const ROW_H = 132;
export const PIN_X = 26;

export interface PlacedNote {
  note: BookNote;
  col: number;
  row: number;
  x: number;
  y: number;
}

export function boardColumns(notes: BookNote[]): number[] {
  return [...new Set(notes.map((n) => n.introduced))].sort((a, b) => a - b);
}

export function layoutNotes(notes: BookNote[]): PlacedNote[] {
  const columns = boardColumns(notes);
  const used = new Map<number, number>();
  return notes.map((note) => {
    const col = columns.indexOf(note.introduced);
    const row = used.get(col) ?? 0;
    used.set(col, row + 1);
    return { note, col, row, x: col * COLUMN_W, y: row * ROW_H };
  });
}

export function boardWidth(columns: number[]): number {
  return Math.max(0, columns.length) * COLUMN_W;
}

export function boardHeight(placed: PlacedNote[]): number {
  return placed.reduce((max, p) => Math.max(max, (p.row + 1) * ROW_H), 0);
}

/** Нить заметки: от её колонки до колонки закрытия. Незакрытая (или закрытая
    в главе, которой нет на доске) уходит за правый край. */
export function threadSpan(
  note: BookNote,
  columns: number[],
): { x1: number; x2: number; open: boolean } {
  const from = columns.indexOf(note.introduced);
  const x1 = from * COLUMN_W + COLUMN_W / 2;
  const to = note.resolved === null ? -1 : columns.indexOf(note.resolved);
  if (to < 0) return { x1, x2: boardWidth(columns), open: true };
  return { x1, x2: to * COLUMN_W + COLUMN_W / 2, open: false };
}

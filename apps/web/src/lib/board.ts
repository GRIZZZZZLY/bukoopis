import type { BookNote } from "@book-forge/shared";

/** Раскладка пробковой доски: колонка = глава появления заметки,
    строка = позиция в стопке этой главы. Всё детерминировано от данных. */

export const COLUMN_W = 200;
export const ROW_H = 172;
/** Внутренний отступ канвы. Абсолютно спозиционированные дети координируются
    от него явно: CSS padding на .board-canvas сдвигает только контент в
    потоке, а не absolute-детей (те всё равно считаются от padding-box), так
    что инсет должен жить в самой геометрии, а не в стилях. */
export const BOARD_PAD = 20;
/** Высота полосы с номерами глав над первым рядом заметок. */
export const HEADER_H = 26;

export interface PlacedNote {
  note: BookNote;
  col: number;
  row: number;
  x: number;
  y: number;
}

/** Ось колонок — объединение глав появления И глав закрытия заметок. Глава,
    которая только закрывает нить (не заводя в ней своих заметок), всё равно
    должна получить колонку — иначе threadSpan не находит её и рисует
    закрытую нить как открытую. */
export function boardColumns(notes: BookNote[]): number[] {
  const chapters = new Set<number>();
  for (const n of notes) {
    chapters.add(n.introduced);
    if (n.resolved !== null) chapters.add(n.resolved);
  }
  return [...chapters].sort((a, b) => a - b);
}

export function layoutNotes(notes: BookNote[]): PlacedNote[] {
  const columns = boardColumns(notes);
  const used = new Map<number, number>();
  return notes.map((note) => {
    const col = columns.indexOf(note.introduced);
    const row = used.get(col) ?? 0;
    used.set(col, row + 1);
    return {
      note,
      col,
      row,
      x: BOARD_PAD + col * COLUMN_W,
      y: BOARD_PAD + HEADER_H + row * ROW_H,
    };
  });
}

export function boardWidth(columns: number[]): number {
  return BOARD_PAD * 2 + Math.max(0, columns.length) * COLUMN_W;
}

export function boardHeight(placed: PlacedNote[]): number {
  const tallest = placed.reduce((max, p) => Math.max(max, p.row + 1), 0);
  return tallest === 0 ? 0 : BOARD_PAD * 2 + HEADER_H + tallest * ROW_H;
}

/** Нить заметки: от её колонки до колонки закрытия. Незакрытая уходит за
    правый край доски. Закрытая всегда находит свою колонку — boardColumns
    гарантирует её присутствие через ось введения+закрытия. */
export function threadSpan(
  note: BookNote,
  columns: number[],
): { x1: number; x2: number; open: boolean } {
  const from = columns.indexOf(note.introduced);
  const x1 = BOARD_PAD + from * COLUMN_W + COLUMN_W / 2;
  const to = note.resolved === null ? -1 : columns.indexOf(note.resolved);
  if (to < 0) return { x1, x2: boardWidth(columns), open: true };
  return { x1, x2: BOARD_PAD + to * COLUMN_W + COLUMN_W / 2, open: false };
}

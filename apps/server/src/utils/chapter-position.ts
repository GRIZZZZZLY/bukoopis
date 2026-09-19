import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Порядковый номер главы для человека по её `order_index`.
 *
 * `order_index` — разрежённый: главы заводятся с шагом 10, чтобы вставка
 * между ними не двигала соседей. Поэтому считать по нему расстояние в главах
 * нельзя (соседние отличаются на 10, а не на 1) и показывать его читателю
 * тоже нельзя — девятая глава книги имеет `order_index` 90.
 */
export function chapterPositionLookup(
  sqlite: DatabaseType,
  bookId: number,
): (orderIndex: number) => number {
  const rows = sqlite
    .prepare(
      "SELECT order_index FROM chapters WHERE book_id = ? ORDER BY order_index ASC",
    )
    .all(bookId) as Array<{ order_index: number }>;
  const positions = new Map(rows.map((r, i) => [r.order_index, i + 1]));
  return (orderIndex) => positions.get(orderIndex) ?? orderIndex;
}

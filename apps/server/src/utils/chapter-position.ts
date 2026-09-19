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
): (orderIndex: number) => number | null {
  const rows = sqlite
    .prepare(
      "SELECT order_index FROM chapters WHERE book_id = ? ORDER BY order_index ASC",
    )
    .all(bookId) as Array<{ order_index: number }>;
  const positions = new Map(rows.map((r, i) => [r.order_index, i + 1]));
  // `null`, а не сам `order_index`: вернув его, функция подмешала бы
  // разрежённое число (90) к позициям (10) — та самая ошибка, против которой
  // она написана. Глава не из этой книги номера не получает.
  return (orderIndex) => positions.get(orderIndex) ?? null;
}

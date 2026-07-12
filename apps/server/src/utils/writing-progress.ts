import type { Database as DatabaseType } from "better-sqlite3";

/** Локальная дата сервера YYYY-MM-DD — граница «дня письма». */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Копит положительные дельты слов в writing_days. Ноль/минус игнорируются
    (правки-сокращения не «сжигают» свечу). Fire-and-forget семантика: ошибки
    записи в леджер никогда не должны валить вызывающий запрос (например,
    автосейв драфта — черновик уже сохранён к моменту вызова). */
export function recordWritingDelta(
  sqlite: DatabaseType,
  delta: number,
  day: string = localDay(),
): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  try {
    sqlite
      .prepare(
        `INSERT INTO writing_days (date, words_added) VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET words_added = words_added + excluded.words_added`,
      )
      .run(day, Math.round(delta));
  } catch (e) {
    console.warn(
      "[writing-progress] recordWritingDelta failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

export function getWritingProgress(
  sqlite: DatabaseType,
  day: string = localDay(),
): { date: string; wordsAdded: number } {
  const row = sqlite
    .prepare(`SELECT words_added FROM writing_days WHERE date = ?`)
    .get(day) as { words_added: number } | undefined;
  return { date: day, wordsAdded: row?.words_added ?? 0 };
}

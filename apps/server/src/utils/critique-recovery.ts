import type { Database as DatabaseType } from "better-sqlite3";

/**
 * В13 ревью 2026-09-19: критика — обычный POST, который держится минуты и
 * четыре вызова модели. Строка `critique_reports` вставляется `pending` ДО
 * вызова, а завершает её тот же обработчик. Рестарт сервера (или закрытая
 * вкладка на долгом вызове) оставлял строку в `pending` навсегда, и
 * `GET /chapter-versions/:id/critique` отдавал вечное ожидание: автор видел
 * «критика идёт» на отчёте, которого никто уже не пишет.
 *
 * У заданий памяти для этого есть `recoverStaleMemoryJobs` — здесь то же
 * самое. Процесс один, и после старта ни один `pending` не может быть живым:
 * писать его было некому.
 */
/**
 * Кандидаты прозы, оставшиеся в `streaming` от прошлого запуска (С8).
 *
 * Реестр отмены живёт в памяти процесса, писать в такую строку больше
 * некому, а экран главы её не показывает вовсе — автор видит «ничего нет» и
 * запускает генерацию заново, то есть платит второй раз за тот же текст.
 * После старта ни один `streaming` живым быть не может.
 */
export function recoverStaleProseProposals(sqlite: DatabaseType): number {
  const now = new Date().toISOString();
  return sqlite
    .prepare(
      `UPDATE prose_proposals
       SET status = 'failed',
           error_message = COALESCE(error_message, ?),
           updated_at = ?
       WHERE status = 'streaming'`,
    )
    .run(
      "Генерация прервалась вместе с работой сервера. Запустите её заново.",
      now,
    ).changes;
}

export function recoverStaleCritiqueReports(sqlite: DatabaseType): number {
  const now = new Date().toISOString();
  return sqlite
    .prepare(
      `UPDATE critique_reports
       SET status = 'error',
           error_message = COALESCE(error_message, ?),
           completed_at = ?
       WHERE status = 'pending'`,
    )
    .run(
      "Разбор критиков прервался вместе с работой сервера. Запустите его заново.",
      now,
    ).changes;
}

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
/** Шесть пропущенных пульсов по 20 с. */
export const PROPOSAL_LEASE_MS = 2 * 60 * 1000;

export function recoverStaleProseProposals(
  sqlite: DatabaseType,
  nowMs: number = Date.now(),
): number {
  const now = new Date(nowMs).toISOString();
  // Мёртвым считается кандидат, чей раннер молчит дольше срока аренды: живой
  // раннер обновляет `updated_at` пульсом (`touchProposal`) раз в 20 с.
  // Судить по возрасту строки нельзя (F14): свежая генерация умершего процесса
  // висела бы до следующего рестарта. Совсем без порога тоже нельзя: второй
  // процесс сервера на той же базе гасил бы ЖИВУЮ генерацию первого, и
  // `finishProposal`, который пишет только из `streaming`, выбросил бы текст.
  const cutoff = new Date(nowMs - PROPOSAL_LEASE_MS).toISOString();
  // Глава по беатам дописывает кандидата после каждого беата, и `failed`
  // здесь обесценивал бы всю эту работу: `acceptProposal` такой статус не
  // принимает, и автор видел бы строку с готовым текстом, которую нельзя
  // взять. Написанные беаты обрываются, а не пропадают.
  return sqlite
    .prepare(
      `UPDATE prose_proposals
       SET status = CASE WHEN COALESCE(beats_done, 0) > 0 THEN 'incomplete' ELSE 'failed' END,
           stop_reason = CASE WHEN COALESCE(beats_done, 0) > 0 THEN 'interrupted' ELSE stop_reason END,
           error_message = COALESCE(
             error_message,
             CASE WHEN COALESCE(beats_done, 0) > 0 THEN ? ELSE ? END
           ),
           updated_at = ?
       WHERE status = 'streaming' AND updated_at < ?`,
    )
    .run(
      "Генерация прервалась вместе с работой сервера. Написанные беаты можно принять.",
      "Генерация прервалась вместе с работой сервера. Запустите её заново.",
      now,
      cutoff,
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

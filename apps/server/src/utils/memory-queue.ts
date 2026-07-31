import type { Database as DatabaseType } from "better-sqlite3";
import {
  LLMAuthError,
  LLMMultipleToolCallsError,
  LLMNoToolCallError,
  LLMSchemaRetryExhaustedError,
  LLMValidationError,
} from "@book-forge/llm";

/**
 * ADR 0002 — durable memory job queue (SQLite-backed, single process).
 *
 * Primitives only: enqueue / claim / complete / fail / obsolete / recover.
 * The worker loop lives in memory-worker.ts. All writes are synchronous
 * better-sqlite3 statements; the process is single-threaded, so claim is
 * race-free without locking tricks.
 */

export const MEMORY_PIPELINE_VERSION = 1;
export const MEMORY_MAX_ATTEMPTS = 5;

/** Jobs enqueued atomically with every committed chapter version. */
export const COMMIT_JOB_KINDS = ["index", "summary", "facts", "notes"] as const;

export type MemoryJobKind = "index" | "summary" | "facts" | "notes" | "rollup";
export type MemoryJobStatus =
  | "pending"
  | "running"
  | "retry"
  | "done"
  | "error"
  | "obsolete";

/** Kinds that write to ACTIVE tables and depend on prior chapters' state.
 *  They are claimed strictly in chapter order and blocked by any unfinished
 *  earlier-chapter stateful job (ADR 0002, I5). */
const STATEFUL_KINDS: ReadonlyArray<MemoryJobKind> = ["facts", "notes"];

export interface MemoryJobRow {
  id: number;
  book_id: number;
  chapter_id: number;
  chapter_version_id: number;
  kind: MemoryJobKind;
  pipeline_version: number;
  status: MemoryJobStatus;
  attempts: number;
  run_after: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueMemoryJobsInput {
  bookId: number;
  chapterId: number;
  chapterVersionId: number;
  kinds: ReadonlyArray<MemoryJobKind>;
}

/**
 * Insert pending jobs. Idempotent via UNIQUE(chapter_version_id, kind,
 * pipeline_version) — re-enqueueing the same version+kind is a no-op.
 * Runs plain INSERTs so the CALLER can wrap it in the same transaction that
 * creates the chapter version (commit is atomic: version+jobs or nothing).
 */
export function enqueueMemoryJobs(
  sqlite: DatabaseType,
  input: EnqueueMemoryJobsInput,
): void {
  const now = new Date().toISOString();
  const stmt = sqlite.prepare(
    `INSERT OR IGNORE INTO memory_jobs
       (book_id, chapter_id, chapter_version_id, kind, pipeline_version,
        status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  );
  for (const kind of input.kinds) {
    stmt.run(
      input.bookId,
      input.chapterId,
      input.chapterVersionId,
      kind,
      MEMORY_PIPELINE_VERSION,
      now,
      now,
    );
  }
}

/**
 * Order indexes of earlier chapters whose committed memory work hasn't landed
 * yet — queued, running, or permanently errored. Writing chapter N while these
 * are outstanding still produces valid prose, but the prompt silently misses
 * those chapters' facts, notes, summary and retrievable chunks. `obsolete` jobs
 * are excluded: a newer version of that chapter has its own jobs.
 */
export function pendingEarlierMemoryChapters(
  sqlite: DatabaseType,
  bookId: number,
  beforeOrderIndex: number,
): number[] {
  const rows = sqlite
    .prepare(
      `SELECT DISTINCT c.order_index AS order_index
       FROM memory_jobs j
       JOIN chapters c ON c.id = j.chapter_id
       WHERE j.book_id = ?
         AND c.order_index < ?
         AND j.status IN ('pending','running','retry','error')
       ORDER BY c.order_index ASC`,
    )
    .all(bookId, beforeOrderIndex) as Array<{ order_index: number }>;
  return rows.map((r) => r.order_index);
}

export interface ClaimOptions {
  /** Injectable clock for tests (ISO). Defaults to now. */
  now?: string;
  /** Restrict claiming to these kinds (used by tests to drain only `index`). */
  kinds?: ReadonlyArray<MemoryJobKind>;
}

/**
 * Claim the next runnable job (status → running, attempts+1). Returns null
 * when nothing is claimable right now (empty queue, future run_after, or
 * stateful jobs blocked by an earlier chapter).
 */
export function claimNextMemoryJob(
  sqlite: DatabaseType,
  opts?: ClaimOptions,
): MemoryJobRow | null {
  const now = opts?.now ?? new Date().toISOString();
  const kindFilter = opts?.kinds?.length
    ? ` AND j.kind IN (${opts.kinds.map(() => "?").join(",")})`
    : "";
  const statefulList = STATEFUL_KINDS.map((k) => `'${k}'`).join(",");

  const row = sqlite
    .prepare(
      `SELECT j.* FROM memory_jobs j
       JOIN chapters c ON c.id = j.chapter_id
       WHERE j.status IN ('pending','retry')
         AND (j.run_after IS NULL OR j.run_after <= ?)
         ${kindFilter}
         AND (
           j.kind NOT IN (${statefulList})
           OR NOT EXISTS (
             SELECT 1 FROM memory_jobs j2
             JOIN chapters c2 ON c2.id = j2.chapter_id
             WHERE j2.book_id = j.book_id
               AND j2.kind IN (${statefulList})
               AND j2.status IN ('pending','running','retry','error')
               AND c2.order_index < c.order_index
           )
         )
       ORDER BY c.order_index ASC, j.id ASC
       LIMIT 1`,
    )
    .get(now, ...(opts?.kinds ?? [])) as MemoryJobRow | undefined;
  if (!row) return null;

  sqlite
    .prepare(
      `UPDATE memory_jobs
       SET status='running', attempts=attempts+1, started_at=?, updated_at=?
       WHERE id = ?`,
    )
    .run(now, now, row.id);
  return { ...row, status: "running", attempts: row.attempts + 1 };
}

/** Persist staged output + mark done in ONE statement — a crash cannot leave
 *  "result written but job unfinished" or vice versa. */
export function completeMemoryJob(
  sqlite: DatabaseType,
  id: number,
  result?: unknown,
): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE memory_jobs
       SET status='done', result_json=?, finished_at=?, updated_at=?
       WHERE id = ?`,
    )
    .run(result === undefined ? null : JSON.stringify(result), now, now, id);
}

export function markMemoryJobObsolete(sqlite: DatabaseType, id: number): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `UPDATE memory_jobs
       SET status='obsolete', finished_at=?, updated_at=?
       WHERE id = ?`,
    )
    .run(now, now, id);
}

/** Exponential backoff: 5s, 10s, 20s, 40s… capped at 5 min. */
export function retryBackoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 300_000);
}

/** Terminal LLM failures that a blind retry cannot fix (ADR retry policy). */
export function isRetryableMemoryError(e: unknown): boolean {
  return !(
    e instanceof LLMAuthError ||
    e instanceof LLMValidationError ||
    e instanceof LLMNoToolCallError ||
    e instanceof LLMMultipleToolCallsError ||
    e instanceof LLMSchemaRetryExhaustedError
  );
}

export function failMemoryJob(
  sqlite: DatabaseType,
  job: Pick<MemoryJobRow, "id" | "attempts">,
  error: unknown,
  opts: { retryable: boolean },
): MemoryJobStatus {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  const willRetry = opts.retryable && job.attempts < MEMORY_MAX_ATTEMPTS;
  if (willRetry) {
    const runAfter = new Date(
      Date.now() + retryBackoffMs(job.attempts),
    ).toISOString();
    sqlite
      .prepare(
        `UPDATE memory_jobs
         SET status='retry', run_after=?, last_error=?, updated_at=?
         WHERE id = ?`,
      )
      .run(runAfter, message, now, job.id);
    return "retry";
  }
  sqlite
    .prepare(
      `UPDATE memory_jobs
       SET status='error', last_error=?, finished_at=?, updated_at=?
       WHERE id = ?`,
    )
    .run(message, now, now, job.id);
  return "error";
}

/** Boot recovery: jobs stuck in `running` after a crash go back to `retry`
 *  (single-process model — nothing else can legitimately hold them). */
export function recoverStaleMemoryJobs(sqlite: DatabaseType): number {
  const now = new Date().toISOString();
  const res = sqlite
    .prepare(
      `UPDATE memory_jobs
       SET status='retry', run_after=NULL, updated_at=?
       WHERE status='running'`,
    )
    .run(now);
  return res.changes;
}

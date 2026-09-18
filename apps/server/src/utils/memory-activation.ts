import type { Database as DatabaseType } from "better-sqlite3";
import type { EpisodicNoteExtraction, ExtractedFact, ExtractedCharacterEvent } from "@book-forge/shared";
import { COMMIT_JOB_KINDS, MEMORY_PIPELINE_VERSION, type MemoryJobKind } from "./memory-queue.js";
import { persistExtractedFacts } from "./book-facts.js";
import { materializeEpisodicNotes } from "./book-notes.js";
import { persistCharacterEvents } from "./character-events.js";

/**
 * ADR 0002 (I4, I6) — atomic memory activation + book-level staleness.
 *
 * Handlers stage facts/notes payloads into memory_jobs.result_json; nothing
 * touches the active tables until ALL commit-kinds for a version are done.
 * Then activation applies everything in ONE immediate transaction and flips
 * chapters.memory_version_id. A version superseded meanwhile is never
 * applied ("obsolete"). Retrieval reads by memory_version_id (I2), so the
 * previous activated version keeps serving until the new one lands.
 */

/** Staged payload shapes written by the worker into result_json. */
export interface StagedFactsResult {
  factCount: number;
  eventCount?: number;
  skipped?: string;
  staged?: {
    facts: ExtractedFact[];
    /** Необязательные: staged-результаты версии конвейера 1 их не несут. */
    characterEvents?: ExtractedCharacterEvent[];
  };
}
export interface StagedNotesResult {
  newCount: number;
  resolvedCount: number;
  skipped?: string;
  /** embeddings[i] pairs with extraction.newNotes[i], base64 or null. */
  staged?: { extraction: EpisodicNoteExtraction; embeddings: Array<string | null> };
}

export type ActivationOutcome = "activated" | "pending" | "obsolete" | "already";

interface JobLite {
  kind: MemoryJobKind;
  status: string;
  result_json: string | null;
}

export function tryActivateMemoryVersion(
  sqlite: DatabaseType,
  chapterId: number,
  versionId: number,
): ActivationOutcome {
  const jobs = sqlite
    .prepare(
      `SELECT kind, status, result_json FROM memory_jobs
       WHERE chapter_version_id = ?
       ORDER BY pipeline_version DESC, id DESC`,
    )
    .all(versionId) as JobLite[];

  // Latest job per kind wins (rebuild re-inserts fresh rows).
  const byKind = new Map<MemoryJobKind, JobLite>();
  for (const j of jobs) if (!byKind.has(j.kind)) byKind.set(j.kind, j);

  for (const kind of COMMIT_JOB_KINDS) {
    const j = byKind.get(kind);
    if (!j) return "pending";
    if (j.status === "obsolete") return "obsolete";
    if (j.status !== "done") return "pending";
  }

  const factsJob = byKind.get("facts")!;
  const notesJob = byKind.get("notes")!;
  const factsResult = parseJson<StagedFactsResult>(factsJob.result_json);
  const notesResult = parseJson<StagedNotesResult>(notesJob.result_json);

  const tx = sqlite.transaction((): ActivationOutcome => {
    const ch = sqlite
      .prepare(
        "SELECT book_id, order_index, current_version_id, memory_version_id FROM chapters WHERE id = ?",
      )
      .get(chapterId) as
      | {
          book_id: number;
          order_index: number;
          current_version_id: number | null;
          memory_version_id: number | null;
        }
      | undefined;
    if (!ch) return "obsolete";
    if (ch.current_version_id !== versionId) return "obsolete";
    if (ch.memory_version_id === versionId) return "already";

    if (factsResult?.staged?.facts?.length) {
      persistExtractedFacts(
        sqlite,
        ch.book_id,
        ch.order_index,
        versionId,
        factsResult.staged.facts,
      );
    }
    const staged = factsResult?.staged;
    if (staged?.characterEvents?.length) {
      const outcome = persistCharacterEvents(sqlite, {
        bookId: ch.book_id,
        chapterId,
        sourceVersionId: versionId,
        events: staged.characterEvents,
        extractorVersion: MEMORY_PIPELINE_VERSION,
      });
      if (outcome.rejectedEvidence > 0 || outcome.unresolved > 0) {
        // Не ошибка активации: остальные слои версии обязаны активироваться.
        // Но молчать нельзя — это единственное место, где видно, сколько
        // извлечённого отброшено и почему.
        console.warn(
          `[memory] v${versionId}: событий отброшено — доказательство ${outcome.rejectedEvidence}, имя не разрешилось ${outcome.unresolved}`,
        );
      }
    }
    if (notesResult?.staged) {
      materializeEpisodicNotes(
        sqlite,
        ch.book_id,
        ch.order_index,
        versionId,
        notesResult.staged.extraction,
        notesResult.staged.embeddings.map((b) =>
          b === null ? null : Buffer.from(b, "base64"),
        ),
      );
    }

    sqlite
      .prepare("UPDATE chapters SET memory_version_id = ? WHERE id = ?")
      .run(versionId, chapterId);

    maybeClearMemoryStale(sqlite, ch.book_id);
    return "activated";
  });
  return tx.immediate();
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Call INSIDE the commit transaction: if a LATER chapter already has
 * activated memory, its derived facts/notes were built against the state
 * this commit just changed — mark the book stale from this chapter (I6).
 */
export function markMemoryStaleOnCommit(
  sqlite: DatabaseType,
  bookId: number,
  chapterOrder: number,
): void {
  const later = sqlite
    .prepare(
      `SELECT 1 FROM chapters
       WHERE book_id = ? AND order_index > ? AND memory_version_id IS NOT NULL
       LIMIT 1`,
    )
    .get(bookId, chapterOrder);
  if (!later) return;
  sqlite
    .prepare(
      `UPDATE books SET memory_stale_from_chapter_order =
         CASE WHEN memory_stale_from_chapter_order IS NULL THEN ?
              ELSE MIN(memory_stale_from_chapter_order, ?) END
       WHERE id = ?`,
    )
    .run(chapterOrder, chapterOrder, bookId);
}

/**
 * Clear the stale marker once every committed chapter ≥ the stale point has
 * its memory activated for the CURRENT version and no unfinished jobs remain.
 * Known P0 simplification (documented in ADR 0002): re-committing only the
 * edited chapter satisfies this too — full downstream re-extraction is the
 * explicit "Перестроить с главы N" rebuild flow.
 */
export function maybeClearMemoryStale(
  sqlite: DatabaseType,
  bookId: number,
): void {
  const b = sqlite
    .prepare("SELECT memory_stale_from_chapter_order s FROM books WHERE id = ?")
    .get(bookId) as { s: number | null } | undefined;
  if (!b || b.s === null) return;

  const dirty = sqlite
    .prepare(
      `SELECT 1 FROM chapters c
       WHERE c.book_id = ? AND c.order_index >= ? AND c.current_version_id IS NOT NULL
         AND (c.memory_version_id IS NULL OR c.memory_version_id != c.current_version_id)
       LIMIT 1`,
    )
    .get(bookId, b.s);
  if (dirty) return;

  // Only commit-kinds gate the marker — rollup is a book-scoped convenience
  // summary chained AFTER activation and must not hold staleness hostage.
  const unfinished = sqlite
    .prepare(
      `SELECT 1 FROM memory_jobs j
       JOIN chapters c ON c.id = j.chapter_id
       WHERE j.book_id = ? AND c.order_index >= ?
         AND j.chapter_version_id = c.current_version_id
         AND j.kind IN ('index','summary','facts','notes')
         AND j.status IN ('pending','running','retry','error')
       LIMIT 1`,
    )
    .get(bookId, b.s);
  if (unfinished) return;

  sqlite
    .prepare(
      "UPDATE books SET memory_stale_from_chapter_order = NULL WHERE id = ?",
    )
    .run(bookId);
}

export interface ChapterMemoryStatus {
  state: "fresh" | "updating" | "error" | "none";
  memoryVersionId: number | null;
}

/** Per-chapter memory state for the UI (computed, not stored). */
export function chapterMemoryStatus(
  sqlite: DatabaseType,
  chapter: { current_version_id: number | null; memory_version_id?: number | null },
): ChapterMemoryStatus {
  const memoryVersionId =
    (chapter as { memory_version_id?: number | null }).memory_version_id ?? null;
  if (!chapter.current_version_id) return { state: "none", memoryVersionId };
  if (memoryVersionId === chapter.current_version_id) {
    return { state: "fresh", memoryVersionId };
  }
  const jobs = sqlite
    .prepare(
      `SELECT status, COUNT(*) n FROM memory_jobs
       WHERE chapter_version_id = ? GROUP BY status`,
    )
    .all(chapter.current_version_id) as Array<{ status: string; n: number }>;
  const has = (s: string): boolean => jobs.some((j) => j.status === s && j.n > 0);
  if (has("error")) return { state: "error", memoryVersionId };
  if (has("pending") || has("running") || has("retry")) {
    return { state: "updating", memoryVersionId };
  }
  return { state: "none", memoryVersionId };
}

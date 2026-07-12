import type { Database as DatabaseType } from "better-sqlite3";
import { summarizeChapter } from "@book-forge/agents";
import { indexChapterVersion } from "@book-forge/retrieval";
import {
  claimNextMemoryJob,
  completeMemoryJob,
  failMemoryJob,
  isRetryableMemoryError,
  markMemoryJobObsolete,
  recoverStaleMemoryJobs,
  enqueueMemoryJobs,
  type MemoryJobKind,
  type MemoryJobRow,
} from "./memory-queue.js";
import { extractFactsPayload } from "./book-facts.js";
import { extractNotesPayload, embedExtractedNotes } from "./book-notes.js";
import { runMetaSummary } from "./rolling-context.js";
import { tryActivateMemoryVersion } from "./memory-activation.js";
import { logUsage } from "./usageLogger.js";

/**
 * ADR 0002 — in-process durable memory worker (Step 4).
 *
 * Single worker, concurrency = 1. Claims jobs from memory_jobs, runs the
 * external work (LLM / ONNX) OUTSIDE any SQLite transaction, then persists
 * output + completion in one statement. Version-scoped writes (chunks,
 * chapter_versions.summary) are always allowed; ACTIVE-table writes
 * (book_facts, book_notes) are guarded by an is-still-current check right
 * before persist — a superseded version's job ends up `obsolete` and never
 * touches active memory (I3).
 *
 * Step 5: facts/notes payloads are STAGED into result_json (never written
 * directly) and applied only by the atomic activation step once every
 * commit-kind for the version is done (I4). A superseded version's job goes
 * `obsolete` early and its staged output is never applied (I3).
 */

export interface MemoryWorkerOptions {
  /** Poll interval for the background timer. */
  intervalMs?: number;
  /** Start the background timer immediately (default true). Tests typically
   *  pass false and pump the queue with drain(). */
  autoStart?: boolean;
}

export interface MemoryWorker {
  /** Wake the loop now (called after enqueue). */
  kick(): void;
  /** Process claimable jobs until the queue is quiet. Optionally restrict to
   *  specific kinds — tests use `{ kinds: ["index"] }` to make indexing
   *  synchronous without awaiting LLM-backed jobs. */
  drain(opts?: { kinds?: ReadonlyArray<MemoryJobKind> }): Promise<void>;
  stop(): void;
}

interface VersionCtx {
  versionId: number;
  chapterId: number;
  bookId: number;
  chapterOrder: number;
  contentText: string;
  wordCount: number;
  chapterTitle: string;
}

export function startMemoryWorker(
  sqlite: DatabaseType,
  hasVec: boolean,
  opts?: MemoryWorkerOptions,
): MemoryWorker {
  const intervalMs = opts?.intervalMs ?? 2_000;
  let stopped = false;
  let pumping: Promise<void> | null = null;

  const recovered = recoverStaleMemoryJobs(sqlite);
  if (recovered > 0) {
    console.warn(`[memory-worker] recovered ${recovered} stale running job(s) → retry`);
  }

  function isCurrent(job: MemoryJobRow): boolean {
    const row = sqlite
      .prepare("SELECT current_version_id FROM chapters WHERE id = ?")
      .get(job.chapter_id) as { current_version_id: number | null } | undefined;
    return row?.current_version_id === job.chapter_version_id;
  }

  function loadCtx(job: MemoryJobRow): VersionCtx | null {
    const v = sqlite
      .prepare(
        `SELECT v.id, v.chapter_id, v.content_text, v.word_count, v.summary,
                c.book_id, c.order_index, c.title
         FROM chapter_versions v
         JOIN chapters c ON c.id = v.chapter_id
         WHERE v.id = ?`,
      )
      .get(job.chapter_version_id) as
      | {
          id: number;
          chapter_id: number;
          content_text: string;
          word_count: number;
          summary: string | null;
          book_id: number;
          order_index: number;
          title: string;
        }
      | undefined;
    if (!v) return null;
    return {
      versionId: v.id,
      chapterId: v.chapter_id,
      bookId: v.book_id,
      chapterOrder: v.order_index,
      contentText: v.content_text,
      wordCount: v.word_count,
      chapterTitle: v.title,
    };
  }

  async function handleIndex(job: MemoryJobRow): Promise<void> {
    // Cheap pre-check: indexing a superseded version is harmless (chunks are
    // version-scoped) but wasted work — skip it up front.
    if (!isCurrent(job)) return markMemoryJobObsolete(sqlite, job.id);
    const ctx = loadCtx(job);
    if (!ctx) return completeMemoryJob(sqlite, job.id, { skipped: "missing" });
    // indexChapterVersion degrades to FTS-only when the embedding model is
    // unavailable — that is a SUCCESS per ADR (test scenario 9).
    const { chunkCount } = await indexChapterVersion(sqlite, hasVec, {
      bookId: ctx.bookId,
      chapterId: ctx.chapterId,
      chapterOrder: ctx.chapterOrder,
      versionId: ctx.versionId,
      language: "ru",
      text: ctx.contentText,
    });
    completeMemoryJob(sqlite, job.id, { chunkCount });
  }

  async function handleSummary(job: MemoryJobRow): Promise<void> {
    const ctx = loadCtx(job);
    if (!ctx) return completeMemoryJob(sqlite, job.id, { skipped: "missing" });
    const existing = sqlite
      .prepare("SELECT summary FROM chapter_versions WHERE id = ?")
      .get(ctx.versionId) as { summary: string | null } | undefined;
    if (existing?.summary && existing.summary.length > 0) {
      completeMemoryJob(sqlite, job.id, { skipped: "present" });
      return enqueueRollup(job);
    }
    if (ctx.wordCount < 80) {
      return completeMemoryJob(sqlite, job.id, { skipped: "short" });
    }
    const bk = sqlite
      .prepare("SELECT critic_model FROM books WHERE id = ?")
      .get(ctx.bookId) as { critic_model: "sonnet" | "opus" } | undefined;

    const result = await summarizeChapter({
      chapterTitle: ctx.chapterTitle,
      chapterText: ctx.contentText,
      model: bk?.critic_model ?? "sonnet",
    });
    if (result.summary) {
      // chapter_versions.summary is version-scoped — safe to write even if
      // the version was superseded mid-call (inert until activation).
      sqlite
        .prepare("UPDATE chapter_versions SET summary = ? WHERE id = ?")
        .run(result.summary, ctx.versionId);
      if (result.modelId !== "noop") {
        logUsage(sqlite, {
          route: "summary.chapter",
          model: result.modelId,
          usage: {
            inputTokens: result.tokens.input,
            outputTokens: result.tokens.output,
            cacheCreationInputTokens: result.tokens.cacheCreation,
            cacheReadInputTokens: result.tokens.cacheRead,
          },
          bookId: ctx.bookId,
          chapterId: ctx.chapterId,
          versionId: ctx.versionId,
        });
      }
    }
    completeMemoryJob(sqlite, job.id, { summarized: Boolean(result.summary) });
    enqueueRollup(job);
  }

  function enqueueRollup(job: MemoryJobRow): void {
    // Meta-summary rollup depends on per-chapter summaries; chained after the
    // summary job instead of enqueued at commit. Idempotent by UNIQUE.
    enqueueMemoryJobs(sqlite, {
      bookId: job.book_id,
      chapterId: job.chapter_id,
      chapterVersionId: job.chapter_version_id,
      kinds: ["rollup"],
    });
  }

  async function handleFacts(job: MemoryJobRow): Promise<void> {
    // Pre-check saves the LLM call; the activation tx re-checks anyway.
    if (!isCurrent(job)) return markMemoryJobObsolete(sqlite, job.id);
    const p = await extractFactsPayload(sqlite, job.chapter_version_id);
    if (p.skipped) {
      return completeMemoryJob(sqlite, job.id, { factCount: 0, skipped: p.skipped });
    }
    completeMemoryJob(sqlite, job.id, {
      factCount: p.facts.length,
      staged: { facts: p.facts },
    });
  }

  async function handleNotes(job: MemoryJobRow): Promise<void> {
    if (!isCurrent(job)) return markMemoryJobObsolete(sqlite, job.id);
    const p = await extractNotesPayload(sqlite, job.chapter_version_id);
    if (p.skipped) {
      return completeMemoryJob(sqlite, job.id, {
        newCount: 0,
        resolvedCount: 0,
        skipped: p.skipped,
      });
    }
    // Embeddings are computed HERE (outside any transaction) so the atomic
    // activation step can materialize notes fully synchronously.
    const embeddings = await embedExtractedNotes(p.extraction);
    completeMemoryJob(sqlite, job.id, {
      newCount: p.extraction.newNotes.length,
      resolvedCount: p.extraction.resolvedNoteIds.length,
      staged: {
        extraction: p.extraction,
        embeddings: embeddings.map((b) => (b ? b.toString("base64") : null)),
      },
    });
  }

  async function handleRollup(job: MemoryJobRow): Promise<void> {
    const r = await runMetaSummary(sqlite, job.book_id);
    completeMemoryJob(sqlite, job.id, r);
  }

  async function handleJob(job: MemoryJobRow): Promise<void> {
    try {
      switch (job.kind) {
        case "index":
          await handleIndex(job);
          break;
        case "summary":
          await handleSummary(job);
          break;
        case "facts":
          await handleFacts(job);
          break;
        case "notes":
          await handleNotes(job);
          break;
        case "rollup":
          await handleRollup(job);
          break;
      }
    } catch (e) {
      const status = failMemoryJob(sqlite, job, e, {
        retryable: isRetryableMemoryError(e),
      });
      console.warn(
        `[memory-worker] job#${job.id} ${job.kind} v${job.chapter_version_id} → ${status}:`,
        e instanceof Error ? e.message : e,
      );
      return;
    }
    // Every completed commit-kind may be the last one — try to activate.
    // Failure here must not fail the job itself (it already completed).
    if (job.kind !== "rollup") {
      try {
        tryActivateMemoryVersion(sqlite, job.chapter_id, job.chapter_version_id);
      } catch (e) {
        console.warn(
          `[memory-worker] activation failed for v${job.chapter_version_id}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  }

  async function pump(kinds?: ReadonlyArray<MemoryJobKind>): Promise<void> {
    while (!stopped) {
      const job = claimNextMemoryJob(sqlite, kinds ? { kinds } : undefined);
      if (!job) return;
      await handleJob(job);
    }
  }

  /** Serialize pumps — concurrency=1 even when kick() lands mid-drain. */
  function schedulePump(kinds?: ReadonlyArray<MemoryJobKind>): Promise<void> {
    const next = (pumping ?? Promise.resolve()).then(() => pump(kinds));
    // Keep the chain alive even if a pump rejects unexpectedly.
    pumping = next.catch((e) =>
      console.warn("[memory-worker] pump failed:", e instanceof Error ? e.message : e),
    );
    return next;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  if (opts?.autoStart !== false) {
    timer = setInterval(() => void schedulePump(), intervalMs);
    // Never keep the process alive just for polling.
    timer.unref?.();
  }

  return {
    kick: () => void schedulePump(),
    drain: (o) => schedulePump(o?.kinds),
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

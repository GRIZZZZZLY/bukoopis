import type { Database as DatabaseType } from "better-sqlite3";
import { metaSummarize } from "@book-forge/agents";
import { logUsage } from "./usageLogger.js";

/**
 * Phase 2 — rolling-window previous-chapters context.
 *
 * Replaces the old linear `loadPreviousChaptersSummary` (every prior chapter
 * verbatim → unbounded prompt growth). Now: the last `WINDOW` chapters keep
 * their full per-chapter summary; everything older collapses into ONE
 * `book_meta_summaries` row (regenerated fire-and-forget on a threshold).
 */

export const ROLLING_WINDOW = 3;

interface ChapterRow {
  title: string;
  order_index: number;
  content_text: string | null;
  summary: string | null;
}
interface MetaRow {
  covers_from_order: number;
  covers_to_order: number;
  summary_text: string;
}

function chapterSnippet(r: ChapterRow): string {
  const snippet =
    r.summary && r.summary.length > 0
      ? r.summary
      : r.content_text
        ? r.content_text.slice(0, 1200)
        : "(пусто)";
  return `Глава #${r.order_index} «${r.title}»:\n${snippet}`;
}

/**
 * Body for the "previous chapters" prompt section. Caller wraps it (Writer:
 * "Краткое содержание предыдущих глав:\n...", Plot: "Что было…:\n...").
 * Returns null when there are no prior chapters.
 */
export function loadRollingChapterContext(
  sqlite: DatabaseType,
  bookId: number,
  beforeOrderIndex: number,
  window: number = ROLLING_WINDOW,
): string | null {
  const rows = sqlite
    .prepare(
      `SELECT c.title, c.order_index, v.content_text, v.summary
       FROM chapters c
       LEFT JOIN chapter_versions v ON v.id = c.current_version_id
       WHERE c.book_id = ? AND c.order_index < ?
       ORDER BY c.order_index ASC`,
    )
    .all(bookId, beforeOrderIndex) as ChapterRow[];
  if (rows.length === 0) return null;

  const recent = rows.slice(-window);
  const older = rows.slice(0, Math.max(0, rows.length - window));

  const parts: string[] = [];

  if (older.length > 0) {
    const meta = sqlite
      .prepare(
        `SELECT covers_from_order, covers_to_order, summary_text
         FROM book_meta_summaries WHERE book_id = ?`,
      )
      .get(bookId) as MetaRow | undefined;
    const olderMax = older[older.length - 1]!.order_index;

    // Сводка, покрывающая главы ПОЗЖЕ границы, пересказывает ещё не
    // написанное с точки зрения этой сцены. Раньше она бралась без проверки,
    // и при генерации главы 10 в промпт уходил пересказ вплоть до двадцатой
    // (AC-10). Такую сводку не используем вовсе — ранние главы отдаются
    // поглавно, это дороже по месту, но не лжёт.
    const usableMeta =
      meta && meta.covers_to_order < beforeOrderIndex ? meta : undefined;

    if (usableMeta && usableMeta.covers_to_order >= olderMax) {
      // Meta fully covers the older run.
      parts.push(
        `### Сводка ранних глав (#${usableMeta.covers_from_order}–#${usableMeta.covers_to_order})\n${usableMeta.summary_text}`,
      );
    } else if (usableMeta) {
      // Meta covers a prefix; remaining older chapters fall back verbatim.
      parts.push(
        `### Сводка ранних глав (#${usableMeta.covers_from_order}–#${usableMeta.covers_to_order})\n${usableMeta.summary_text}`,
      );
      const uncovered = older.filter(
        (r) => r.order_index > usableMeta.covers_to_order,
      );
      for (const r of uncovered) parts.push(chapterSnippet(r));
    } else {
      // No meta yet — graceful fallback to per-chapter (nothing lost).
      for (const r of older) parts.push(chapterSnippet(r));
    }
  }

  for (const r of recent) parts.push(chapterSnippet(r));

  return parts.join("\n\n---\n\n");
}

/** Default tail budget: ~1000 words of Russian prose. */
export const PREV_TAIL_MAX_CHARS = 6000;

/**
 * Verbatim tail of the immediately preceding chapter. Summaries carry plot but
 * drop intonation, rhythm and unfinished physical action, so a chapter opening
 * generated from a summary alone reads as a hard cut. Trimmed to start right
 * after a paragraph break so the Writer never sees half a sentence.
 * Returns null when there is no prior chapter or it has no text yet.
 */
export function loadPreviousChapterTail(
  sqlite: DatabaseType,
  bookId: number,
  beforeOrderIndex: number,
  maxChars: number = PREV_TAIL_MAX_CHARS,
): string | null {
  const row = sqlite
    .prepare(
      `SELECT v.content_text AS content_text
       FROM chapters c
       JOIN chapter_versions v ON v.id = c.current_version_id
       WHERE c.book_id = ? AND c.order_index < ?
       ORDER BY c.order_index DESC
       LIMIT 1`,
    )
    .get(bookId, beforeOrderIndex) as { content_text: string | null } | undefined;

  const text = row?.content_text?.trim();
  if (!text) return null;
  if (text.length <= maxChars) return text;

  const slice = text.slice(-maxChars);
  const para = slice.indexOf("\n\n");
  if (para !== -1) return slice.slice(para + 2).trim();
  const space = slice.indexOf(" ");
  return space !== -1 ? slice.slice(space + 1).trim() : slice.trim();
}

export interface MetaSummaryResult {
  updated: boolean;
  coversTo?: number;
  skipped?: "window" | "covered" | "missing" | "empty";
}

/** Отпечаток источников сводки: какие главы и КАКИЕ ИХ ВЕРСИИ в неё вошли.
 *  Сравнение по диапазону не ловит правку внутри него — именно так сводка
 *  и оставалась описывать старый текст главы 3 навсегда. */
function metaSourceFingerprint(
  rows: Array<{ order_index: number; version_id: number }>,
): string {
  return rows
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((r) => `${r.order_index}:${r.version_id}`)
    .join("|");
}

/**
 * Throwing core: collapse all summarized chapters older than the rolling
 * window into one meta-summary row. Idempotent — skips when the existing meta
 * already covers the target range. LLM failures PROPAGATE — the memory worker
 * classifies and retries them (ADR 0002).
 */
export async function runMetaSummary(
  sqlite: DatabaseType,
  bookId: number,
  window: number = ROLLING_WINDOW,
): Promise<MetaSummaryResult> {
  {
    const summarized = sqlite
      .prepare(
        `SELECT c.order_index AS order_index, c.title AS title, v.summary AS summary, v.id AS version_id
         FROM chapters c
         JOIN chapter_versions v ON v.id = c.current_version_id
         WHERE c.book_id = ?
           AND v.summary IS NOT NULL
           AND length(v.summary) > 0
         ORDER BY c.order_index ASC`,
      )
      .all(bookId) as Array<{
      order_index: number;
      title: string;
      summary: string;
      version_id: number;
    }>;

    if (summarized.length <= window) {
      return { updated: false, skipped: "window" }; // nothing older than the window
    }

    const older = summarized.slice(0, summarized.length - window);
    const coversFrom = older[0]!.order_index;
    const coversTo = older[older.length - 1]!.order_index;

    const fingerprint = metaSourceFingerprint(older);
    const existing = sqlite
      .prepare(
        `SELECT covers_to_order, source_fingerprint FROM book_meta_summaries WHERE book_id = ?`,
      )
      .get(bookId) as
      | { covers_to_order: number; source_fingerprint: string | null }
      | undefined;
    if (
      existing &&
      existing.covers_to_order >= coversTo &&
      existing.source_fingerprint === fingerprint
    ) {
      return { updated: false, coversTo, skipped: "covered" }; // up to date
    }

    const bk = sqlite
      .prepare("SELECT title, critic_model FROM books WHERE id = ?")
      .get(bookId) as
      | { title: string; critic_model: "sonnet" | "opus" }
      | undefined;
    if (!bk) return { updated: false, skipped: "missing" };

    const result = await metaSummarize({
      bookTitle: bk.title,
      chapterSummaries: older.map((o) => ({
        order: o.order_index,
        title: o.title,
        summary: o.summary,
      })),
      model: bk.critic_model ?? "sonnet",
    });
    if (!result.summary) return { updated: false, skipped: "empty" };

    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO book_meta_summaries
           (book_id, covers_from_order, covers_to_order, summary_text, model_id, source_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           covers_from_order = excluded.covers_from_order,
           covers_to_order   = excluded.covers_to_order,
           summary_text      = excluded.summary_text,
           model_id          = excluded.model_id,
           source_fingerprint = excluded.source_fingerprint,
           created_at        = excluded.created_at`,
      )
      .run(bookId, coversFrom, coversTo, result.summary, result.modelId, fingerprint, now);

    if (result.modelId !== "noop") {
      logUsage(sqlite, {
        route: "summary.meta",
        model: result.modelId,
        usage: {
          inputTokens: result.tokens.input,
          outputTokens: result.tokens.output,
          cacheCreationInputTokens: result.tokens.cacheCreation,
          cacheReadInputTokens: result.tokens.cacheRead,
        },
        bookId,
      });
    }
    return { updated: true, coversTo };
  }
}

/**
 * Fire-and-forget wrapper around `runMetaSummary` — never throws into the
 * caller's save flow. Legacy path; the durable memory worker calls the core
 * directly (ADR 0002).
 */
export async function triggerMetaSummary(
  sqlite: DatabaseType,
  bookId: number,
  window: number = ROLLING_WINDOW,
): Promise<void> {
  try {
    await runMetaSummary(sqlite, bookId, window);
  } catch (e) {
    console.warn(
      "[meta-summary] generation failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

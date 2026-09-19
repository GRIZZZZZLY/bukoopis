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

/** Сколько рубежей просматривать в поисках пригодного. Сводок у книги по
 *  одной на пройденный рубеж, и после правки ранней главы негодными
 *  становятся все с ней внутри — но пригодный может лежать и глубже. */
const MAX_SUMMARY_CANDIDATES = 20;

/** Сколько устаревших рубежей пересобирать за один прогон. Каждый — вызов
 *  модели, и правка первой главы длинной книги иначе выливалась бы в
 *  десятки вызовов разом. Остальные догонят следующим прогоном. */
const MAX_STALE_REBUILDS_PER_RUN = 4;

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
  source_fingerprint: string | null;
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
    // Сводка, покрывающая главы ПОЗЖЕ границы, пересказывает ещё не
    // написанное с точки зрения этой сцены (AC-10), поэтому границу ставит
    // сам запрос. Сводок у книги несколько — по одной на пройденный рубеж, —
    // и берётся самая полная из подходящих.
    // Берётся самая поздняя ПРИГОДНАЯ сводка, а не просто самая поздняя
    // (В6 ревью 2026-09-19). Отпечаток сверяется на чтении: главу внутри
    // диапазона могли переписать после того, как сводка составлена, и тогда
    // она описывает текст, которого больше нет. Раньше кандидат был один
    // (`LIMIT 1`), и одна негодная строка отправляла всю книгу на поглавные
    // пересказы, хотя рядом лежал рубеж пораньше, вполне живой.
    const candidates = sqlite
      .prepare(
        `SELECT covers_from_order, covers_to_order, summary_text, source_fingerprint
         FROM book_meta_summaries
         WHERE book_id = ? AND covers_to_order < ?
         ORDER BY covers_to_order DESC LIMIT ?`,
      )
      .all(bookId, beforeOrderIndex, MAX_SUMMARY_CANDIDATES) as MetaRow[];
    const olderMax = older[older.length - 1]!.order_index;

    const usableMeta = candidates.find(
      (m) =>
        m.source_fingerprint === null ||
        m.source_fingerprint ===
          currentSourceFingerprint(sqlite, bookId, m.covers_to_order),
    );

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
  return loadPreviousChapterTailWithOrder(sqlite, bookId, beforeOrderIndex, maxChars)?.text ?? null;
}

/** Тот же хвост плюс `order_index` главы, откуда он взят: поиску по тексту
 *  нужно знать, чья проза уже подана дословно, чтобы не повторять её
 *  фрагментами (AC-12). Всё остальное он вправе искать. */
export function loadPreviousChapterTailWithOrder(
  sqlite: DatabaseType,
  bookId: number,
  beforeOrderIndex: number,
  maxChars: number = PREV_TAIL_MAX_CHARS,
): { text: string; chapterOrder: number } | null {
  const row = sqlite
    .prepare(
      `SELECT v.content_text AS content_text, c.order_index AS order_index
       FROM chapters c
       JOIN chapter_versions v ON v.id = c.current_version_id
       WHERE c.book_id = ? AND c.order_index < ?
       ORDER BY c.order_index DESC
       LIMIT 1`,
    )
    .get(bookId, beforeOrderIndex) as
    | { content_text: string | null; order_index: number }
    | undefined;

  const text = row?.content_text?.trim();
  if (!row || !text) return null;
  if (text.length <= maxChars) return { text, chapterOrder: row.order_index };

  const slice = text.slice(-maxChars);
  const para = slice.indexOf("\n\n");
  if (para !== -1) return { text: slice.slice(para + 2).trim(), chapterOrder: row.order_index };
  const space = slice.indexOf(" ");
  return {
    text: space !== -1 ? slice.slice(space + 1).trim() : slice.trim(),
    chapterOrder: row.order_index,
  };
}

export interface MetaSummaryResult {
  updated: boolean;
  coversTo?: number;
  skipped?: "window" | "covered" | "missing" | "empty";
}

/** Отпечаток источников сводки: какие главы, КАКИЕ ИХ ВЕРСИИ и под какими
 *  названиями в неё вошли. Сравнение по диапазону не ловит правку внутри
 *  него — именно так сводка и оставалась описывать старый текст главы 3
 *  навсегда. Название входит в отпечаток, потому что входит и в промпт
 *  сводки: переименованная глава упоминается в ней прежним именем.
 *  `JSON.stringify` — не украшение: название вправе содержать и `:`, и `|`. */
function metaSourceFingerprint(
  rows: Array<{ order_index: number; version_id: number; title: string }>,
): string {
  return rows
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((r) => `${r.order_index}:${r.version_id}:${JSON.stringify(r.title)}`)
    .join("|");
}

/** Главы, из которых сводка на этот рубеж собиралась бы СЕЙЧАС. Тот же набор
 *  и тот же порядок, что у `runMetaSummary`, иначе сравнение отпечатков
 *  всегда давало бы «устарело». */
function summarizedChaptersUpTo(
  sqlite: DatabaseType,
  bookId: number,
  coversToOrder: number,
): Array<{
  order_index: number;
  title: string;
  summary: string;
  version_id: number;
}> {
  return sqlite
    .prepare(
      `SELECT c.order_index AS order_index, c.title AS title, v.summary AS summary, v.id AS version_id
       FROM chapters c
       JOIN chapter_versions v ON v.id = c.current_version_id
       WHERE c.book_id = ?
         AND c.order_index <= ?
         AND v.summary IS NOT NULL
         AND length(v.summary) > 0
       ORDER BY c.order_index ASC`,
    )
    .all(bookId, coversToOrder) as Array<{
    order_index: number;
    title: string;
    summary: string;
    version_id: number;
  }>;
}

function currentSourceFingerprint(
  sqlite: DatabaseType,
  bookId: number,
  coversToOrder: number,
): string {
  return metaSourceFingerprint(summarizedChaptersUpTo(sqlite, bookId, coversToOrder));
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
  // Тот же набор, что сверяется на чтении: разойдись они — отпечаток не
  // совпал бы никогда, и сводка была бы бесполезна с первого дня.
  const summarized = summarizedChaptersUpTo(
    sqlite,
    bookId,
    Number.MAX_SAFE_INTEGER,
  );

  if (summarized.length <= window) {
    return { updated: false, skipped: "window" }; // nothing older than the window
  }

  const bk = sqlite
    .prepare("SELECT title, critic_model FROM books WHERE id = ?")
    .get(bookId) as { title: string; critic_model: "sonnet" | "opus" } | undefined;
  if (!bk) return { updated: false, skipped: "missing" };

  const older = summarized.slice(0, summarized.length - window);
  const coversTo = older[older.length - 1]!.order_index;
  const newest = await rebuildThreshold(sqlite, bookId, coversTo, bk);

  // Рубежи ПОЗАДИ нового тоже могли устареть: правка ранней главы меняет
  // отпечаток каждого диапазона, куда она входит, а пересобирался только
  // последний (В6 ревью 2026-09-19). Читатель после этого не находил ни
  // одной пригодной сводки и на всей книге переходил на поглавные пересказы.
  const stale = sqlite
    .prepare(
      `SELECT covers_to_order AS t, source_fingerprint AS fp
       FROM book_meta_summaries
       WHERE book_id = ? AND covers_to_order < ?
       ORDER BY covers_to_order DESC`,
    )
    .all(bookId, coversTo) as Array<{ t: number; fp: string | null }>;
  let rebuilt = 0;
  for (const row of stale) {
    if (rebuilt >= MAX_STALE_REBUILDS_PER_RUN) break;
    if (row.fp === null) continue; // старая строка без отпечатка — оставляем
    if (row.fp === currentSourceFingerprint(sqlite, bookId, row.t)) continue;
    const outcome = await rebuildThreshold(sqlite, bookId, row.t, bk);
    if (outcome === "updated") rebuilt += 1;
  }

  return newest === "updated" || rebuilt > 0
    ? { updated: true, coversTo }
    : { updated: false, coversTo, skipped: newest === "covered" ? "covered" : "empty" };
}

type ThresholdOutcome = "updated" | "covered" | "empty";

/** Собирает сводку одного рубежа: главы с пересказами до `coversTo`
 *  включительно. Ничего не делает, если отпечаток источников совпал. */
async function rebuildThreshold(
  sqlite: DatabaseType,
  bookId: number,
  coversTo: number,
  bk: { title: string; critic_model: "sonnet" | "opus" },
): Promise<ThresholdOutcome> {
  const rows = summarizedChaptersUpTo(sqlite, bookId, coversTo);
  if (rows.length === 0) return "empty";
  const coversFrom = rows[0]!.order_index;
  const fingerprint = metaSourceFingerprint(rows);

  // Ищется строка ровно этого рубежа: сводки живут по одной на covers_to,
  // и «есть сводка подальше» не означает, что эта не нужна.
  const existing = sqlite
    .prepare(
      `SELECT source_fingerprint FROM book_meta_summaries
       WHERE book_id = ? AND covers_to_order = ?`,
    )
    .get(bookId, coversTo) as { source_fingerprint: string | null } | undefined;
  if (existing && existing.source_fingerprint === fingerprint) return "covered";

  const result = await metaSummarize({
    bookTitle: bk.title,
    chapterSummaries: rows.map((o) => ({
      order: o.order_index,
      title: o.title,
      summary: o.summary,
    })),
    model: bk.critic_model ?? "sonnet",
  });
  if (!result.summary) return "empty";

  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO book_meta_summaries
         (book_id, covers_from_order, covers_to_order, summary_text, model_id, source_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(book_id, covers_to_order) DO UPDATE SET
         covers_from_order = excluded.covers_from_order,
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
  return "updated";
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

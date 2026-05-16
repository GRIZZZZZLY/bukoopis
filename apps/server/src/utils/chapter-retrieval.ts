import type { Database as DatabaseType } from "better-sqlite3";
import { hybridSearch } from "@book-forge/retrieval";
import { rerankByRelevance, rerankEnabled } from "./rerank.js";

/**
 * Phase 1 — wire `hybridSearch` into Writer/Plot.
 *
 * Pulls the most relevant chunks from *prior* chapters so the Writer/Plot
 * agents can see concrete earlier prose (not just compressed summaries).
 * Best-effort: any retrieval failure degrades to no context, never throws —
 * generation must not break because search is unavailable.
 */

export interface RetrievedChunk {
  chapterOrder: number | null;
  text: string;
  score: number;
}

export interface RetrievedContext {
  chunks: RetrievedChunk[];
  /** Ready-to-inject Russian prompt section, or null when nothing relevant. */
  promptBlock: string | null;
}

export interface GatherRetrievedChunksOptions {
  bookId: number;
  /** Free text to search by (e.g. concatenated beat goal/conflict). */
  queryText: string;
  /** order_index of the chapter being generated; this + later excluded. */
  currentChapterOrder: number;
  hasVec: boolean;
  /** Final chunk count after per-chapter dedupe. Default 5. */
  topK?: number;
  /**
   * Raw candidate count fetched from hybridSearch before dedupe. Larger pool
   * = better dedupe + headroom for the Phase 5 reranker. Default topK * 4.
   */
  candidateK?: number;
}

export async function gatherRetrievedChunks(
  sqlite: DatabaseType,
  opts: GatherRetrievedChunksOptions,
): Promise<RetrievedContext> {
  const topK = opts.topK ?? 5;
  const query = opts.queryText.trim();
  if (!query) return { chunks: [], promptBlock: null };

  let hits;
  try {
    hits = await hybridSearch(sqlite, {
      bookId: opts.bookId,
      query,
      // hybridSearch filter is `chapter_order <= beforeChapterOrder`.
      // Exclude the current chapter (order N) and any later, keep < N.
      beforeChapterOrder: opts.currentChapterOrder - 1,
      topK: opts.candidateK ?? topK * 4,
      hasVec: opts.hasVec,
    });
  } catch (e) {
    console.warn(
      "[chapter-retrieval] hybridSearch failed:",
      e instanceof Error ? e.message : e,
    );
    return { chunks: [], promptBlock: null };
  }

  // Dedupe by chapter — hits are already RRF-ranked, keep the best chunk per
  // chapter so the block spreads across chapters instead of one dominating.
  // When the reranker is enabled we keep a larger pool, then narrow to topK.
  const poolCap = rerankEnabled() ? (opts.candidateK ?? topK * 4) : topK;
  const seen = new Set<number>();
  const pool: RetrievedChunk[] = [];
  for (const h of hits) {
    const key = h.chapterId ?? -1;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push({
      chapterOrder: h.chapterOrder,
      text: h.text,
      score: h.score,
    });
    if (pool.length >= poolCap) break;
  }

  if (pool.length === 0) return { chunks: [], promptBlock: null };

  // Off by default → exact passthrough (pool already capped at topK).
  const picked = await rerankByRelevance(
    pool,
    query,
    (c) => c.text,
    topK,
  );

  const blocks = picked
    .map((c) => {
      const head =
        c.chapterOrder !== null ? `Глава #${c.chapterOrder}` : "Фрагмент";
      return `### ${head}\n${c.text.trim()}`;
    })
    .join("\n\n");

  return {
    chunks: picked,
    promptBlock: `## Релевантные фрагменты предыдущих глав\n${blocks}`,
  };
}

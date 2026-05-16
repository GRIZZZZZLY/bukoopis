import { rerankCandidates } from "@book-forge/agents";

/**
 * Phase 5 — relevance reranker (LLM-judge).
 *
 * Off by default — enable with `RETRIEVAL_RERANK=1` once benchmarked on a
 * real book. When off, `rerankByRelevance` is an exact passthrough
 * (`items.slice(0, topK)`) so no behavior changes and no LLM call is made.
 */

const SCORE_THRESHOLD = 0.15;

export function rerankEnabled(): boolean {
  return process.env.RETRIEVAL_RERANK === "1";
}

/**
 * Re-score `items` against `query` with the LLM judge, drop low-relevance
 * ones, return the top `topK`. Best-effort: on disable / empty query / any
 * failure it falls back to `items.slice(0, topK)`.
 */
export async function rerankByRelevance<T>(
  items: T[],
  query: string,
  getText: (t: T) => string,
  topK: number,
): Promise<T[]> {
  if (!rerankEnabled() || items.length <= 1 || items.length <= topK) {
    return items.slice(0, topK);
  }
  const q = query.trim();
  if (!q) return items.slice(0, topK);

  try {
    const candidates = items.map((it, i) => ({ id: i, text: getText(it) }));
    const { ranked } = await rerankCandidates({ query: q, candidates });
    const scoreById = new Map(ranked.map((r) => [r.id, r.score]));
    const ordered = items
      .map((it, i) => ({ it, s: scoreById.get(i) ?? 0 }))
      .filter((x) => x.s >= SCORE_THRESHOLD)
      .sort((a, b) => b.s - a.s)
      .slice(0, topK)
      .map((x) => x.it);
    // Never return empty just because the judge was harsh.
    return ordered.length > 0 ? ordered : items.slice(0, topK);
  } catch (e) {
    console.warn(
      "[rerank] failed, passthrough:",
      e instanceof Error ? e.message : e,
    );
    return items.slice(0, topK);
  }
}

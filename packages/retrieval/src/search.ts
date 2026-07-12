import type { Database as DatabaseType } from "better-sqlite3";
import { getEmbeddingProvider } from "./embeddings.js";

export interface SearchHit {
  chunkId: number;
  bookId: number;
  chapterId: number | null;
  chapterOrder: number | null;
  text: string;
  score: number;
  vecRank: number | null;
  ftsRank: number | null;
}

export interface SearchOptions {
  bookId: number;
  query: string;
  beforeChapterOrder?: number; // structural spoiler filter
  topK?: number;
  hasVec: boolean;
}

interface VecRow {
  id: number;
  distance: number;
}
interface FtsRow {
  id: number;
  rank: number;
}
interface ChunkRow {
  id: number;
  book_id: number;
  chapter_id: number | null;
  chapter_order: number | null;
  text: string;
}

function floatToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

// Reciprocal Rank Fusion: combine two ranked lists. k=60 is the canonical default.
function rrf(rankings: Array<Map<number, number>>, k = 60): Map<number, number> {
  const fused = new Map<number, number>();
  for (const ranking of rankings) {
    for (const [id, rank] of ranking) {
      const score = 1 / (k + rank);
      fused.set(id, (fused.get(id) ?? 0) + score);
    }
  }
  return fused;
}

export async function hybridSearch(
  sqlite: DatabaseType,
  opts: SearchOptions,
): Promise<SearchHit[]> {
  const topK = opts.topK ?? 10;
  const candidateK = topK * 4;

  // ── Vector branch ──
  let vecRanking = new Map<number, number>();
  if (opts.hasVec) {
    try {
    const provider = getEmbeddingProvider();
    const qVec = await provider.embed(opts.query);
    const qBlob = floatToBlob(qVec);

    // sqlite-vec: query first against chunk_vec, then filter via JOIN on chunks.
    // ADR 0002 (I2): chapter chunks are filtered by memory_version_id — the
    // last FULLY activated version — not current_version_id. While a newer
    // commit is still being processed, retrieval keeps seeing the previous
    // activated version instead of the chapter vanishing.
    const rows = sqlite
      .prepare(
        `SELECT v.rowid AS id, v.distance AS distance
         FROM chunk_vec v
         INNER JOIN chunks c ON c.id = v.rowid
         LEFT JOIN chapters ch ON ch.id = c.chapter_id
         WHERE v.embedding MATCH ?
           AND v.k = ?
           AND v.book_id = ?
           AND (
             c.source_type != 'chapter_version'
             OR ch.memory_version_id = c.source_id
           )
           ${
             opts.beforeChapterOrder !== undefined
               ? "AND (c.chapter_order IS NULL OR c.chapter_order <= ?)"
               : ""
           }
         ORDER BY v.distance ASC`,
      )
      .all(
        qBlob,
        candidateK,
        // BigInt: sqlite-vec metadata INTEGER filter rejects a plain JS number.
        BigInt(opts.bookId),
        ...(opts.beforeChapterOrder !== undefined
          ? [opts.beforeChapterOrder]
          : []),
      ) as VecRow[];
    vecRanking = new Map(rows.map((r, i) => [r.id, i + 1]));
    } catch (e) {
      // Embedding unavailable (model not loaded / offline) or vec backend
      // error: fall back to FTS-only rather than failing the whole search.
      console.warn(
        "[search] vector branch skipped, using FTS only:",
        e instanceof Error ? e.message : e,
      );
      vecRanking = new Map();
    }
  }

  // ── FTS5 branch ──
  // Sanitize query for FTS5: split into tokens, prefix-match each.
  const ftsQuery = opts.query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(" OR ");
  let ftsRanking = new Map<number, number>();
  if (ftsQuery) {
    const rows = sqlite
      .prepare(
        `SELECT f.rowid AS id, f.rank AS rank
         FROM chunk_fts f
         INNER JOIN chunks c ON c.id = f.rowid
         LEFT JOIN chapters ch ON ch.id = c.chapter_id
         WHERE chunk_fts MATCH ?
           AND c.book_id = ?
           AND (
             c.source_type != 'chapter_version'
             OR ch.memory_version_id = c.source_id
           )
           ${
             opts.beforeChapterOrder !== undefined
               ? "AND (c.chapter_order IS NULL OR c.chapter_order <= ?)"
               : ""
           }
         ORDER BY f.rank ASC
         LIMIT ?`,
      )
      .all(
        ftsQuery,
        opts.bookId,
        ...(opts.beforeChapterOrder !== undefined
          ? [opts.beforeChapterOrder]
          : []),
        candidateK,
      ) as FtsRow[];
    ftsRanking = new Map(rows.map((r, i) => [r.id, i + 1]));
  }

  // ── Fuse ──
  const fused = rrf([vecRanking, ftsRanking]);
  const ordered = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);
  if (ordered.length === 0) return [];

  // Hydrate
  const ids = ordered.map((e) => e[0]);
  const placeholders = ids.map(() => "?").join(",");
  const chunkRows = sqlite
    .prepare(
      `SELECT id, book_id, chapter_id, chapter_order, text
       FROM chunks WHERE id IN (${placeholders})`,
    )
    .all(...ids) as ChunkRow[];
  const byId = new Map(chunkRows.map((r) => [r.id, r]));

  return ordered
    .map(([id, score]) => {
      const r = byId.get(id);
      if (!r) return null;
      return {
        chunkId: id,
        bookId: r.book_id,
        chapterId: r.chapter_id,
        chapterOrder: r.chapter_order,
        text: r.text,
        score,
        vecRank: vecRanking.get(id) ?? null,
        ftsRank: ftsRanking.get(id) ?? null,
      } satisfies SearchHit;
    })
    .filter((x): x is SearchHit => x !== null);
}

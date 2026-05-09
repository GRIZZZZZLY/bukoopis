import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import { hybridSearch } from "@book-forge/retrieval";
import { notFound, badRequest } from "../utils/errors.js";

interface ChapterMetaRow {
  id: number;
  order_index: number;
  title: string;
}

export function createRetrievalRoute(
  sqlite: DatabaseType,
  hasVec: boolean,
): Hono {
  const r = new Hono();

  r.get("/books/:id/search", async (c) => {
    const id = Number(c.req.param("id"));
    const q = c.req.query("q") ?? "";
    const beforeChapterRaw = c.req.query("beforeChapter");
    const topKRaw = c.req.query("topK");

    if (!q.trim()) return badRequest(c, "query 'q' is required");
    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");

    const beforeChapterOrder =
      beforeChapterRaw !== undefined && beforeChapterRaw !== ""
        ? Number(beforeChapterRaw)
        : undefined;
    const topK = topKRaw ? Math.max(1, Math.min(50, Number(topKRaw))) : 10;

    const hits = await hybridSearch(sqlite, {
      bookId: id,
      query: q,
      beforeChapterOrder,
      topK,
      hasVec,
    });

    // Hydrate chapter titles for display
    const chapterIds = [
      ...new Set(
        hits.map((h) => h.chapterId).filter((x): x is number => x !== null),
      ),
    ];
    const chapterMeta = new Map<number, ChapterMetaRow>();
    if (chapterIds.length > 0) {
      const placeholders = chapterIds.map(() => "?").join(",");
      const rows = sqlite
        .prepare(
          `SELECT id, order_index, title FROM chapters WHERE id IN (${placeholders})`,
        )
        .all(...chapterIds) as ChapterMetaRow[];
      for (const row of rows) chapterMeta.set(row.id, row);
    }

    return c.json({
      query: q,
      vecEnabled: hasVec,
      hits: hits.map((h) => ({
        ...h,
        chapter:
          h.chapterId !== null
            ? (chapterMeta.get(h.chapterId) ?? null)
            : null,
      })),
    });
  });

  return r;
}

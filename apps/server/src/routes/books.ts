import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createBookInputSchema,
  updateBookInputSchema,
  createChapterInputSchema,
  reorderChaptersInputSchema,
  emptyBookConcept,
  DEFAULT_BOOK_TITLE,
} from "@book-forge/shared";
import { toBook, toChapter, type BookRow, type ChapterRow } from "../db/rows.js";
import { notFound, validationFailed } from "../utils/errors.js";
import { reorderChapters, ChapterReorderError } from "../utils/chapter-reorder.js";
import {
  enqueueMemoryJobs,
  COMMIT_JOB_KINDS,
} from "../utils/memory-queue.js";
import type { MemoryWorker } from "../utils/memory-worker.js";

export function createBooksRoute(
  sqlite: DatabaseType,
  memoryWorker?: Pick<MemoryWorker, "kick">,
): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const rows = sqlite
      .prepare("SELECT * FROM books ORDER BY created_at DESC")
      .all() as BookRow[];
    return c.json(rows.map(toBook));
  });

  r.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createBookInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const now = new Date().toISOString();
    const title = parsed.data.title ?? DEFAULT_BOOK_TITLE;
    // The idea is the one thing the author types; it lives on the concept so the
    // pitch step can read it straight away.
    const concept =
      parsed.data.idea !== undefined
        ? JSON.stringify({ ...emptyBookConcept(), idea: parsed.data.idea })
        : null;
    const info = sqlite
      .prepare(
        `INSERT INTO books (title, language, premise, status, concept, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        title,
        parsed.data.language ?? "ru",
        parsed.data.premise ?? null,
        concept,
        now,
        now,
      );
    const row = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(info.lastInsertRowid) as BookRow;
    return c.json(toBook(row), 201);
  });

  // Полка (Library room): агрегат для геометрии корешков. Книги без глав опущены.
  r.get("/stats", (c) => {
    const rows = sqlite
      .prepare(
        `SELECT c.book_id AS bookId,
                COUNT(*) AS chapters,
                SUM(CASE WHEN c.status = 'final' THEN 1 ELSE 0 END) AS done,
                SUM(COALESCE(v.word_count, 0)) AS words
         FROM chapters c
         LEFT JOIN chapter_versions v ON v.id = c.current_version_id
         GROUP BY c.book_id`,
      )
      .all() as Array<{ bookId: number; chapters: number; done: number; words: number }>;
    const out: Record<string, { chapters: number; done: number; words: number }> = {};
    for (const row of rows) out[String(row.bookId)] = { chapters: row.chapters, done: row.done, words: row.words };
    return c.json(out);
  });

  r.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow | undefined;
    if (!row) return notFound(c, "book");
    return c.json(toBook(row));
  });

  r.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateBookInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow | undefined;
    if (!existing) return notFound(c, "book");
    const now = new Date().toISOString();
    const next = {
      title: parsed.data.title ?? existing.title,
      premise:
        parsed.data.premise === undefined
          ? existing.premise
          : parsed.data.premise,
      status: parsed.data.status ?? existing.status,
      styleProfileId:
        parsed.data.styleProfileId === undefined
          ? existing.style_profile_id
          : parsed.data.styleProfileId,
      writerModel: parsed.data.writerModel ?? existing.writer_model,
      plotModel: parsed.data.plotModel ?? existing.plot_model,
      criticModel: parsed.data.criticModel ?? existing.critic_model,
      writerProvider:
        parsed.data.writerProvider ?? existing.writer_provider,
      writerLocalModel:
        parsed.data.writerLocalModel === undefined
          ? existing.writer_local_model
          : parsed.data.writerLocalModel,
    };
    sqlite
      .prepare(
        `UPDATE books
         SET title=?, premise=?, status=?, style_profile_id=?,
             writer_model=?, plot_model=?, critic_model=?,
             writer_provider=?, writer_local_model=?,
             updated_at=?
         WHERE id=?`,
      )
      .run(
        next.title,
        next.premise,
        next.status,
        next.styleProfileId,
        next.writerModel,
        next.plotModel,
        next.criticModel,
        next.writerProvider,
        next.writerLocalModel,
        now,
        id,
      );
    const row = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow;
    return c.json(toBook(row));
  });

  r.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const info = sqlite.prepare("DELETE FROM books WHERE id = ?").run(id);
    if (info.changes === 0) return notFound(c, "book");
    return c.body(null, 204);
  });

  // Доска сюжета: все заметки книги. Нить = отрезок introduced→resolved.
  r.get("/:id/notes", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");
    const rows = sqlite
      .prepare(
        `SELECT id, book_id, kind, chapter_order_introduced, chapter_order_resolved,
                title, body, tags, created_at
         FROM book_notes WHERE book_id = ?
         ORDER BY chapter_order_introduced ASC, id ASC`,
      )
      .all(id) as Array<{
      id: number;
      book_id: number;
      kind: string;
      chapter_order_introduced: number;
      chapter_order_resolved: number | null;
      title: string;
      body: string;
      tags: string | null;
      created_at: string;
    }>;
    return c.json(
      rows.map((row) => ({
        id: row.id,
        bookId: row.book_id,
        kind: row.kind,
        introduced: row.chapter_order_introduced,
        resolved: row.chapter_order_resolved,
        title: row.title,
        body: row.body,
        tags: parseTags(row.tags),
        createdAt: row.created_at,
      })),
    );
  });

  r.get("/:id/chapters", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");
    const rows = sqlite
      .prepare(
        "SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
      )
      .all(id) as ChapterRow[];
    return c.json(rows.map(toChapter));
  });

  r.post("/:id/chapters", async (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");
    const body = await c.req.json().catch(() => null);
    const parsed = createChapterInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const max = sqlite
      .prepare("SELECT MAX(order_index) as m FROM chapters WHERE book_id = ?")
      .get(id) as { m: number | null };
    const nextOrder = (max.m ?? 0) + 10;
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`,
      )
      .run(id, nextOrder, parsed.data.title, now, now);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(now, id);
    const row = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(info.lastInsertRowid) as ChapterRow;
    return c.json(toChapter(row), 201);
  });

  /** Единственный путь, меняющий порядок глав. Список приходит целиком:
   *  перестановка N запросами по одной главе оставляла бы книгу в
   *  промежуточных раскладках, а перенос производной памяти (К1) считается
   *  от карты «весь старый порядок → весь новый». */
  r.post("/:id/chapters/reorder", async (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");
    const body = await c.req.json().catch(() => null);
    const parsed = reorderChaptersInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    try {
      const result = reorderChapters(sqlite, id, parsed.data.chapterIds);
      const chapters = sqlite
        .prepare(
          "SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
        )
        .all(id) as ChapterRow[];
      return c.json({ ...result, chapters: chapters.map(toChapter) });
    } catch (e) {
      if (e instanceof ChapterReorderError) {
        return c.json(
          { error: "reorder_failed", details: { reason: e.reason, message: e.message } },
          400,
        );
      }
      throw e;
    }
  });

  // ADR 0002 (I6): rebuild derived memory from a chapter onward. Deletes the
  // commit-kind jobs of each affected chapter's CURRENT version and re-inserts
  // fresh pending ones in a single transaction, so the stale marker cannot
  // clear until every re-enqueued chapter re-activates. Facts/notes
  // materialization is idempotent per chapter, so re-running is safe.
  r.post("/:id/memory/rebuild", async (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare(
        "SELECT id, memory_stale_from_chapter_order s FROM books WHERE id = ?",
      )
      .get(id) as { id: number; s: number | null } | undefined;
    if (!book) return notFound(c, "book");
    const body = (await c.req.json().catch(() => ({}))) as {
      fromOrder?: unknown;
    };
    const fromOrder =
      typeof body.fromOrder === "number" && Number.isInteger(body.fromOrder)
        ? body.fromOrder
        : (book.s ?? 1);

    const chapters = sqlite
      .prepare(
        `SELECT id, current_version_id FROM chapters
         WHERE book_id = ? AND order_index >= ? AND current_version_id IS NOT NULL
         ORDER BY order_index ASC`,
      )
      .all(id, fromOrder) as Array<{
      id: number;
      current_version_id: number;
    }>;

    const tx = sqlite.transaction(() => {
      // В5 ревью 2026-09-19: «перестроить» значит собрать заново, а не
      // добавить поверх. Прежде удалялись только задания, а производные
      // строки оставались: `persistExtractedFacts` чистит лишь те тройки
      // (сущность, предикат, режим), которые пришли в НОВОМ ответе, так что
      // факт, который модель в этот раз не извлекла, оставался действующим
      // навсегда. Получалось объединение старой и новой памяти.
      //
      // Удаляется только машинное (`origin = 'extracted'` у фактов и заметок,
      // `llm` у событий). Ручное и студийное — авторские сведения, их
      // перестроение не трогает; `legacy` (до миграции 0014) тоже остаётся:
      // происхождение таких строк неизвестно.
      const deletedFacts = sqlite
        .prepare(
          `DELETE FROM book_facts
           WHERE book_id = ? AND origin = 'extracted' AND valid_from_chapter >= ?`,
        )
        .run(id, fromOrder).changes;
      // Факт, закрытый удалённым сейчас фактом, иначе остался бы закрытым
      // навсегда: ссылка на отменившего ушла в NULL по внешнему ключу, а
      // граница действия — нет.
      sqlite
        .prepare(
          `UPDATE book_facts SET valid_to_chapter = NULL
           WHERE book_id = ? AND superseded_by IS NULL
             AND valid_to_chapter IS NOT NULL AND valid_to_chapter >= ?`,
        )
        .run(id, fromOrder - 1);
      const deletedNotes = sqlite
        .prepare(
          `DELETE FROM book_notes
           WHERE book_id = ? AND origin = 'extracted' AND chapter_order_introduced >= ?`,
        )
        .run(id, fromOrder).changes;
      // Нить, закрытую удалённой заметкой, открываем обратно.
      sqlite
        .prepare(
          `UPDATE book_notes SET chapter_order_resolved = NULL
           WHERE book_id = ? AND chapter_order_resolved >= ?`,
        )
        .run(id, fromOrder);
      const deletedEvents = sqlite
        .prepare(
          `DELETE FROM character_events
           WHERE book_id = ? AND origin = 'llm' AND chapter_id IN
             (SELECT id FROM chapters WHERE book_id = ? AND order_index >= ?)`,
        )
        .run(id, id, fromOrder).changes;
      // Сводки, куда входили перестраиваемые главы, собраны из пересказов,
      // которых сейчас не станет.
      sqlite
        .prepare(
          "DELETE FROM book_meta_summaries WHERE book_id = ? AND covers_to_order >= ?",
        )
        .run(id, fromOrder);

      for (const ch of chapters) {
        sqlite
          .prepare(
            `DELETE FROM memory_jobs
             WHERE chapter_version_id = ? AND kind IN ('index','summary','facts','notes')`,
          )
          .run(ch.current_version_id);
        // Пересказ главы тоже собирается заново: он лежит на версии, и без
        // очистки задание `summary` увидит его на месте и пропустит работу.
        sqlite
          .prepare("UPDATE chapter_versions SET summary = NULL WHERE id = ?")
          .run(ch.current_version_id);
        sqlite
          .prepare("UPDATE chapters SET memory_version_id = NULL WHERE id = ?")
          .run(ch.id);
        enqueueMemoryJobs(sqlite, {
          bookId: id,
          chapterId: ch.id,
          chapterVersionId: ch.current_version_id,
          kinds: COMMIT_JOB_KINDS,
        });
      }
      return { deletedFacts, deletedNotes, deletedEvents };
    });
    const cleared = tx();
    if (chapters.length > 0) memoryWorker?.kick();
    return c.json({ enqueuedChapters: chapters.length, fromOrder, ...cleared });
  });

  return r;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

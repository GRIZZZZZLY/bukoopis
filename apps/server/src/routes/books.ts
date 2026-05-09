import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createBookInputSchema,
  updateBookInputSchema,
  createChapterInputSchema,
} from "@book-forge/shared";
import { toBook, toChapter, type BookRow, type ChapterRow } from "../db/rows.js";
import { notFound, validationFailed } from "../utils/errors.js";

export function createBooksRoute(sqlite: DatabaseType): Hono {
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
    const info = sqlite
      .prepare(
        `INSERT INTO books (title, language, premise, status, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`,
      )
      .run(
        parsed.data.title,
        parsed.data.language ?? "ru",
        parsed.data.premise ?? null,
        now,
        now,
      );
    const row = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(info.lastInsertRowid) as BookRow;
    return c.json(toBook(row), 201);
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

  return r;
}

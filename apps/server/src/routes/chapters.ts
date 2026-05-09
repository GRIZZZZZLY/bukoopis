import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  updateChapterInputSchema,
  createChapterVersionInputSchema,
} from "@book-forge/shared";
import { indexChapterVersion } from "@book-forge/retrieval";
import {
  toChapter,
  toVersion,
  type ChapterRow,
  type ChapterVersionRow,
} from "../db/rows.js";
import { notFound, validationFailed } from "../utils/errors.js";
import { extractText, countWords } from "../utils/prosemirror.js";
import { triggerVersionSummary } from "../utils/summary-trigger.js";

export function createChaptersRoute(
  sqlite: DatabaseType,
  hasVec: boolean,
): Hono {
  const r = new Hono();

  r.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const row = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!row) return notFound(c, "chapter");
    let currentVersion = null;
    if (row.current_version_id !== null) {
      const v = sqlite
        .prepare("SELECT * FROM chapter_versions WHERE id = ?")
        .get(row.current_version_id) as ChapterVersionRow | undefined;
      if (v) currentVersion = toVersion(v);
    }
    return c.json({ ...toChapter(row), currentVersion });
  });

  r.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = updateChapterInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const existing = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!existing) return notFound(c, "chapter");
    const now = new Date().toISOString();
    const next = {
      title: parsed.data.title ?? existing.title,
      status: parsed.data.status ?? existing.status,
      orderIndex: parsed.data.orderIndex ?? existing.order_index,
    };
    sqlite
      .prepare(
        "UPDATE chapters SET title=?, status=?, order_index=?, updated_at=? WHERE id=?",
      )
      .run(next.title, next.status, next.orderIndex, now, id);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(now, existing.book_id);
    const row = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow;
    return c.json(toChapter(row));
  });

  r.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    const existing = sqlite
      .prepare("SELECT book_id FROM chapters WHERE id = ?")
      .get(id) as { book_id: number } | undefined;
    if (!existing) return notFound(c, "chapter");
    sqlite.prepare("DELETE FROM chapters WHERE id = ?").run(id);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), existing.book_id);
    return c.body(null, 204);
  });

  r.get("/:id/versions", (c) => {
    const id = Number(c.req.param("id"));
    const ch = sqlite
      .prepare("SELECT id FROM chapters WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!ch) return notFound(c, "chapter");
    const rows = sqlite
      .prepare(
        "SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY created_at DESC, id DESC",
      )
      .all(id) as ChapterVersionRow[];
    return c.json(rows.map(toVersion));
  });

  r.post("/:id/versions", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = createChapterVersionInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");

    const contentJson = JSON.stringify(parsed.data.contentJson);
    const contentText = extractText(parsed.data.contentJson);
    const wordCount = countWords(contentText);
    const parentVersionId = ch.current_version_id;
    const now = new Date().toISOString();

    const tx = sqlite.transaction(() => {
      const info = sqlite
        .prepare(
          `INSERT INTO chapter_versions
           (chapter_id, parent_version_id, content_json, content_text, word_count, source, created_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
        )
        .run(id, parentVersionId, contentJson, contentText, wordCount, now);
      const versionId = Number(info.lastInsertRowid);
      sqlite
        .prepare(
          "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(versionId, now, id);
      sqlite
        .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
        .run(now, ch.book_id);
      return versionId;
    });
    const versionId = tx();

    const v = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(versionId) as ChapterVersionRow;

    // Index chunks (best-effort; failure must not block save).
    try {
      await indexChapterVersion(sqlite, hasVec, {
        bookId: ch.book_id,
        chapterId: ch.id,
        chapterOrder: ch.order_index,
        versionId,
        language: "ru",
        text: contentText,
      });
    } catch (e) {
      console.warn("[chunks] indexing failed:", e);
    }

    // Generate compact summary in background (used by Writer for prev-chapter context).
    void triggerVersionSummary(sqlite, versionId);

    return c.json(toVersion(v), 201);
  });

  r.post("/:id/restore/:versionId", (c) => {
    const id = Number(c.req.param("id"));
    const versionId = Number(c.req.param("versionId"));
    const v = sqlite
      .prepare(
        "SELECT id FROM chapter_versions WHERE id = ? AND chapter_id = ?",
      )
      .get(versionId, id) as { id: number } | undefined;
    if (!v) return notFound(c, "version");
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(versionId, now, id);
    const row = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow;
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(now, row.book_id);
    return c.json(toChapter(row));
  });

  return r;
}

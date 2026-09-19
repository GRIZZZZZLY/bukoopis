import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  updateChapterInputSchema,
  createChapterVersionInputSchema,
  saveChapterDraftInputSchema,
} from "@book-forge/shared";
import {
  toChapter,
  toVersion,
  type ChapterRow,
  type ChapterVersionRow,
} from "../db/rows.js";
import { chapterPositionLookup } from "../utils/chapter-position.js";
import { notFound, validationFailed } from "../utils/errors.js";
import { extractText, countWords } from "../utils/prosemirror.js";
import {
  enqueueMemoryJobs,
  pendingEarlierMemoryChapters,
  COMMIT_JOB_KINDS,
} from "../utils/memory-queue.js";
import {
  markMemoryStaleOnCommit,
  chapterMemoryStatus,
  outdatedPipelineChapters,
} from "../utils/memory-activation.js";
import type { MemoryWorker } from "../utils/memory-worker.js";
import { preserveDraftAsVersion } from "../utils/chapter-drafts.js";
import { recordWritingDelta } from "../utils/writing-progress.js";

export function createChaptersRoute(
  sqlite: DatabaseType,
  memoryWorker?: Pick<MemoryWorker, "kick">,
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
    // ADR 0002 (Step 6): the working draft, when present, is newer than the
    // committed version — the client loads it into the editor.
    const draftRow = sqlite
      .prepare(
        `SELECT chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at
         FROM chapter_drafts WHERE chapter_id = ?`,
      )
      .get(id) as
      | {
          chapter_id: number;
          content_json: string;
          content_text: string;
          word_count: number;
          base_version_id: number | null;
          revision: number;
          updated_at: string;
        }
      | undefined;
    const draft = draftRow
      ? {
          chapterId: draftRow.chapter_id,
          contentJson: draftRow.content_json,
          contentText: draftRow.content_text,
          wordCount: draftRow.word_count,
          baseVersionId: draftRow.base_version_id,
          revision: draftRow.revision,
          updatedAt: draftRow.updated_at,
        }
      : null;

    // ADR 0002: computed per-chapter memory state for the UI
    // (fresh | updating | error | none) + book-level stale marker. An
    // existing draft means uncommitted changes — memory can't be "fresh".
    const memory = chapterMemoryStatus(sqlite, row);
    if (draft && memory.state === "fresh") memory.state = "none";
    const staleRow = sqlite
      .prepare(
        "SELECT memory_stale_from_chapter_order s FROM books WHERE id = ?",
      )
      .get(row.book_id) as { s: number | null } | undefined;
    // order_index is sparse (10, 20, 30 … so chapters can be reordered), while
    // the UI numbers chapters by their position in the book. Both memory fields
    // below exist only to be shown to the author, so convert here — reporting a
    // raw order_index would tell them "chapter #10" about the first chapter.
    const positionOf = chapterPositionLookup(sqlite, row.book_id);
    return c.json({
      ...toChapter(row),
      currentVersion,
      draft,
      memory: {
        ...memory,
        bookStaleFromPosition:
          staleRow?.s == null ? null : positionOf(staleRow.s),
        // Главы, чья память собрана прежней версией конвейера: их придётся
        // разобрать заново, иначе новых слоёв (событий героев) у них не будет.
        outdatedPipelineChapters: outdatedPipelineChapters(sqlite, row.book_id),
        // Earlier chapters whose derived memory hasn't landed. Generating this
        // chapter now still works, but its prompt would miss their facts,
        // notes, summary and retrievable chunks.
        pendingEarlierChapters: pendingEarlierMemoryChapters(
          sqlite,
          row.book_id,
          row.order_index,
        ).map(positionOf),
      },
    });
  });

  // ADR 0002 (Step 6): debounced autosave target. UPSERTs the single working
  // draft row — no immutable version, no memory jobs, no LLM cost.
  r.put("/:id/draft", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = saveChapterDraftInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const ch = sqlite
      .prepare("SELECT id, current_version_id FROM chapters WHERE id = ?")
      .get(id) as { id: number; current_version_id: number | null } | undefined;
    if (!ch) return notFound(c, "chapter");

    const contentJson = JSON.stringify(parsed.data.contentJson);
    const contentText = extractText(parsed.data.contentJson);
    const wordCount = countWords(contentText);
    const now = new Date().toISOString();
    // Свеча-цель: прошлое состояние = предыдущий драфт, иначе текущая версия.
    // Читаем ДО UPSERT-а, иначе prevDraft уже будет перезаписан новым словом.
    const prevDraft = sqlite
      .prepare("SELECT word_count FROM chapter_drafts WHERE chapter_id = ?")
      .get(id) as { word_count: number } | undefined;
    let prevCount = prevDraft?.word_count;
    if (prevCount === undefined && ch.current_version_id) {
      const v = sqlite
        .prepare("SELECT word_count FROM chapter_versions WHERE id = ?")
        .get(ch.current_version_id) as { word_count: number } | undefined;
      prevCount = v?.word_count;
    }
    const saved = sqlite
      .prepare(
        `INSERT INTO chapter_drafts
           (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET
           content_json = excluded.content_json,
           content_text = excluded.content_text,
           word_count = excluded.word_count,
           base_version_id = excluded.base_version_id,
           revision = chapter_drafts.revision + 1,
           updated_at = excluded.updated_at
         RETURNING revision`,
      )
      .get(id, contentJson, contentText, wordCount, ch.current_version_id, now) as {
      revision: number;
    };
    recordWritingDelta(sqlite, wordCount - (prevCount ?? 0));
    return c.json({ chapterId: id, wordCount, revision: saved.revision, updatedAt: now });
  });

  // ADR 0002: re-enqueue failed memory jobs for the chapter's current
  // version (UI "Повторить" action). attempts reset so backoff starts over.
  r.post("/:id/memory/retry", (c) => {
    const id = Number(c.req.param("id"));
    const ch = sqlite
      .prepare("SELECT id, current_version_id FROM chapters WHERE id = ?")
      .get(id) as { id: number; current_version_id: number | null } | undefined;
    if (!ch) return notFound(c, "chapter");
    if (!ch.current_version_id) return c.json({ retried: 0 });
    const res = sqlite
      .prepare(
        `UPDATE memory_jobs
         SET status='pending', attempts=0, run_after=NULL, last_error=NULL, updated_at=?
         WHERE chapter_version_id = ? AND status='error'`,
      )
      .run(new Date().toISOString(), ch.current_version_id);
    if (res.changes > 0) memoryWorker?.kick();
    return c.json({ retried: res.changes });
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
    // Порядок здесь не меняется: он переезжает вместе с производной памятью
    // через `POST /books/:id/chapters/reorder` (К1).
    const next = {
      title: parsed.data.title ?? existing.title,
      status: parsed.data.status ?? existing.status,
    };
    sqlite
      .prepare("UPDATE chapters SET title=?, status=?, updated_at=? WHERE id=?")
      .run(next.title, next.status, now, id);
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
    // `character_events.chapter_id` — ON DELETE CASCADE (иначе удалённая глава
    // раскрывала бы свой секрет всем предыдущим). Значит вместе с главой молча
    // уходят и записи знаний, введённые автором вручную. Считаем их ДО
    // удаления и называем в ответе: восстановить их нечем, и узнать о потере
    // постфактум неоткуда.
    const lost = sqlite
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN origin IN ('manual','migration') THEN 1 ELSE 0 END) AS authored
         FROM character_events WHERE chapter_id = ?`,
      )
      .get(id) as { total: number; authored: number | null };
    sqlite.prepare("DELETE FROM chapters WHERE id = ?").run(id);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), existing.book_id);
    return c.json({
      deletedCharacterEvents: lost.total,
      deletedAuthoredEvents: lost.authored ?? 0,
    });
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

    // ADR 0002 (Step 6): POST /versions is always a deliberate commit — the
    // version row, its memory jobs and the draft cleanup happen in ONE
    // transaction (or none of them). Autosaves never reach this route.
    const tx = sqlite.transaction(() => {
      // К2: коммит из предпросмотра старой версии шлёт текст ВЕРСИИ, а не
      // черновика, и `DELETE FROM chapter_drafts` ниже уносил работу автора.
      // Совпал с коммитимым содержимым — снимок не делается.
      const draftVersionId = preserveDraftAsVersion(sqlite, id, {
        committedContentJson: contentJson,
        committedContentText: contentText,
      });
      const info = sqlite
        .prepare(
          `INSERT INTO chapter_versions
           (chapter_id, parent_version_id, content_json, content_text, word_count, source, created_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
        )
        .run(
          id,
          draftVersionId ?? parentVersionId,
          contentJson,
          contentText,
          wordCount,
          now,
        );
      const versionId = Number(info.lastInsertRowid);
      sqlite
        .prepare(
          "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(versionId, now, id);
      sqlite
        .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
        .run(now, ch.book_id);
      enqueueMemoryJobs(sqlite, {
        bookId: ch.book_id,
        chapterId: ch.id,
        chapterVersionId: versionId,
        kinds: COMMIT_JOB_KINDS,
      });
      markMemoryStaleOnCommit(sqlite, ch.book_id, ch.order_index);
      // The committed content came from the editor — the draft is stale now.
      sqlite.prepare("DELETE FROM chapter_drafts WHERE chapter_id = ?").run(id);
      return versionId;
    });
    const versionId = tx();

    const v = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(versionId) as ChapterVersionRow;

    memoryWorker?.kick();

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
    sqlite.transaction(() => {
      // К2: черновик здесь — часы работы, которых нет ни в одной версии.
      // Сначала он становится версией, и только потом его место занимает
      // восстанавливаемая.
      preserveDraftAsVersion(sqlite, id);
      sqlite
        .prepare(
          "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(versionId, now, id);
      // Restoring an old version is explicit — a lingering draft (based on the
      // previous current version) would silently override it on next load.
      sqlite.prepare("DELETE FROM chapter_drafts WHERE chapter_id = ?").run(id);
    })();
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

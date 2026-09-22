import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  updateChapterInputSchema,
  createChapterVersionInputSchema,
  saveChapterDraftInputSchema,
  sceneStateWriteSchema,
  sceneStateExpectationSchema,
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
  ENQUEUE_JOB_KINDS,
} from "../utils/memory-queue.js";
import {
  markMemoryStaleOnCommit,
  chapterMemoryStatus,
  outdatedPipelineChapters,
} from "../utils/memory-activation.js";
import type { MemoryWorker } from "../utils/memory-worker.js";
import { preserveDraftAsVersion } from "../utils/chapter-drafts.js";
import { recordWritingDelta } from "../utils/writing-progress.js";
import {
  loadCarryableSceneState,
  loadSceneStateForVersion,
  saveSceneState,
} from "../utils/scene-state.js";

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

  // ── Анкета непрерывности (состояние сцены на конец главы) ──────────────
  //
  // Живёт на версии главы: у главы без принятой версии её не бывает, а у
  // переписанной появляется своя, пока не посчитана — пусто.

  function currentVersionOf(
    id: number,
  ): { id: number; book_id: number; current_version_id: number | null } | undefined {
    return sqlite
      .prepare("SELECT id, book_id, current_version_id FROM chapters WHERE id = ?")
      .get(id) as
      | { id: number; book_id: number; current_version_id: number | null }
      | undefined;
  }

  r.get("/:id/scene-state", (c) => {
    const id = Number(c.req.param("id"));
    const ch = currentVersionOf(id);
    if (!ch) return notFound(c, "chapter");
    const row = ch.current_version_id
      ? loadSceneStateForVersion(sqlite, ch.current_version_id)
      : null;
    // Правка автора, оставшаяся на прежней версии: перезапись главы завела
    // новую, и анкета вместе с правкой ушла с экрана. Переносит её автор
    // кнопкой — молча подставлять описание заменённого текста нельзя.
    const carry = loadCarryableSceneState(sqlite, id);
    // «Анкеты нет» — штатный ответ, а не 404: опрос страницы главы не должен
    // засыпать консоль браузера красным (та же правка, что у inflight).
    return c.json({
      chapterId: id,
      versionId: ch.current_version_id,
      state: row?.state ?? null,
      origin: row?.origin ?? null,
      updatedAt: row?.updatedAt ?? null,
      carry: carry
        ? { state: carry.state, versionId: carry.chapterVersionId, updatedAt: carry.updatedAt }
        : null,
    });
  });

  r.patch("/:id/scene-state", async (c) => {
    const id = Number(c.req.param("id"));
    const ch = currentVersionOf(id);
    if (!ch) return notFound(c, "chapter");
    if (!ch.current_version_id) return notFound(c, "chapter_version");
    const body = await c.req.json().catch(() => null);
    const parsed = sceneStateWriteSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    // F23 ревью 2026-09-22: анкета писалась UPSERT'ом без проверки, на что
    // смотрел автор. Две вкладки молча перетирали друг друга, а форма,
    // открытая на версии 1, после принятия версии 2 сохранялась «ручной
    // анкетой» новой версии — мимо кнопки переноса. Теперь автор называет
    // версию главы и отметку строки, которые он видел (`null` — анкеты не
    // было), и расхождение — 409 без записи.
    const expected = sceneStateExpectationSchema.safeParse(body);
    if (!expected.success) return validationFailed(c, expected.error);
    const versionId = ch.current_version_id;
    const conflict = sqlite.transaction(() => {
      const current = loadSceneStateForVersion(sqlite, versionId);
      const currentUpdatedAt = current?.updatedAt ?? null;
      if (
        expected.data.expectedVersionId !== versionId ||
        expected.data.expectedUpdatedAt !== currentUpdatedAt
      ) {
        return {
          reason: expected.data.expectedVersionId !== versionId ? "version" : "state",
          currentVersionId: versionId,
          currentUpdatedAt,
        };
      }
      saveSceneState(sqlite, {
        bookId: ch.book_id,
        chapterId: id,
        chapterVersionId: versionId,
        state: parsed.data,
        origin: "manual",
      });
      return null;
    })();
    if (conflict) {
      return c.json(
        {
          error: "scene_state_conflict",
          details: {
            ...conflict,
            message:
              conflict.reason === "version"
                ? "Глава сменила версию, пока вы правили анкету. Ваш текст остался в форме — перечитайте анкету и перенесите нужное."
                : "Анкету изменили в другом месте, пока вы правили. Ваш текст остался в форме — перечитайте анкету и перенесите нужное.",
          },
        },
        409,
      );
    }
    return c.json({ chapterId: id, state: parsed.data, origin: "manual" });
  });

  r.post("/:id/scene-state/recompute", (c) => {
    const id = Number(c.req.param("id"));
    const ch = currentVersionOf(id);
    if (!ch) return notFound(c, "chapter");
    if (!ch.current_version_id) return notFound(c, "chapter_version");
    const versionId = ch.current_version_id;
    sqlite.transaction(() => {
      // Строку снимаем до постановки задания: без этого обработчик увидит
      // авторскую анкету и откажется её затирать — а пересчёт заказан именно
      // поверх неё.
      sqlite
        .prepare("DELETE FROM chapter_scene_states WHERE chapter_version_id = ?")
        .run(versionId);
      sqlite
        .prepare(
          "DELETE FROM memory_jobs WHERE chapter_version_id = ? AND kind = 'scene_state'",
        )
        .run(versionId);
      enqueueMemoryJobs(sqlite, {
        bookId: ch.book_id,
        chapterId: id,
        chapterVersionId: versionId,
        kinds: ["scene_state"],
      });
    })();
    memoryWorker?.kick();
    return c.json({ chapterId: id, versionId, enqueued: true });
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
      .prepare("SELECT book_id, order_index FROM chapters WHERE id = ?")
      .get(id) as { book_id: number; order_index: number } | undefined;
    if (!existing) return notFound(c, "chapter");
    // `character_events.chapter_id` — ON DELETE CASCADE (иначе удалённая глава
    // раскрывала бы свой секрет всем предыдущим). Значит вместе с главой молча
    // уходят и записи знаний, введённые автором вручную. Считаем их ДО
    // удаления и называем в ответе: восстановить их нечем, и узнать о потере
    // постфактум неоткуда.
    const removed = sqlite.transaction(() => {
    const lost = sqlite
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN origin IN ('manual','migration') THEN 1 ELSE 0 END) AS authored
         FROM character_events WHERE chapter_id = ?`,
      )
      .get(id) as { total: number; authored: number | null };
    // В4: `book_facts` и `book_notes` не ссылаются на главу — только на
    // книгу, — поэтому CASCADE их не трогал, и факты удалённой главы
    // оставались действующим каноном навсегда. Связь с главой у них всё же
    // есть: версия-источник. Машинные записи уходят вместе с главой,
    // авторские (`manual`, `studio`) остаются — их автор писал сам.
    // Факт, который отменял факт этой главы, иначе остался бы закрытым
    // навсегда: ссылка уйдёт в NULL по внешнему ключу, граница — нет.
    // Зеркало того же шага в «Перестроить память»; идёт ДО удаления.
    sqlite
      .prepare(
        `UPDATE book_facts SET valid_to_chapter = NULL, superseded_by = NULL
         WHERE book_id = ? AND superseded_by IN (
           SELECT id FROM book_facts
           WHERE book_id = ? AND origin = 'extracted' AND source_version_id IN
             (SELECT id FROM chapter_versions WHERE chapter_id = ?))`,
      )
      .run(existing.book_id, existing.book_id, id);
    const factsDeleted = sqlite
      .prepare(
        `DELETE FROM book_facts
         WHERE book_id = ? AND origin = 'extracted' AND source_version_id IN
           (SELECT id FROM chapter_versions WHERE chapter_id = ?)`,
      )
      .run(existing.book_id, id).changes;
    // Нить, закрытую в этой главе, открываем обратно — только машинную.
    sqlite
      .prepare(
        `UPDATE book_notes SET chapter_order_resolved = NULL
         WHERE book_id = ? AND origin = 'extracted' AND chapter_order_resolved = ?`,
      )
      .run(existing.book_id, existing.order_index);
    const notesDeleted = sqlite
      .prepare(
        `DELETE FROM book_notes
         WHERE book_id = ? AND origin = 'extracted' AND source_version_id IN
           (SELECT id FROM chapter_versions WHERE chapter_id = ?)`,
      )
      .run(existing.book_id, id).changes;
    // Сводка, в которую входила удалённая глава, пересказывает текст,
    // которого больше нет. Отпечаток её и так отверг бы при чтении — но
    // строка мешала бы выбрать более раннюю пригодную.
    sqlite
      .prepare(
        "DELETE FROM book_meta_summaries WHERE book_id = ? AND covers_to_order >= ?",
      )
      .run(existing.book_id, existing.order_index);
    sqlite.prepare("DELETE FROM chapters WHERE id = ?").run(id);
    // Память последующих глав собиралась в мире, где эта глава была.
    markMemoryStaleOnCommit(sqlite, existing.book_id, existing.order_index);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), existing.book_id);
    return {
      deletedCharacterEvents: lost.total,
      deletedAuthoredEvents: lost.authored ?? 0,
      deletedFacts: factsDeleted,
      deletedNotes: notesDeleted,
    };
    })();
    return c.json(removed);
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
        kinds: ENQUEUE_JOB_KINDS,
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

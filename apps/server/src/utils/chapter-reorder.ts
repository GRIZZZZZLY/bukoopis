import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Перестановка глав — единственное место, где меняется `chapters.order_index`.
 *
 * Порядок главы живёт не только в `chapters`: производные слои памяти хранят
 * его копиями (`chunks.chapter_order`, `book_facts.valid_from_chapter` и
 * `valid_to_chapter`, `book_notes.chapter_order_introduced` и
 * `chapter_order_resolved`, `character_voice_samples.source_chapter_order`,
 * `book_meta_summaries.covers_*`). Каждый читатель границы сцены сравнивает
 * именно эти копии, поэтому перестановка, менявшая один `chapters.order_index`,
 * оставляла их числами прошлой раскладки: глава, уехавшая в конец, проходила
 * фильтр «по состоянию до главы N» и попадала в подготовку ранней сцены
 * (К1 ревью 2026-09-19, подтверждено живым прогоном).
 *
 * Здесь всё это переносится одной транзакцией. Копия, у которой есть путь к
 * своей главе (через `source_version_id` или `chapter_id`), переносится ПО
 * ГЛАВЕ — это точно. Копия без такого пути переносится по значению через
 * карту «старый порядок → новый».
 *
 * Чего перенос не умеет и не обещает: временные факты канона закрываются
 * номером ЧУЖОЙ главы (`valid_to_chapter` — это «порядок отменившей главы
 * минус один»), и перестановка, меняющая относительный порядок этих двух глав,
 * ломает сам смысл интервала. Поэтому конец интервала пересчитывается от новой
 * позиции отменившего факта, а при вывернутом интервале схлопывается в «факт
 * жив только в своей главе». Вместе с этим книга помечается устаревшей памятью
 * с самой ранней сдвинувшейся позиции: дальше это работа «Перестроить память».
 */

export type ReorderFailure = "unknown_chapters" | "incomplete";

export class ChapterReorderError extends Error {
  constructor(readonly reason: ReorderFailure, message: string) {
    super(message);
    this.name = "ChapterReorderError";
  }
}

export interface ReorderResult {
  /** Сколько глав реально сменило `order_index`. */
  moved: number;
  /** Позиция, с которой производная память книги помечена устаревшей. */
  staleFrom: number | null;
}

/** Шаг разрежённой нумерации — тот же, что у всех путей создания глав. */
const ORDER_STEP = 10;

interface ChapterRowLite {
  id: number;
  order_index: number;
  current_version_id: number | null;
}

export function reorderChapters(
  sqlite: DatabaseType,
  bookId: number,
  chapterIds: readonly number[],
): ReorderResult {
  const tx = sqlite.transaction((): ReorderResult => {
    const existing = sqlite
      .prepare(
        "SELECT id, order_index, current_version_id FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
      )
      .all(bookId) as ChapterRowLite[];

    const wanted = new Set(chapterIds);
    if (wanted.size !== chapterIds.length) {
      throw new ChapterReorderError("incomplete", "в списке есть повторы глав");
    }
    if (chapterIds.length !== existing.length) {
      throw new ChapterReorderError(
        "incomplete",
        `в списке ${chapterIds.length} глав, а у книги ${existing.length}`,
      );
    }
    const known = new Set(existing.map((c) => c.id));
    for (const id of chapterIds) {
      if (!known.has(id)) {
        throw new ChapterReorderError(
          "unknown_chapters",
          `глава ${id} не принадлежит этой книге`,
        );
      }
    }

    const oldOrderById = new Map(existing.map((c) => [c.id, c.order_index]));
    /** Старый порядок → новый. Ключ перестановки для всех копий ниже. */
    const remap = new Map<number, number>();
    let moved = 0;
    let staleFrom: number | null = null;
    chapterIds.forEach((id, i) => {
      const oldOrder = oldOrderById.get(id)!;
      const newOrder = (i + 1) * ORDER_STEP;
      remap.set(oldOrder, newOrder);
      if (oldOrder !== newOrder) {
        moved += 1;
        const earliest = Math.min(oldOrder, newOrder);
        staleFrom = staleFrom === null ? earliest : Math.min(staleFrom, earliest);
      }
    });
    if (moved === 0) return { moved: 0, staleFrom: null };

    /** Новый порядок главы, которой принадлежит версия. */
    const chapterOfVersion = sqlite.prepare(
      "SELECT chapter_id FROM chapter_versions WHERE id = ?",
    );
    const newOrderOfChapter = new Map<number, number>();
    chapterIds.forEach((id, i) => newOrderOfChapter.set(id, (i + 1) * ORDER_STEP));

    /** Перенос по главе, если она известна; иначе по значению. */
    const moveOrder = (
      value: number | null,
      sourceVersionId: number | null,
    ): number | null => {
      if (value === null) return null;
      if (sourceVersionId !== null) {
        const row = chapterOfVersion.get(sourceVersionId) as
          | { chapter_id: number }
          | undefined;
        const byChapter =
          row === undefined ? undefined : newOrderOfChapter.get(row.chapter_id);
        if (byChapter !== undefined) return byChapter;
      }
      return remap.get(value) ?? value;
    };

    // 1. Чанки поиска. У них есть `chapter_id`, поэтому перенос точный —
    //    именно здесь жила подтверждённая утечка.
    const updateChunk = sqlite.prepare(
      "UPDATE chunks SET chapter_order = ? WHERE chapter_id = ? AND book_id = ?",
    );
    for (const [chapterId, newOrder] of newOrderOfChapter) {
      updateChunk.run(newOrder, chapterId, bookId);
    }

    // 2. Образцы речи: «из какой главы взята реплика».
    const voiceRows = sqlite
      .prepare(
        "SELECT id, source_version_id, source_chapter_order FROM character_voice_samples WHERE book_id = ?",
      )
      .all(bookId) as Array<{
      id: number;
      source_version_id: number | null;
      source_chapter_order: number | null;
    }>;
    const updateVoice = sqlite.prepare(
      "UPDATE character_voice_samples SET source_chapter_order = ? WHERE id = ?",
    );
    for (const row of voiceRows) {
      const next = moveOrder(row.source_chapter_order, row.source_version_id);
      if (next !== row.source_chapter_order) updateVoice.run(next, row.id);
    }

    // 3. Эпизодические заметки: где линия открыта и где закрыта.
    const noteRows = sqlite
      .prepare(
        `SELECT id, source_version_id, chapter_order_introduced, chapter_order_resolved
         FROM book_notes WHERE book_id = ?`,
      )
      .all(bookId) as Array<{
      id: number;
      source_version_id: number | null;
      chapter_order_introduced: number;
      chapter_order_resolved: number | null;
    }>;
    const updateNote = sqlite.prepare(
      "UPDATE book_notes SET chapter_order_introduced = ?, chapter_order_resolved = ? WHERE id = ?",
    );
    for (const row of noteRows) {
      const introduced =
        moveOrder(row.chapter_order_introduced, row.source_version_id) ??
        row.chapter_order_introduced;
      // Закрывает линию ДРУГАЯ глава, её версия здесь неизвестна — поэтому
      // только по значению. Номер, которому не нашлось главы (её удалили,
      // значение пришло от извлекателя), честнее обнулить в «не закрыта», чем
      // оставить числом прошлой раскладки.
      let resolved: number | null = null;
      if (row.chapter_order_resolved !== null) {
        resolved = remap.get(row.chapter_order_resolved) ?? null;
        // Перестановка могла поставить закрывающую главу раньше вводящей.
        // Нить, закрытая до своего начала, врёт и на доске, и в фильтрах
        // открытых линий: схлопываем в «открыта и закрыта в одной главе».
        if (resolved !== null && resolved < introduced) resolved = introduced;
      }
      if (
        introduced !== row.chapter_order_introduced ||
        resolved !== row.chapter_order_resolved
      ) {
        updateNote.run(introduced, resolved, row.id);
      }
    }

    // 4. Временные факты канона.
    const factRows = sqlite
      .prepare(
        `SELECT id, source_version_id, valid_from_chapter, valid_to_chapter, superseded_by
         FROM book_facts WHERE book_id = ?`,
      )
      .all(bookId) as Array<{
      id: number;
      source_version_id: number | null;
      valid_from_chapter: number;
      valid_to_chapter: number | null;
      superseded_by: number | null;
    }>;
    const newFrom = new Map<number, number>();
    for (const row of factRows) {
      newFrom.set(
        row.id,
        moveOrder(row.valid_from_chapter, row.source_version_id) ??
          row.valid_from_chapter,
      );
    }
    const updateFact = sqlite.prepare(
      "UPDATE book_facts SET valid_from_chapter = ?, valid_to_chapter = ? WHERE id = ?",
    );
    for (const row of factRows) {
      const from = newFrom.get(row.id)!;
      let to: number | null = null;
      if (row.valid_to_chapter !== null) {
        const superseder =
          row.superseded_by === null ? undefined : newFrom.get(row.superseded_by);
        if (superseder !== undefined) {
          // Факт жив до главы, предшествующей той, что его отменила. Порядок
          // этих двух глав мог вывернуться — тогда интервал схлопывается в
          // одну свою главу, а не начинает лгать про будущее.
          to = Math.max(from, superseder - 1);
        } else {
          // Закрыт без ссылки на отменивший факт (перенесённые данные).
          // Берём не самую позднюю позицию ВНУТРИ интервала, а первую позицию
          // ЗА ним минус один: глава, лежавшая после интервала, могла встать
          // между его главами, и «до самой поздней» вернуло бы отменённый
          // факт туда, где его не было, — та же утечка, ради которой всё это.
          let firstAfter: number | null = null;
          for (const [oldOrder, newOrder] of remap) {
            if (oldOrder > row.valid_to_chapter) {
              firstAfter = firstAfter === null ? newOrder : Math.min(firstAfter, newOrder);
            }
          }
          to = firstAfter === null ? from : Math.max(from, firstAfter - 1);
        }
      }
      if (from !== row.valid_from_chapter || to !== row.valid_to_chapter) {
        updateFact.run(from, to, row.id);
      }
    }

    // 5. Крючки: в какой главе автор ждёт развязки. На промпты не влияет,
    //    но экран сущностей показывал бы чужую главу.
    const hookRows = sqlite
      .prepare(
        "SELECT id, expected_resolution_chapter_order AS e FROM hooks WHERE book_id = ? AND expected_resolution_chapter_order IS NOT NULL",
      )
      .all(bookId) as Array<{ id: number; e: number }>;
    const updateHook = sqlite.prepare(
      "UPDATE hooks SET expected_resolution_chapter_order = ? WHERE id = ?",
    );
    for (const row of hookRows) {
      const next = remap.get(row.e);
      if (next !== undefined && next !== row.e) updateHook.run(next, row.id);
    }

    // 6. Сводки по рубежам. Их отпечаток (`глава:версия:название`) после
    //    перестановки всё равно не сойдётся, и читатель их отвергнет, — но
    //    строка с чужим рубежом только мешает выбирать. Убираем: рубежи
    //    соберутся заново заданием `rollup`.
    sqlite.prepare("DELETE FROM book_meta_summaries WHERE book_id = ?").run(bookId);

    // 7. Сам порядок. В одном проходе: уникального индекса на
    //    (book_id, order_index) нет, а промежуточные совпадения внутри
    //    транзакции никому не видны.
    const now = new Date().toISOString();
    const setOrder = sqlite.prepare(
      "UPDATE chapters SET order_index = ?, updated_at = ? WHERE id = ? AND book_id = ?",
    );
    chapterIds.forEach((id, i) => setOrder.run((i + 1) * ORDER_STEP, now, id, bookId));

    // 8. Производная память построена на прежнем порядке событий: перенос
    //    вернул ей правильные номера, но не пересобрал смысл. Отметка стоит
    //    ровно для этого — экран предложит «Перестроить память с главы N».
    if (staleFrom !== null) {
      sqlite
        .prepare(
          `UPDATE books SET memory_stale_from_chapter_order =
             CASE WHEN memory_stale_from_chapter_order IS NULL THEN ?
                  ELSE MIN(memory_stale_from_chapter_order, ?) END,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(staleFrom, staleFrom, now, bookId);
    }

    return { moved, staleFrom };
  });
  return tx.immediate();
}

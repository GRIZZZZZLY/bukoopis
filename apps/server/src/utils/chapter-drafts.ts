import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Черновик главы — единственная копия текста, который автор напечатал после
 * последней версии. Версия иммутабельна и лежит в истории; черновик — одна
 * строка, которую вправе удалить каждый, кто делает новую версию.
 *
 * Правило (К2 ревью 2026-09-19): любой текст автора становится версией
 * ПРЕЖДЕ, чем что-либо его заменит. Три пути удаляли черновик, не сохранив
 * его: принятие кандидата модели (текст версии — кандидат, а не черновик),
 * восстановление старой версии и коммит содержимого редактора из
 * предпросмотра (клиент шлёт текст версии, а черновик новее).
 *
 * Вызывать ВНУТРИ транзакции вызывающего: снимок и то, ради чего черновик
 * удаляют, обязаны лечь вместе или никак.
 */

interface DraftRow {
  content_json: string;
  content_text: string;
  word_count: number;
}

export interface PreserveDraftOptions {
  /** Содержимое, которое вызывающий сам сейчас делает версией. Совпало с
   *  черновиком — снимок не нужен: черновик и есть то, что коммитят. */
  committedContentJson?: string;
  /** Тот же текст, но плоской строкой. Сравнение строк JSON слишком строгое:
   *  редактор нормализует документ при загрузке (добавляет умолчания атрибутов),
   *  и черновик, записанный сервером раньше, перестаёт совпадать байт в байт,
   *  хотя автор ничего не менял. Совпал текст — работать не с чем. */
  committedContentText?: string;
}

/**
 * Делает из черновика главы версию `source = 'manual'` и ставит её текущей.
 * Возвращает id снимка или `null`, когда сохранять нечего.
 *
 * Заданий памяти НЕ ставит: снимок в ту же транзакцию тут же вытесняется
 * версией вызывающего, и задания по нему всё равно ушли бы в `obsolete`
 * первой же проверкой `isCurrent`. Снимок существует ради истории автора, а
 * не ради извлечения.
 */
export function preserveDraftAsVersion(
  sqlite: DatabaseType,
  chapterId: number,
  opts: PreserveDraftOptions = {},
): number | null {
  const draft = sqlite
    .prepare(
      "SELECT content_json, content_text, word_count FROM chapter_drafts WHERE chapter_id = ?",
    )
    .get(chapterId) as DraftRow | undefined;
  if (!draft) return null;
  // Редактор не автосохраняет пустой документ, поэтому пустой черновик — не
  // авторский текст, а след чужого пути. Версией он быть не должен.
  if (draft.content_text.trim().length === 0) return null;
  if (opts.committedContentJson === draft.content_json) return null;
  if (opts.committedContentText === draft.content_text) return null;

  const ch = sqlite
    .prepare("SELECT book_id, current_version_id FROM chapters WHERE id = ?")
    .get(chapterId) as
    | { book_id: number; current_version_id: number | null }
    | undefined;
  if (!ch) return null;

  if (ch.current_version_id !== null) {
    const current = sqlite
      .prepare(
        "SELECT content_json, content_text FROM chapter_versions WHERE id = ?",
      )
      .get(ch.current_version_id) as
      | { content_json: string; content_text: string }
      | undefined;
    // Автосейв мог сработать без единой правки: такой черновик повторяет
    // текущую версию, и вторая её копия в истории — шум, а не страховка.
    if (
      current &&
      current.content_json === draft.content_json &&
      current.content_text === draft.content_text
    ) {
      return null;
    }
  }

  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO chapter_versions
         (chapter_id, parent_version_id, content_json, content_text, word_count, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
    )
    .run(
      chapterId,
      ch.current_version_id,
      draft.content_json,
      draft.content_text,
      draft.word_count,
      now,
    );
  const versionId = Number(info.lastInsertRowid);
  sqlite
    .prepare(
      "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
    )
    .run(versionId, now, chapterId);
  return versionId;
}

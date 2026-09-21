import type { Database as DatabaseType } from "better-sqlite3";
import {
  isEmptySceneState,
  renderSceneStatePrompt,
  sceneStateSchema,
  type SceneState,
} from "@book-forge/shared";
import { runSceneStateExtractor } from "@book-forge/agents";
import type { StructuredUsage } from "@book-forge/llm";
import { chapterPositionLookup } from "./chapter-position.js";

/**
 * Состояние сцены на сервере: чтение, запись и подбор анкеты для промпта
 * (`docs/superpowers/specs/2026-09-21-scene-state-design.md`).
 *
 * Вся SQL анкеты живёт здесь — второй экземпляр выбора «последняя глава до
 * границы» разошёлся бы молча, ровно как это уже было у границы событий.
 */

export interface SceneStateRow {
  id: number;
  chapterId: number;
  chapterVersionId: number;
  state: SceneState;
  origin: "llm" | "manual";
  updatedAt: string;
}

interface RawRow {
  id: number;
  chapter_id: number;
  chapter_version_id: number;
  state_json: string;
  origin: string;
  updated_at: string;
}

/** Разбор строки базы. Негодный JSON — это `null`, а не бросок: страница
 *  главы и сборка контекста не должны падать из-за одной записи (AC-8). */
function toRow(raw: RawRow | undefined): SceneStateRow | null {
  if (!raw) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.state_json);
  } catch {
    return null;
  }
  const parsed = sceneStateSchema.safeParse(parsedJson);
  if (!parsed.success) return null;
  return {
    id: raw.id,
    chapterId: raw.chapter_id,
    chapterVersionId: raw.chapter_version_id,
    state: parsed.data,
    origin: raw.origin === "manual" ? "manual" : "llm",
    updatedAt: raw.updated_at,
  };
}

const SELECT_COLUMNS =
  "id, chapter_id, chapter_version_id, state_json, origin, updated_at";

export function loadSceneStateForVersion(
  sqlite: DatabaseType,
  chapterVersionId: number,
): SceneStateRow | null {
  return toRow(
    sqlite
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM chapter_scene_states WHERE chapter_version_id = ?`,
      )
      .get(chapterVersionId) as RawRow | undefined,
  );
}

/** Анкета текущей версии главы. Именно текущей: строка старой версии
 *  описывает текст, который автор уже заменил. */
export function loadSceneStateForChapter(
  sqlite: DatabaseType,
  chapterId: number,
): SceneStateRow | null {
  return toRow(
    sqlite
      .prepare(
        `SELECT s.id, s.chapter_id, s.chapter_version_id, s.state_json, s.origin, s.updated_at
           FROM chapter_scene_states s
           JOIN chapters c ON c.current_version_id = s.chapter_version_id
          WHERE c.id = ?`,
      )
      .get(chapterId) as RawRow | undefined,
  );
}

export function saveSceneState(
  sqlite: DatabaseType,
  args: {
    bookId: number;
    chapterId: number;
    chapterVersionId: number;
    state: SceneState;
    origin: "llm" | "manual";
  },
): void {
  const now = new Date().toISOString();
  // Повторный прогон заменяет анкету, а не заводит вторую (INV-2). Ключ
  // конфликта — версия главы, уникальная по индексу.
  sqlite
    .prepare(
      `INSERT INTO chapter_scene_states
         (book_id, chapter_id, chapter_version_id, state_json, origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chapter_version_id) DO UPDATE SET
         state_json = excluded.state_json,
         origin = excluded.origin,
         updated_at = excluded.updated_at`,
    )
    .run(
      args.bookId,
      args.chapterId,
      args.chapterVersionId,
      JSON.stringify(args.state),
      args.origin,
      now,
      now,
    );
}

export interface BoundarySceneState {
  chapterId: number;
  /** Отрендеренный блок для промпта. */
  prompt: string;
}

/**
 * Анкета последней главы ДО границы сцены. Граница исключающая, как у
 * событий персонажей: анкета главы 5 не видна при подготовке главы 5.
 *
 * Одна, а не список: список растёт с длиной книги и вытесняет из бюджета
 * поиск и стиль ради сведений, которые к пятнадцатой главе уже неверны.
 */
export function loadBoundarySceneState(
  sqlite: DatabaseType,
  bookId: number,
  orderIndex: number,
): BoundarySceneState | null {
  const raw = sqlite
    .prepare(
      `SELECT s.id, s.chapter_id, s.chapter_version_id, s.state_json, s.origin, s.updated_at,
              c.order_index AS order_index, c.title AS title
         FROM chapter_scene_states s
         JOIN chapters c ON c.id = s.chapter_id
        WHERE c.book_id = ?
          AND c.order_index < ?
          AND c.current_version_id = s.chapter_version_id
        ORDER BY c.order_index DESC
        LIMIT 1`,
    )
    .get(bookId, orderIndex) as
    | (RawRow & { order_index: number; title: string })
    | undefined;
  const row = toRow(raw);
  if (!row || !raw) return null;
  if (isEmptySceneState(row.state)) return null;

  const position = chapterPositionLookup(sqlite, bookId)(raw.order_index);
  const label = position
    ? `глава ${position} «${raw.title}»`
    : `глава «${raw.title}»`;
  const prompt = renderSceneStatePrompt(row.state, label);
  if (!prompt) return null;
  return { chapterId: row.chapterId, prompt };
}

export interface SceneStatePayload {
  state: SceneState | null;
  skipped?: string;
}

/** Минимум слов, ниже которого главу не разбираем: тот же порог, что у
 *  пересказа и фактов. Пропуск называется причиной, чтобы не быть
 *  неотличимым от разбора, не нашедшего ничего. */
const MIN_WORDS = 80;

/**
 * Собрать анкету версии главы вызовом модели. Пишет ли результат в базу —
 * решает вызывающий (обработчик очереди): так же устроены факты.
 */
export async function extractSceneStatePayload(
  sqlite: DatabaseType,
  chapterVersionId: number,
  opts: { onUsage?: (usage: StructuredUsage & { modelId: string }) => void } = {},
): Promise<SceneStatePayload> {
  const v = sqlite
    .prepare(
      `SELECT v.content_text, v.word_count, c.id AS chapter_id, c.book_id, c.order_index, c.title
         FROM chapter_versions v
         JOIN chapters c ON c.id = v.chapter_id
        WHERE v.id = ?`,
    )
    .get(chapterVersionId) as
    | {
        content_text: string;
        word_count: number;
        chapter_id: number;
        book_id: number;
        order_index: number;
        title: string;
      }
    | undefined;
  if (!v) return { state: null, skipped: "missing" };
  if (v.word_count < MIN_WORDS) return { state: null, skipped: "short" };

  const cast = sqlite
    .prepare(
      "SELECT canonical_name FROM characters WHERE book_id = ? ORDER BY id ASC",
    )
    .all(v.book_id) as Array<{ canonical_name: string }>;

  const previous = loadBoundarySceneState(sqlite, v.book_id, v.order_index);
  const position = chapterPositionLookup(sqlite, v.book_id)(v.order_index);

  const raw = await runSceneStateExtractor({
    chapterTitle: v.title,
    chapterPosition: position ?? 1,
    chapterText: v.content_text,
    castNames: cast.map((c) => c.canonical_name),
    previousState: previous?.prompt ?? null,
    ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
  });

  const parsed = sceneStateSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[scene-state] версия ${chapterVersionId}: ответ не прошёл схему —`,
      parsed.error.issues[0]?.message ?? "",
    );
    return { state: null, skipped: "malformed" };
  }
  return { state: parsed.data };
}

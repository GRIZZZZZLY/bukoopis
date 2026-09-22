import type { Database as DatabaseType } from "better-sqlite3";
import { runSceneIntent, type SceneIntentAvailableEvent } from "@book-forge/agents";
import type { StructuredUsage } from "@book-forge/llm";
import {
  sceneIntentSchema,
  sceneIntentToolSchema,
  sceneKeyFor,
  renderSceneIntentPrompt,
  ACQUISITION_LABELS,
  type SceneIntent,
} from "@book-forge/shared";

/**
 * Подготовка сцены (ТЗ индивидуальности, раздел 9.2).
 *
 * Один вызов на сцену. Сцена пока одна на главу, поэтому порядковый номер
 * сцены всегда 1 — внутриглавные сцены отложены вместе с AC-08.
 *
 * Два правила, ради которых эта функция вообще существует отдельно от
 * маршрута:
 *
 * 1. **Ссылки проверяются против снимка (AC-25).** Модель вправе сослаться
 *    только на события, действительно вошедшие в сборку контекста. Чужой или
 *    будущий номер выбрасывается, а не принимается потому, что ответ имеет
 *    правильную форму.
 * 2. **Падение подготовки не срывает главу.** Писатель идёт по тому же
 *    снимку без замысла, но деградация возвращается наверх и видна в запуске:
 *    молчаливая деградация хуже отказа.
 */

export interface PrepareSceneIntentArgs {
  bookId: number;
  chapterId: number;
  chapterOrder: number;
  chapterTitle: string;
  bookTitle: string;
  beatSheet: string;
  dialogueRegister: string | null;
  chapterContract: string | null;
  characterContext: string | null;
  participants: Array<{ characterId: number; name: string }>;
  /** Номера событий, вошедших в снимок контекста (`sourceRefs`, kind "event"). */
  snapshotEventIds: number[];
  /** `context_manifests.id` той же сборки. */
  contextSnapshotId: number;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export interface PrepareSceneIntentResult {
  intent: SceneIntent | null;
  /** Готовый блок для промпта Писателя; `null` — печатать нечего. */
  prompt: string | null;
  /** Номера, которые модель назвала, а снимок не подтвердил. */
  droppedEventIds: number[];
  /** Подготовка не удалась: вызов упал или ответ не прошёл схему. */
  degraded: boolean;
}

const EMPTY: PrepareSceneIntentResult = {
  intent: null,
  prompt: null,
  droppedEventIds: [],
  degraded: false,
};

export interface LoadStoredSceneIntentArgs {
  chapterId: number;
  participants: Array<{ characterId: number; name: string }>;
  /** Номера событий, вошедшие в НОВУЮ сборку контекста. */
  snapshotEventIds: number[];
}

/**
 * Замысел, посчитанный в прогоне, который автор остановил.
 *
 * «Дописать с беата» продолжает ТУ ЖЕ сцену того же плана: считать замысел
 * заново значит платить минуту ожидания и вызов модели за тот же ответ —
 * живой прогон 2026-09-22 намерил 46–50 с на подготовку при 31–37 с на сам
 * беат, то есть больше половины ожидания уходило на пересчёт уже известного.
 *
 * Сохранённый замысел не принимается как есть: снимок контекста собран
 * заново, поэтому ссылки на события сверяются с ним (AC-25 держится и здесь),
 * а участник, которого в сцене больше нет, уходит вместе со своими
 * напряжениями — его карточки в промпте всё равно не будет.
 *
 * `null` — переиспользовать нечего: строки нет, она не разбирается, или из
 * неё нечего печатать. Вызывающий тогда считает замысел обычным путём;
 * тихо остаться без замысла хуже, чем заплатить за вызов.
 */
export function loadStoredSceneIntent(
  sqlite: DatabaseType,
  args: LoadStoredSceneIntentArgs,
): PrepareSceneIntentResult | null {
  const row = sqlite
    .prepare("SELECT scene_intent_json FROM chapters WHERE id = ?")
    .get(args.chapterId) as { scene_intent_json: string | null } | undefined;
  if (!row?.scene_intent_json) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(row.scene_intent_json);
  } catch {
    return null;
  }
  const parsed = sceneIntentSchema.safeParse(raw);
  if (!parsed.success) return null;

  const allowedCharacters = new Set(args.participants.map((p) => p.characterId));
  const snapshot = new Set(args.snapshotEventIds);
  const dropped: number[] = [];
  const participants = parsed.data.participants
    .filter((p) => allowedCharacters.has(p.characterId))
    .map((p) => {
      const kept: number[] = [];
      for (const id of p.relevantEventIds) {
        if (snapshot.has(id)) kept.push(id);
        else if (!dropped.includes(id)) dropped.push(id);
      }
      return { ...p, relevantEventIds: kept };
    });
  const intent: SceneIntent = {
    ...parsed.data,
    participants,
    interactionTensions: parsed.data.interactionTensions.filter(
      (t) =>
        allowedCharacters.has(t.fromCharacterId) && allowedCharacters.has(t.toCharacterId),
    ),
  };

  const names = new Map(args.participants.map((p) => [p.characterId, p.name]));
  const prompt = renderSceneIntentPrompt(intent, names);
  if (prompt === null) return null;

  if (dropped.length > 0) {
    console.warn(
      `[scene-intent] глава ${args.chapterId}: сохранённый замысел ссылался на события вне нового снимка ${dropped.length} (${dropped.join(", ")})`,
    );
  }
  return { intent, prompt, droppedEventIds: dropped, degraded: false };
}

/** Короткая строка события для списка «Доступные события». Полные карточки
 *  участников идут рядом своим блоком — здесь нужен только номер и суть. */
function summarizeEvent(row: {
  id: number;
  kind: string;
  data_json: string;
}): string | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pick = (key: string): string | null => {
    const v = data[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  switch (row.kind) {
    case "knowledge": {
      const fact = pick("fact");
      if (!fact) return null;
      const acq = pick("acquisition");
      const label = acq && acq in ACQUISITION_LABELS
        ? ACQUISITION_LABELS[acq as keyof typeof ACQUISITION_LABELS]
        : "";
      return label ? `знает: ${fact} (${label})` : `знает: ${fact}`;
    }
    case "state": {
      const state = pick("state");
      return state ? `состояние: ${state}` : null;
    }
    case "relation_shift": {
      const quality = pick("quality");
      const to = pick("to");
      return quality && to ? `отношение — ${quality}: ${to}` : null;
    }
    case "commitment": {
      const commitment = pick("commitment");
      return commitment ? `обязался: ${commitment}` : null;
    }
    default:
      return null;
  }
}

function loadAvailableEvents(
  sqlite: DatabaseType,
  participants: ReadonlyArray<{ characterId: number; name: string }>,
  snapshotEventIds: ReadonlySet<number>,
): SceneIntentAvailableEvent[] {
  if (snapshotEventIds.size === 0) return [];
  const byId = new Map(participants.map((p) => [p.characterId, p.name]));
  const placeholders = participants.map(() => "?").join(",");
  const rows = sqlite
    .prepare(
      `SELECT id, subject_character_id, kind, data_json
       FROM character_events
       WHERE subject_character_id IN (${placeholders})
       ORDER BY id ASC`,
    )
    .all(...participants.map((p) => p.characterId)) as Array<{
    id: number;
    subject_character_id: number;
    kind: string;
    data_json: string;
  }>;
  const out: SceneIntentAvailableEvent[] = [];
  for (const r of rows) {
    // Снимок — единственный источник правды о границе сцены: он посчитан
    // теми же читателями, что и карточки. Второй SQL с собственной границей
    // разошёлся бы с ним молча, а это ровно та утечка, ради которой границу
    // и держат в одном месте.
    if (!snapshotEventIds.has(r.id)) continue;
    const name = byId.get(r.subject_character_id);
    if (!name) continue;
    const summary = summarizeEvent(r);
    if (!summary) continue;
    out.push({ id: r.id, characterName: name, summary });
  }
  return out;
}

export async function prepareSceneIntent(
  sqlite: DatabaseType,
  args: PrepareSceneIntentArgs,
): Promise<PrepareSceneIntentResult> {
  // Меньше двоих — замысел не о чем: у одного участника нет ни напряжений,
  // ни умолчаний от кого-то. Вызов был бы потрачен впустую.
  if (args.participants.length < 2) return EMPTY;

  const snapshot = new Set(args.snapshotEventIds);
  const availableEvents = loadAvailableEvents(sqlite, args.participants, snapshot);

  let raw: unknown;
  try {
    raw = await runSceneIntent({
      bookTitle: args.bookTitle,
      chapterTitle: args.chapterTitle,
      chapterOrder: args.chapterOrder,
      beatSheet: args.beatSheet,
      dialogueRegister: args.dialogueRegister,
      chapterContract: args.chapterContract,
      characterContext: args.characterContext,
      participants: args.participants,
      availableEvents,
      ...(args.onUsage ? { onUsage: args.onUsage } : {}),
    });
  } catch (e) {
    console.warn(
      `[scene-intent] глава ${args.chapterId}: подготовка не удалась —`,
      e instanceof Error ? e.message : e,
    );
    return { ...EMPTY, degraded: true };
  }

  const parsed = sceneIntentToolSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[scene-intent] глава ${args.chapterId}: ответ не прошёл схему —`,
      parsed.error.issues[0]?.message ?? "",
    );
    return { ...EMPTY, degraded: true };
  }

  const allowedCharacters = new Set(args.participants.map((p) => p.characterId));
  const dropped: number[] = [];
  const participants = parsed.data.participants
    // Герой, которого в сцене нет, — выдуманный участник: карточки у него в
    // промпте нет, и намерение висело бы в пустоте.
    .filter((p) => allowedCharacters.has(p.characterId))
    .map((p) => {
      const kept: number[] = [];
      for (const id of p.relevantEventIds) {
        if (snapshot.has(id)) kept.push(id);
        else if (!dropped.includes(id)) dropped.push(id);
      }
      return { ...p, relevantEventIds: kept };
    });
  const tensions = parsed.data.interactionTensions.filter(
    (t) =>
      allowedCharacters.has(t.fromCharacterId) && allowedCharacters.has(t.toCharacterId),
  );

  const intent: SceneIntent = {
    sceneId: sceneKeyFor(args.chapterId, 1),
    contextSnapshotId: args.contextSnapshotId,
    participants,
    interactionTensions: tensions,
  };

  if (dropped.length > 0) {
    console.warn(
      `[scene-intent] глава ${args.chapterId}: ссылок на события вне снимка ${dropped.length} (${dropped.join(", ")})`,
    );
  }

  sqlite
    .prepare("UPDATE chapters SET scene_intent_json = ? WHERE id = ?")
    .run(JSON.stringify(intent), args.chapterId);

  const names = new Map(args.participants.map((p) => [p.characterId, p.name]));
  return {
    intent,
    prompt: renderSceneIntentPrompt(intent, names),
    droppedEventIds: dropped,
    degraded: false,
  };
}

import { z } from "zod";

/**
 * Состояние сцены — анкета непрерывности на версию главы
 * (`docs/superpowers/specs/2026-09-21-scene-state-design.md`).
 *
 * Карточка героя описывает его вообще, а не сейчас. Канон-факты держат
 * устойчивые свойства мира, события персонажа — знания и обещания, а
 * физическая обстановка сцены не хранилась нигде: в главе 7 герой в плаще и с
 * рукой на перевязи, в главе 8 плащ исчез, и поймать это нечем.
 *
 * Анкета описывает КОНЕЦ главы — то положение, из которого начинается
 * следующая. Начальное состояние отдельно не хранится: это конец предыдущей.
 *
 * Две схемы, как у профиля V2 и замысла сцены: схема ЧТЕНИЯ без пределов и с
 * `.catch` на каждом поле (кривая строка из базы не должна ронять страницу
 * главы и сборку контекста, AC-8) и схема ОТВЕТА МОДЕЛИ с пределами.
 */

/** Строка «герой → что про него известно». Отдельные поля-объекты не берём:
 *  имя героя приходит от модели и в состав книги может не попасть вовсе, а
 *  ключ объекта с таким именем читался бы хуже пары. */
export const sceneStatePersonLineSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type SceneStatePersonLine = z.infer<typeof sceneStatePersonLineSchema>;

const readLine = z.string().nullable().catch(null);
const readList = z.array(z.string()).catch([]);
const readPersonList = z.array(sceneStatePersonLineSchema).catch([]);

export const sceneStateSchema = z.object({
  /** Где кончилась глава. */
  place: readLine.default(null),
  /** Время суток и сколько прошло со сцены прошлой главы. */
  timeMarker: readLine.default(null),
  /** Кто на месте к концу главы и в каком положении. */
  present: readList.default([]),
  /** Во что одет и как выглядит. */
  appearance: readPersonList.default([]),
  /** Что при себе. */
  carried: readPersonList.default([]),
  /** Раны, усталость, опьянение. */
  condition: readPersonList.default([]),
  /** Погода, свет, шум, что сломано. */
  surroundings: readList.default([]),
  /** Что осталось в воздухе: дверь открыта, мотор не заглушён. */
  loose: readList.default([]),
  /** Чем это отличается от анкеты прошлой главы. */
  changes: readList.default([]),
});
export type SceneState = z.infer<typeof sceneStateSchema>;

/** Схема ЗАПИСИ — правка автора. Отличается от схемы чтения тем, что не
 *  прощает: `.catch` там существует ради уже лежащих в базе строк, а поле
 *  не той формы, пришедшее из формы правки, — это ошибка запроса, и молча
 *  превращать его в умолчание значит терять авторский текст без слова. */
export const sceneStateWriteSchema = z.object({
  place: z.string().max(300).nullable().default(null),
  timeMarker: z.string().max(300).nullable().default(null),
  present: z.array(z.string().max(300)).max(12).default([]),
  appearance: z.array(sceneStatePersonLineSchema).max(12).default([]),
  carried: z.array(sceneStatePersonLineSchema).max(12).default([]),
  condition: z.array(sceneStatePersonLineSchema).max(12).default([]),
  surroundings: z.array(z.string().max(300)).max(12).default([]),
  loose: z.array(z.string().max(300)).max(12).default([]),
  changes: z.array(z.string().max(300)).max(12).default([]),
});

const toolLine = z.string().max(300).nullable();
const toolList = z.array(z.string().max(300)).max(12);
const toolPersonList = z
  .array(
    z.object({
      name: z.string().max(120),
      value: z.string().max(300),
    }),
  )
  .max(12);

export const sceneStateToolSchema = z
  .object({
    place: toolLine,
    timeMarker: toolLine,
    present: toolList,
    appearance: toolPersonList,
    carried: toolPersonList,
    condition: toolPersonList,
    surroundings: toolList,
    loose: toolList,
    changes: toolList,
  })
  .strict();
export type SceneStateToolResult = z.infer<typeof sceneStateToolSchema>;

/** Пустая анкета — та, из которой в промпт не попадёт ни строки. Считается по
 *  содержимому, а не по факту существования строки: модель на бытовой сцене
 *  вправе вернуть анкету, где нечего сказать. */
export function isEmptySceneState(state: SceneState): boolean {
  return renderSceneStateLines(state).length === 0;
}

function trimmed(items: readonly string[]): string[] {
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}

function personLines(items: readonly SceneStatePersonLine[]): string[] {
  return items
    .map((p) => ({ name: p.name.trim(), value: p.value.trim() }))
    .filter((p) => p.name.length > 0 && p.value.length > 0)
    .map((p) => `${p.name}: ${p.value}`);
}

function group(label: string, lines: readonly string[]): string | null {
  if (lines.length === 0) return null;
  return `${label}:\n${lines.map((l) => `— ${l}`).join("\n")}`;
}

/** Строки анкеты без заголовка — общий счётчик пустоты и рендера. Пустые
 *  подсписки не печатаются: заголовок без строк читается как утверждение
 *  («ничего при себе нет»), то же правило, что у контракта главы. */
function renderSceneStateLines(state: SceneState): string[] {
  const blocks: Array<string | null> = [
    state.place?.trim() ? `Место: ${state.place.trim()}` : null,
    state.timeMarker?.trim() ? `Время: ${state.timeMarker.trim()}` : null,
    group("Кто на месте", trimmed(state.present)),
    group("Вид и одежда", personLines(state.appearance)),
    group("При себе", personLines(state.carried)),
    group("Состояние", personLines(state.condition)),
    group("Вокруг", trimmed(state.surroundings)),
    group("Осталось незакрытым", trimmed(state.loose)),
    group("Изменилось за главу", trimmed(state.changes)),
  ];
  return blocks.filter((b): b is string => b !== null);
}

/**
 * Блок для промпта. Называет главу, которой анкета принадлежит: без этого
 * «Место: причал» читается как место ЭТОЙ сцены, а это конец предыдущей.
 */
export function renderSceneStatePrompt(
  state: SceneState,
  chapterLabel: string,
): string | null {
  const lines = renderSceneStateLines(state);
  if (lines.length === 0) return null;
  return [
    `Положение вещей на конец предыдущей главы (${chapterLabel}).`,
    "Это исходная обстановка сцены. Изменить её глава вправе — умолчать нет.",
    "",
    lines.join("\n\n"),
  ].join("\n");
}

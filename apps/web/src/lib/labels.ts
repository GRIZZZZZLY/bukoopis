import type { StageId } from "@book-forge/shared";

/** Единый словарь подписей интерфейса. Раньше метки этапов жили копиями в
 *  шести файлах и расходились («Studio» против «Мастерская», «Сюжет» против
 *  «План»). Новое слово добавляется сюда, а не в компонент. */
export const STAGE_LABELS: Record<StageId, string> = {
  concept: "Замысел",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "План",
  chapters: "Главы",
};

/** Статусы главы: внутренние коды не показываются автору. */
export const CHAPTER_STATUS_LABELS: Record<string, string> = {
  draft: "черновик",
  in_review: "на проверке",
  final: "готова",
};

/** Разделы дома книги в порядке меню. */
export const BOOK_SECTIONS = [
  { id: "overview", label: "Обзор", path: "" },
  { id: "chapters", label: "Главы", path: "chapters" },
  { id: "canon", label: "Канон", path: "canon" },
  { id: "memory", label: "Заметки памяти", path: "memory" },
  { id: "settings", label: "Настройки", path: "settings" },
] as const;

export type BookSectionId = (typeof BOOK_SECTIONS)[number]["id"];

/** Основа проверки главы в отчёте критики. Для `beats` подписи нет: сверка
 *  с выбранным планом — обычный случай, о нём не говорят. */
export const PLAN_BASIS_LABELS = {
  intent: "Плана не было — проверено по содержанию главы",
  none: "Плана и содержания не было — проверено по прошлым главам и карточкам",
} as const;

/** Итог утверждения плана книги в Мастерской. */
export const PLAN_APPROVE_LABELS = {
  created: "Создано глав",
  /** `updated`: пустые содержания глав, заполненные из плана. */
  filled: "Заполнено содержаний глав",
  /** `keptIntents`: текст автора, который план не тронул. */
  keptIntents: "Сохранено вашего текста",
} as const;

export const ROOM_LABELS = {
  shelf: "Полка",
  book: "Книга",
  studio: "Мастерская",
  styles: "Профили стиля",
  costs: "Расходы",
} as const;

/** Временные поля досье и содержание главы (до экрана досье этапа 3). */
export const DOSSIER_LABELS = {
  section: "Досье",
  premise: "Синопсис",
  derivedPremise: "Сейчас модель видит синопсис из замысла:",
  world: "Мир",
  chapterContent: "Содержание главы",
  save: "Сохранить",
  cancel: "Отмена",
  edit: "Изменить",
  /** Счётчик символов под полем: «1234 / 20000». */
  charCount: (n: number, max: number) => `${n} / ${max}`,
  writeFromContent: "Будет написано по содержанию главы",
  writeFromPrevious: "Содержания нет — модель продолжит от прошлой главы",
} as const;

/** План сцен главы для нашей модели (панель плана). */
export const SCENE_PLAN_LABELS = {
  title: "План сцен",
  hint: "Модель пишет около 600 слов на сцену; на сцену нужно 6–8 событий, по одному в строке.",
  generate: "Составить план сцен",
  generating: "Составляю план сцен…",
  jobLabel: "Составляет план сцен",
  save: "Сохранить",
  clear: "Очистить",
  stale: "План сцен составлен по прежнему содержанию главы",
  confirmReplace: "Заменить правки?",
  errChanged:
    "План сцен изменился, пока составлялся новый: ваш план сохранён, составьте ещё раз при необходимости",
  errNothingToPlan:
    "Нечего разворачивать: заполните содержание главы или выберите план",
  errInvalidPlan:
    "В каждой сцене нужно от 3 до 10 событий, до 300 знаков каждое; сцен — от 1 до 12",
  sceneLabel: (n: number) => `Сцена ${n}`,
} as const;

/** Отказ сервера до потока Писателя, когда тело без `details.message`. */
export const WRITE_ERROR_LABELS: Record<string, string> = {
  local_model_unavailable: "Наша модель недоступна в Ollama: запустите Ollama и повторите.",
};

/** Письмо по частям: Claude идёт по беатам плана, наша модель — по сценам. */
export const WRITE_UNIT_LABELS = {
  beats: {
    resume: (n: number) => `Дописать с беата ${n}`,
    progress: (n: number, total: number) => `Пишет беат ${n} из ${total}`,
    jobProgress: (where: string, n: number, total: number) =>
      `Пишет главу${where} · беат ${n} из ${total}`,
    holding: "Дописывает беат…",
    jobHolding: (where: string) => `Дописывает беат и остановится · глава${where}`,
    hold: "Остановить после беата",
    held: "Остановлено после беата",
  },
  scenes: {
    resume: (n: number) => `Дописать со сцены ${n}`,
    progress: (n: number, total: number) => `Пишет сцену ${n} из ${total}`,
    jobProgress: (where: string, n: number, total: number) =>
      `Пишет главу${where} · сцена ${n} из ${total}`,
    holding: "Дописывает сцену…",
    jobHolding: (where: string) => `Дописывает сцену и остановится · глава${where}`,
    hold: "Остановить после сцены",
    held: "Остановлено после сцены",
  },
} as const;

/** Метка у питча или варианта плана, сочинённого локальной моделью.
 *  Принимает тег без префикса `ollama:`. */
export const localModelBadge = (tag: string): string => `локальная: ${tag}`;

/** `generatedBy` (`ollama:<тег>`) → текст метки; у материала Claude — `null`. */
export const generatedByBadge = (generatedBy: string | undefined): string | null =>
  generatedBy?.startsWith("ollama:") ? localModelBadge(generatedBy.slice("ollama:".length)) : null;

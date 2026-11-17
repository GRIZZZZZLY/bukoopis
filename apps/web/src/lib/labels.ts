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

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

export const ROOM_LABELS = {
  shelf: "Полка",
  book: "Книга",
  studio: "Мастерская",
  styles: "Профили стиля",
  costs: "Расходы",
} as const;

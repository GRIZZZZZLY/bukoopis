import { z } from "zod";

export const criticTypeSchema = z.enum([
  "canon",
  "style",
  "editor",
  "reader",
  /** Этап 5: характер, речь, отношения и границы знаний. Запускается только
   *  когда в сцене хотя бы двое названных участников — на монологе вызов
   *  тратится впустую. */
  "character",
]);
export type CriticType = z.infer<typeof criticTypeSchema>;

export const issueSeveritySchema = z.enum([
  "blocking",
  "suggestion",
  "nit",
]);
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;

/** Категории критика персонажей. `interchangeable` — герои взаимозаменяемы;
 *  ей нужны примеры МИНИМУМ ДВУХ персонажей (AC-28), иначе это не
 *  взаимозаменяемость, а впечатление. */
export const CHARACTER_ISSUE_CATEGORIES = [
  /** Двое ведут себя и говорят одинаково. */
  "interchangeable",
  /** Поведение противоречит принятому профилю. */
  "out_of_character",
  /** Герой пользуется тем, чего на границе сцены не знает. */
  "knowledge_breach",
  /** Отношение в сцене не сходится с принятым. */
  "relationship_drift",
  /** Речь не отличается от речи нарратора или других героев. */
  "flat_voice",
  /** Поступок непривычен — но не запрещён. Отделяется от knowledge_breach
   *  намеренно: «странно» и «невозможно» — разные вердикты. */
  "unusual_but_allowed",
] as const;
export const characterIssueCategorySchema = z.enum(CHARACTER_ISSUE_CATEGORIES);
export type CharacterIssueCategory = z.infer<typeof characterIssueCategorySchema>;

export const critiqueIssueSchema = z.object({
  severity: issueSeveritySchema,
  summary: z.string().min(1),
  excerpt: z.string().nullable().optional(),
  suggestion: z.string().nullable().optional(),

  // Поля критика персонажей (ТЗ 10). Необязательные ЗДЕСЬ и обязательные в
  // `characterIssueToolSchema`: у четырёх действующих критиков их нет и не
  // будет, а сделав их обязательными в общей схеме, мы перестали бы читать
  // все прежние сохранённые отчёты.
  category: characterIssueCategorySchema.nullable().optional(),
  /** Кого касается — каноническими именами. */
  affectedCharacters: z.array(z.string()).optional(),
  /** На чём основано: профиль, событие, отношение или сравнение реплик. */
  basis: z.string().nullable().optional(),
  /** Почему это существенно именно в этой сцене. */
  whyHere: z.string().nullable().optional(),
  /** Допустимое другое прочтение, если поведение неоднозначно. */
  alternativeReading: z.string().nullable().optional(),
  /** Что в этом месте стоит сохранить при правке. */
  keep: z.string().nullable().optional(),
});
export type CritiqueIssue = z.infer<typeof critiqueIssueSchema>;

export const criticReportSchema = z.object({
  critic: criticTypeSchema,
  overallNotes: z.string().min(1),
  issues: z.array(critiqueIssueSchema),
});
export type CriticReport = z.infer<typeof criticReportSchema>;

export const critiqueReportStatusSchema = z.enum([
  "pending",
  "done",
  "partial",
  "error",
]);
export type CritiqueReportStatus = z.infer<typeof critiqueReportStatusSchema>;

/** Все критики по умолчанию. Единственный перечень: от него считается статус
 *  разбора, его же использует граф критики и панель в редакторе. */
export const ALL_CRITIC_TYPES = [
  "canon",
  "style",
  "editor",
  "reader",
  "character",
] as const satisfies readonly CriticType[];

/**
 * Что критик персонажей ОБЯЗАН прислать (ТЗ 10). Цитата и основание здесь не
 * необязательные: замечание без них — впечатление, а его автор не проверит.
 *
 * Взаимозаменяемость требует минимум двух персонажей: одинаковая длина
 * реплик, общая профессия и слово «ладно» у одного героя основанием не
 * являются (AC-28).
 */
export const characterIssueToolSchema = critiqueIssueSchema
  .extend({
    excerpt: z.string().min(1),
    suggestion: z.string().min(1),
    category: characterIssueCategorySchema,
    affectedCharacters: z.array(z.string().min(1)).min(1).max(6),
    basis: z.string().min(1),
    whyHere: z.string().min(1),
    alternativeReading: z.string().nullable(),
    keep: z.string().nullable(),
  })
  .refine(
    (i) => i.category !== "interchangeable" || i.affectedCharacters.length >= 2,
    {
      message:
        "Взаимозаменяемость показывается на двоих: назовите обоих героев в affectedCharacters",
      path: ["affectedCharacters"],
    },
  );
export type CharacterIssueToolResult = z.infer<typeof characterIssueToolSchema>;

export const fullCritiqueReportSchema = z.object({
  critics: z.array(criticReportSchema),
  /** Кого просили проверить. Статус прогона считается от этого списка, а не
   *  от длины списка успешных отчётов: четыре падения из четырёх когда-то
   *  давали «всё хорошо». */
  requestedCritics: z.array(criticTypeSchema).default([]),
  failedCritics: z.array(criticTypeSchema).default([]),
  /** Кого не запускали, хотя могли бы: критик персонажей на сцене с одним
   *  героем. Не ошибка и не успех — третье состояние, и панель обязана его
   *  показать, иначе непроверенное выглядит проверенным (ТЗ 10). */
  skippedCritics: z.array(criticTypeSchema).default([]),
  blockingCount: z.number().int().nonnegative(),
  suggestionCount: z.number().int().nonnegative(),
  nitCount: z.number().int().nonnegative(),
  generatedAt: z.string(),
  /** Этап 4: отпечаток набора источников, с которым критика собирала
   *  контекст, и сравнение с отпечатком, с которым версия писалась.
   *  `baseChanged` — true: база уехала (герои, план, предыдущие главы), и
   *  часть замечаний может быть следствием этого, а не ошибки писателя;
   *  false: та же база; null: версия не из Writer'а, сравнивать нечем.
   *  Необязательные: отчёты до этапа 4 их не несут. */
  contextFingerprint: z.string().optional(),
  baseChanged: z.boolean().nullable().optional(),
});
export type FullCritiqueReport = z.infer<typeof fullCritiqueReportSchema>;

export const critiqueReportSchema = z.object({
  id: z.number().int().positive(),
  chapterVersionId: z.number().int().positive(),
  status: critiqueReportStatusSchema,
  report: fullCritiqueReportSchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CritiqueReport = z.infer<typeof critiqueReportSchema>;

export const runCritiqueInputSchema = z.object({
  // optional override of which critics to run; default = all 4
  critics: z.array(criticTypeSchema).min(1).optional(),
});
export type RunCritiqueInput = z.infer<typeof runCritiqueInputSchema>;

/**
 * Устойчивый идентификатор замечания: критик и его позиция в списке. Своего
 * поля у замечания нет и не заводится — отчёт хранится одним JSON, порядок
 * внутри критика не меняется, а колонка с идентификаторами потребовала бы
 * миграции ради того, что и так однозначно. Считают его ОБА конца — сервер и
 * экран, — поэтому функция одна на проект.
 */
export function issueIdFor(critic: CriticType, index: number): string {
  return `${critic}:${index}`;
}

/** Короткий фрагмент («Да.», «— Нет.») встречается в главе много раз, и
 *  защитить им нечего: сервер откажется его привязывать. Предел отсекает
 *  заведомо бесполезное до вызова модели. */
export const MIN_PROTECTED_FRAGMENT_CHARS = 12;

export const runRepairInputSchema = z
  .object({
  // optional override: only address selected severity levels
  severities: z.array(issueSeveritySchema).min(1).optional(),
  /** Только эти замечания. Пустой список не принимается: «ничего не выбрал»
   *  и «выбрал ноль» — разные намерения, и второе бессмысленно. */
  selectedIssueIds: z.array(z.string().min(1)).min(1).optional(),
  /** Куски, которых правка не касается (AC-29). Дословные цитаты: сервер сам
   *  находит их в тексте версии, как и доказательство события. */
  protectedFragments: z
    .array(z.string().trim().min(MIN_PROTECTED_FRAGMENT_CHARS))
    .min(1)
    .max(20)
    .optional(),
  /** Отчёт, в котором автор выбирал замечания. Номер замечания — индекс
   *  внутри критика, и в новом отчёте `style:0` — уже другое замечание:
   *  без привязки правка исправляла не то, что автор прочитал (F16 ревью
   *  2026-09-22). Поэтому при выборе он обязателен. */
  reportId: z.number().int().positive().optional(),
  })
  .refine((v) => v.selectedIssueIds === undefined || v.reportId !== undefined, {
    message: "selectedIssueIds требует reportId",
    path: ["reportId"],
  });
export type RunRepairInput = z.infer<typeof runRepairInputSchema>;

export const REPAIR_BRANCH_PREFIX = "repair-";
export const REPAIR_MAX_ITERATIONS = 3;

export const CRITIC_LABELS: Record<CriticType, string> = {
  canon: "Хранитель канона",
  style: "Стиль",
  editor: "Редактор",
  reader: "Читатель",
  character: "Персонажи",
};

export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  blocking: "серьёзно",
  suggestion: "заметно",
  nit: "мелочь",
};

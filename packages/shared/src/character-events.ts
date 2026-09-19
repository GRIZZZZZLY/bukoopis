import { z } from "zod";

/** События персонажа (ТЗ индивидуальности, разделы 5.4, 6, 12).
 *
 *  Одна таблица вместо второй независимой таблицы знаний: знание — это вид
 *  события, а не отдельная сущность. Иначе у чтения в контекст два источника
 *  истины, и они расходятся на первой же правке.
 *
 *  Схема данных события — схема ЧТЕНИЯ: `normalizeEventData` вызывается на
 *  строке из базы и не бросает никогда. Пределы размеров живут в схеме
 *  извлечения, которая применяется к ответу модели. Тот же раздел, что у
 *  профиля персонажа V2. */

export const CHARACTER_EVENT_KINDS = [
  /** Герой узнал что-то. Читается на границе сцены. */
  "knowledge",
  /** Эпизодическое состояние: усталость, раздражение, намерение уйти. */
  "state",
  /** Сдвиг отношения к другому герою. Всегда гипотеза, см. ниже. */
  "relation_shift",
  /** Обещание, долг, взятое обязательство. */
  "commitment",
] as const;
export const characterEventKindSchema = z.enum(CHARACTER_EVENT_KINDS);
export type CharacterEventKind = z.infer<typeof characterEventKindSchema>;

/** Как герой получил сведение. Убеждение может быть ложным — это не меняет
 *  объективный канон книги (раздел 5.4, AC-09). */
export const ACQUISITION_MODES = [
  "observed",
  "told",
  "inferred",
  "believed",
  /** Не записано. Умолчание и состояние перенесённых знаний: у ручной записи
   *  происхождения нет, и `observed` вместо него — выдумка ровно того рода,
   *  которую запрещает INV-07. Извлекателю этот вариант не предлагается. */
  "unknown",
] as const;
export const acquisitionModeSchema = z.enum(ACQUISITION_MODES);
export type AcquisitionMode = z.infer<typeof acquisitionModeSchema>;

export const ACQUISITION_LABELS: Record<AcquisitionMode, string> = {
  observed: "видел сам",
  told: "со слов",
  inferred: "догадался",
  believed: "верит",
  unknown: "",
};

export const EVENT_ORIGINS = ["manual", "llm", "accepted_prose", "migration"] as const;
export const eventOriginSchema = z.enum(EVENT_ORIGINS);
export type EventOrigin = z.infer<typeof eventOriginSchema>;

/** `derived` — извлечено из принятого текста и активно. `proposed` — гипотеза,
 *  ждёт автора и в контекст не идёт. `confirmed` — автор подтвердил.
 *  `rejected` — автор отклонил.
 *
 *  `rejected` сегодня не пишет НИКТО, и это не упущение: событие с
 *  несошедшимся доказательством строки не получает вовсе (`persistCharacterEvents`
 *  считает его в `rejectedEvidence` и не вставляет). Значение ждёт ручного
 *  отклонения на экране персонажа. */
export const EVENT_VERIFICATIONS = ["derived", "proposed", "confirmed", "rejected"] as const;
export const eventVerificationSchema = z.enum(EVENT_VERIFICATIONS);
export type EventVerification = z.infer<typeof eventVerificationSchema>;

/** Виды, которые активируются сами. Всё, что меняет длительные отношения,
 *  ценности или принципы, остаётся гипотезой: одна резкая реплика не делает
 *  «презирает всех» фактом (AC-26, раздел 12). */
export function defaultVerificationFor(kind: CharacterEventKind): EventVerification {
  return kind === "relation_shift" ? "proposed" : "derived";
}

const line = z.string().nullable().default(null);

/** Позиция главы (как её видит автор: первая — 1), необязательная. Поля с
 *  суффиксом `ChapterOrder` по всей ветке означают позицию, а не разрежённый
 *  `order_index`; общий конструктор держит их одинаковыми — три копии одного
 *  описания разъезжаются на первой же правке. */
const chapterOrderField = (): z.ZodDefault<
  z.ZodNullable<z.ZodNumber>
> => z.number().int().nonnegative().nullable().default(null);

export const knowledgeDataSchema = z.object({
  fact: z.string().default(""),
  acquisition: acquisitionModeSchema.default("unknown"),
  /** Откуда узнал — человек, документ, наблюдение. */
  source: line,
  /** Ссылка на объективный факт книги, если он есть. Знание может
   *  существовать и без него: герой верит тому, чего не было. */
  canonFactId: z.number().int().positive().nullable().default(null),
  /** Порядок главы, с которой сведение опровергнуто. */
  disprovedFromChapterOrder: chapterOrderField(),
});
export type KnowledgeData = z.infer<typeof knowledgeDataSchema>;

/** Область действия эпизодического состояния. `unknown` — честный ответ,
 *  когда течение времени неизвестно; выдумывать точный уровень усталости
 *  запрещено (раздел 5.4, AC-34). */
export const STATE_SCOPES = ["scene", "chapter", "until_resolved", "unknown"] as const;
export const stateScopeSchema = z.enum(STATE_SCOPES);

export const stateDataSchema = z.object({
  state: z.string().default(""),
  scope: stateScopeSchema.default("unknown"),
  endsAtChapterOrder: chapterOrderField(),
  endCondition: line,
});
export type StateData = z.infer<typeof stateDataSchema>;

export const relationShiftDataSchema = z.object({
  quality: z.string().default(""),
  from: line,
  to: line,
});
export type RelationShiftData = z.infer<typeof relationShiftDataSchema>;

export const commitmentDataSchema = z.object({
  commitment: z.string().default(""),
  toWhom: line,
  dueByChapterOrder: chapterOrderField(),
});
export type CommitmentData = z.infer<typeof commitmentDataSchema>;

const DATA_SCHEMAS = {
  knowledge: knowledgeDataSchema,
  state: stateDataSchema,
  relation_shift: relationShiftDataSchema,
  commitment: commitmentDataSchema,
} as const;

export type EventDataFor<K extends CharacterEventKind> = z.infer<
  (typeof DATA_SCHEMAS)[K]
>;

/** Приводит данные события к форме его вида. Никогда не бросает: вызывается
 *  на чтении строки. Значение не той формы заменяется значением по умолчанию,
 *  а не роняет список событий героя. */
export function normalizeEventData<K extends CharacterEventKind>(
  kind: K,
  raw: unknown,
): EventDataFor<K> {
  const schema = DATA_SCHEMAS[kind];
  const source =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data as EventDataFor<K>;

  // Разбираем по полю: валидное сохраняем, невалидное заменяем умолчанием.
  const salvaged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(schema.shape, key)) continue;
    const field = (schema.shape as Record<string, z.ZodTypeAny>)[key];
    if (field && field.safeParse(value).success) salvaged[key] = value;
  }
  return schema.parse(salvaged) as EventDataFor<K>;
}

export const characterEventSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  subjectCharacterId: z.number().int().positive(),
  addresseeCharacterId: z.number().int().positive().nullable(),
  kind: characterEventKindSchema,
  /** Форма зависит от вида, поэтому здесь `unknown`, а читают через
   *  `normalizeEventData`. Побочный эффект, о который спотыкаются: в выводе
   *  TypeScript ключ выходит необязательным (`data?: unknown`) — так zod
   *  описывает `unknown`, хотя при разборе поле требуется. Менять тип ради
   *  этого нечем: всё, что даёт обязательный ключ, ломает `z.toJSONSchema`. */
  data: z.unknown(),
  chapterId: z.number().int().positive().nullable(),
  sceneOrdinal: z.number().int().nonnegative(),
  sourceVersionId: z.number().int().positive().nullable(),
  evidenceQuote: z.string().nullable(),
  evidenceStart: z.number().int().nonnegative().nullable(),
  evidenceEnd: z.number().int().nonnegative().nullable(),
  origin: eventOriginSchema,
  verification: eventVerificationSchema,
  createdAt: z.string(),
});
export type CharacterEvent = z.infer<typeof characterEventSchema>;

/** Обязательное содержательное поле каждого вида. Пустое значение проходит
 *  схему чтения (там всё с умолчаниями) и превращается в пустую карточку,
 *  поэтому на извлечении оно требуется явно. */
const REQUIRED_DATA_FIELD: Record<CharacterEventKind, string> = {
  knowledge: "fact",
  state: "state",
  relation_shift: "quality",
  commitment: "commitment",
};

/** Форма, которую возвращает извлекатель. Доказательство обязательно: без
 *  цитаты проверить событие нечем, а непроверяемое событие не активируется
 *  (AC-25).
 *
 *  Диапазона здесь НЕТ намеренно. Модель не умеет считать позиции символов
 *  в главе на двадцать тысяч знаков, а `slice(start, end) === quote` не
 *  прощает промаха на единицу — требование диапазона давало почти стопроцентный
 *  отказ, неотличимый от «модель ничего не нашла». Цитату ищет сервер. */
export const extractedCharacterEventSchema = z
  .object({
    /** Имя героя как в главе; сервер сопоставляет его резолвером. */
    subjectName: z.string().min(1).max(160),
    addresseeName: z.string().min(1).max(160).nullable().optional(),
    kind: characterEventKindSchema,
    data: z.record(z.string(), z.unknown()),
    evidenceQuote: z.string().min(1).max(2000),
  })
  .superRefine((e, ctx) => {
    if (!DATA_SCHEMAS[e.kind].safeParse(e.data).success) {
      ctx.addIssue({
        code: "custom",
        message: `данные не подходят виду события ${e.kind}`,
        path: ["data"],
      });
      return;
    }
    // `z.object` срезает незнакомые ключи, а все известные имеют умолчания,
    // поэтому проверка выше пропускает `data` с выдуманными именами полей:
    // событие ляжет в базу и прочитается пустой карточкой.
    const required = REQUIRED_DATA_FIELD[e.kind];
    const value = e.data[required];
    if (typeof value !== "string" || value.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `для вида ${e.kind} обязательно поле "${required}"`,
        path: ["data", required],
      });
    }
    // Умолчание `observed` означало бы «герой видел сам» всякий раз, когда
    // модель поле забыла, — ровно та всеведущая оптика, которую этап отменяет.
    if (e.kind === "knowledge") {
      const acquisition = e.data["acquisition"];
      if (acquisition === undefined) {
        ctx.addIssue({
          code: "custom",
          message: 'для knowledge обязательно поле "acquisition"',
          path: ["data", "acquisition"],
        });
      } else if (acquisition === "unknown") {
        // `unknown` существует для перенесённых авторских записей, у которых
        // происхождения нет. Извлекателю он не предлагается: иначе это
        // готовая лазейка — пометить так всё, чего не разобрал.
        ctx.addIssue({
          code: "custom",
          message: 'извлекателю значение "unknown" недоступно',
          path: ["data", "acquisition"],
        });
      }
    }
  });
export type ExtractedCharacterEvent = z.infer<typeof extractedCharacterEventSchema>;

/**
 * Эпизодическое состояние для контекста персонажа. Читается на границе сцены.
 * Состояния подразделяются на свежие (наблюдались в поздней главе) и давние
 * (давно). Давнее состояние выглядит как наблюдение из прошлого, свежее —
 * как текущее положение дел.
 */
export interface ActiveState {
  subjectCharacterId: number;
  state: string;
  endCondition: string | null;
  /** Порядковый номер главы, где состояние наблюдалось: 1 — первая глава
   *  книги. Не `order_index`: тот разрежённый, у девятой главы он 90.
   *  `null` — состояние введено вручную и к главе не привязано. */
  observedAtChapterOrder: number | null;
  /** Определяет, как состояние описывается в контексте. */
  certainty: "fresh" | "stale";
}

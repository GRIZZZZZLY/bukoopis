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
export const ACQUISITION_MODES = ["observed", "told", "inferred", "believed"] as const;
export const acquisitionModeSchema = z.enum(ACQUISITION_MODES);
export type AcquisitionMode = z.infer<typeof acquisitionModeSchema>;

export const ACQUISITION_LABELS: Record<AcquisitionMode, string> = {
  observed: "видел сам",
  told: "со слов",
  inferred: "догадался",
  believed: "верит",
};

export const EVENT_ORIGINS = ["manual", "llm", "accepted_prose", "migration"] as const;
export const eventOriginSchema = z.enum(EVENT_ORIGINS);
export type EventOrigin = z.infer<typeof eventOriginSchema>;

/** `derived` — извлечено из принятого текста и активно. `proposed` — гипотеза,
 *  ждёт автора и в контекст не идёт. `confirmed` — автор подтвердил.
 *  `rejected` — автор отклонил либо доказательство не сошлось (AC-25). */
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

export const knowledgeDataSchema = z.object({
  fact: z.string().default(""),
  acquisition: acquisitionModeSchema.default("observed"),
  /** Откуда узнал — человек, документ, наблюдение. */
  source: line,
  /** Ссылка на объективный факт книги, если он есть. Знание может
   *  существовать и без него: герой верит тому, чего не было. */
  canonFactId: z.number().int().positive().nullable().default(null),
  /** Порядок главы, с которой сведение опровергнуто. */
  disprovedFromChapterOrder: z.number().int().nonnegative().nullable().default(null),
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
  endsAtChapterOrder: z.number().int().nonnegative().nullable().default(null),
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
  dueByChapterOrder: z.number().int().nonnegative().nullable().default(null),
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

/** Форма, которую возвращает извлекатель. Доказательство обязательно: без
 *  цитаты и диапазона проверить событие нечем, а непроверяемое событие не
 *  активируется (AC-25). */
export const extractedCharacterEventSchema = z
  .object({
    /** Имя героя как в главе; сервер сопоставляет его резолвером. */
    subjectName: z.string().min(1).max(160),
    addresseeName: z.string().min(1).max(160).nullable().optional(),
    kind: characterEventKindSchema,
    data: z.record(z.string(), z.unknown()),
    evidenceQuote: z.string().min(1).max(2000),
    evidenceStart: z.number().int().nonnegative(),
    evidenceEnd: z.number().int().nonnegative(),
  })
  .refine((e) => e.evidenceEnd > e.evidenceStart, {
    message: "конец диапазона должен быть больше начала",
    path: ["evidenceEnd"],
  })
  .superRefine((e, ctx) => {
    if (!DATA_SCHEMAS[e.kind].safeParse(e.data).success) {
      ctx.addIssue({
        code: "custom",
        message: `данные не подходят виду события ${e.kind}`,
        path: ["data"],
      });
    }
  });
export type ExtractedCharacterEvent = z.infer<typeof extractedCharacterEventSchema>;

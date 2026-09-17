import { z } from "zod";

/** Профиль персонажа V2 (ТЗ индивидуальности, раздел 5.1).
 *
 *  Схем две, и это не дублирование.
 *  `characterProfileV2Schema` — схема ЧТЕНИЯ. Она не ограничивает длину и
 *  ничего не требует: её применяют к тому, что уже лежит в базе, и падение
 *  на ней означает, что книга перестала открываться. Тот же приём уже
 *  применён к повествовательным полям `bookOutlineVariantSchema`.
 *  `characterProfileWriteSchema` — схема ЗАПИСИ, с пределами; её применяют
 *  маршруты создания и изменения. */

export const ROLE_TIERS = ["main", "recurring", "episodic"] as const;
export const roleTierSchema = z.enum(ROLE_TIERS);
export type RoleTier = z.infer<typeof roleTierSchema>;

/** Неизвестно — это `null`, а не пустая строка: «сведений нет» и «автор
 *  стёр текст» — разные события (раздел 5.1: отсутствие сведений не равно
 *  отсутствию качества). */
const line = z.string().nullable().default(null);

export const characterGoalSchema = z.object({
  goal: z.string(),
  horizon: z.enum(["long", "current"]).default("current"),
  conflictsWith: z.string().nullable().default(null),
});

export const characterValueSchema = z.object({
  value: z.string(),
  priority: z.number().int().nullable().default(null),
  context: line,
  price: line,
});

export const characterPrincipleSchema = z.object({
  rule: z.string(),
  scope: line,
  exceptions: line,
  cost: line,
});

export const characterStrategiesSchema = z.object({
  asks: line,
  refuses: line,
  defends: line,
  persuades: line,
  cares: line,
  argues: line,
});

export const characterEverydaySchema = z.object({
  attachments: line,
  pleasure: line,
  irritation: line,
  habits: line,
  humour: line,
});

export const characterPerceptionSchema = z.object({
  noticesFirst: line,
  misses: line,
  explainsBy: line,
});

/** Профиль голоса — часть карточки. Банк образцов речи лежит отдельно
 *  (таблица `character_voice_samples`), см. `character-voice.ts`. */
export const voiceProfileSchema = z.object({
  lineLength: line,
  pauses: line,
  vocabulary: line,
  abstractness: line,
  jargon: line,
  agrees: line,
  refuses: line,
  asks: line,
  cares: line,
  irritated: line,
  humour: line,
  selfCensorship: line,
  tabooTopics: line,
  /** Различия речи по собеседнику: ключ — ситуация из
   *  `VOICE_SAMPLE_SITUATIONS`, значение — короткое описание регистра. */
  registers: z.record(z.string(), z.string()).default({}),
  underStress: line,
  whenTired: line,
  whenSafe: line,
});
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const characterAuthorPlanSchema = z.object({
  arc: line,
  futureTrials: line,
  constraints: line,
});

export const characterProfileV2Schema = z.object({
  // `.default(2)` — не только для `normalizeCharacterProfile` (она и так
  // передаёт версию явно): схему держат задачи ниже по цепочке (4, 5, 7, 9,
  // 10), и прямой `.parse()` сырой V1-строки без нормализации не должен
  // валить книгу только потому, что поля версии в ней никогда не было.
  schemaVersion: z.literal(2).default(2),

  // V1: сохраняется дословно и навсегда (AC-01).
  description: z.string().default(""),
  want: line,
  need: line,
  lie: line,
  voice: line,
  appearance: line,
  arc: line,
  notes: line,

  // Поля кандидата Мастерской (AC-35). `name` дублирует
  // `characters.canonical_name` и остаётся тем, что предложила модель.
  name: line,
  role: line,
  age: line,
  background: line,

  // V2.
  roleTier: roleTierSchema.nullable().default(null),
  goals: z.array(characterGoalSchema).default([]),
  values: z.array(characterValueSchema).default([]),
  principles: z.array(characterPrincipleSchema).default([]),
  contradictions: z.array(z.string()).default([]),
  strategies: characterStrategiesSchema.default(() => characterStrategiesSchema.parse({})),
  everyday: characterEverydaySchema.default(() => characterEverydaySchema.parse({})),
  perception: characterPerceptionSchema.default(() => characterPerceptionSchema.parse({})),
  voiceProfile: voiceProfileSchema.default(() => voiceProfileSchema.parse({})),
  authorPlan: characterAuthorPlanSchema.default(() => characterAuthorPlanSchema.parse({})),

  /** Всё, чего схема не знает. Единственная гарантия, что нормализация
   *  никогда не теряет авторские сведения (INV-07). */
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type CharacterProfileV2 = z.infer<typeof characterProfileV2Schema>;

const KNOWN_KEYS = new Set(Object.keys(characterProfileV2Schema.shape));

/** Пределы для входящих данных. Всё, что не перечислено, наследуется от
 *  схемы чтения. */
export const characterProfileWriteSchema = characterProfileV2Schema.extend({
  description: z.string().max(20_000),
  notes: z.string().max(20_000).nullable().default(null),
  background: z.string().max(20_000).nullable().default(null),
  goals: z.array(characterGoalSchema).max(20).default([]),
  values: z.array(characterValueSchema).max(20).default([]),
  principles: z.array(characterPrincipleSchema).max(20).default([]),
  contradictions: z.array(z.string().max(2000)).max(20).default([]),
});

/** Приводит что угодно из базы, импорта или ответа модели к V2 без потерь.
 *  Никогда не бросает: вызывается на чтении строки. */
export function normalizeCharacterProfile(raw: unknown): CharacterProfileV2 {
  const base = characterProfileV2Schema.parse({ schemaVersion: 2 });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    // Не объект — сохранить как есть и не выдумывать описание.
    return raw === null || raw === undefined
      ? base
      : { ...base, extra: { raw } };
  }

  const source = raw as Record<string, unknown>;
  const known: Record<string, unknown> = {};
  // `Object.create(null)` — без этого литеральный ключ `__proto__` из строки
  // базы не становится собственным свойством, а меняет прототип аккумулятора,
  // и значение пропадает молча (та же потеря, что чинит блок ниже).
  const extra: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    if (key === "extra") continue;
    (KNOWN_KEYS.has(key) ? known : extra)[key] = value;
  }
  // `extra` предыдущей нормализации не теряется при повторном проходе. Раньше
  // ветка `else` отсутствовала: `extra`, пришедший строкой или массивом (а не
  // объектом кандидата), просто исчезал — та же потеря, что и с `__proto__`.
  const priorExtra = source["extra"];
  if (priorExtra !== undefined) {
    if (priorExtra && typeof priorExtra === "object" && !Array.isArray(priorExtra)) {
      Object.assign(extra, priorExtra as Record<string, unknown>);
    } else {
      extra["extra"] = priorExtra;
    }
  }

  const parsed = characterProfileV2Schema.safeParse({
    ...known,
    schemaVersion: 2,
  });
  if (parsed.success) return { ...parsed.data, extra };

  // Часть полей не той формы. Разбираем по одному: валидное — в профиль,
  // невалидное — в `extra`, чтобы автор увидел его и починил руками.
  const salvaged: Record<string, unknown> = { schemaVersion: 2 };
  for (const [key, value] of Object.entries(known)) {
    const field = characterProfileV2Schema.shape[
      key as keyof typeof characterProfileV2Schema.shape
    ];
    if (field && field.safeParse(value).success) salvaged[key] = value;
    else extra[key] = value;
  }
  return { ...characterProfileV2Schema.parse(salvaged), extra };
}

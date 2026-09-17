import { z } from "zod";

/** Направленные качества отношения A → B (ТЗ индивидуальности, раздел 5.3).
 *
 *  Направление A → B и направление B → A — две независимые строки
 *  `relationships` со своим `profile_json` каждая (INV-03). Симметричного
 *  графа здесь нет и не заводится.
 *
 *  Старые `type`, `tension`, `notes` остаются колонками таблицы и живут
 *  рядом. Новые качества из `tension` не вычисляются: «-0.9» не значит
 *  «боится», это разные сведения, и подмена одного другим — сочинение
 *  за автора. */

/** Неизвестно — это `null`, а не пустая строка: «сведений нет» и «автор
 *  стёр текст» — разные события. */
const line = z.string().nullable().default(null);

export const directedRelationshipSchema = z.object({
  // `.default(2)` — не только для `normalizeRelationshipProfile` (она и так
  // передаёт версию явно): задачи 4, 5, 9, 10 держат схему и могут `.parse()`
  // сырую строку из базы; падение на ней означает, что книга перестала
  // открываться.
  schemaVersion: z.literal(2).default(2),
  trust: line,
  respect: line,
  attachment: line,
  dependency: line,
  fear: line,
  duty: line,
  resentment: line,
  /** Чего A ждёт от B. */
  expectations: line,
  /** Предметы разногласий. */
  disputes: z.array(z.string()).default([]),
  /** Темы умолчания. */
  silences: z.array(z.string()).default([]),
  /** Характерный регистр общения A с B. */
  register: line,
  /** Всё, чего схема не знает. Единственная гарантия, что нормализация
   *  никогда не теряет авторские сведения (INV-07). */
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type DirectedRelationship = z.infer<typeof directedRelationshipSchema>;

export type RelationshipQualityKey =
  | "trust"
  | "respect"
  | "attachment"
  | "dependency"
  | "fear"
  | "duty"
  | "resentment"
  | "expectations"
  | "register";

export const RELATIONSHIP_QUALITY_LABELS: Record<RelationshipQualityKey, string> = {
  trust: "доверие",
  respect: "уважение",
  attachment: "привязанность",
  dependency: "зависимость",
  fear: "страх",
  duty: "долг",
  resentment: "обида",
  expectations: "чего ждёт",
  register: "манера общения",
};

export const directedRelationshipWriteSchema = directedRelationshipSchema.extend({
  trust: z.string().max(2000).nullable().default(null),
  respect: z.string().max(2000).nullable().default(null),
  attachment: z.string().max(2000).nullable().default(null),
  dependency: z.string().max(2000).nullable().default(null),
  fear: z.string().max(2000).nullable().default(null),
  duty: z.string().max(2000).nullable().default(null),
  resentment: z.string().max(2000).nullable().default(null),
  expectations: z.string().max(2000).nullable().default(null),
  register: z.string().max(2000).nullable().default(null),
  disputes: z.array(z.string().max(1000)).max(20).default([]),
  silences: z.array(z.string().max(1000)).max(20).default([]),
});

const KNOWN_KEYS = new Set(Object.keys(directedRelationshipSchema.shape));

/** Никогда не бросает: вызывается на чтении строки `relationships`. */
export function normalizeRelationshipProfile(raw: unknown): DirectedRelationship {
  const base = directedRelationshipSchema.parse({ schemaVersion: 2 });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    // Не объект — сохранить как есть и не выдумывать качества.
    return raw === null || raw === undefined ? base : { ...base, extra: { raw } };
  }

  const source = raw as Record<string, unknown>;
  const known: Record<string, unknown> = {};
  // `Object.create(null)` — без этого литеральный ключ `__proto__` из строки
  // базы не становится собственным свойством, а меняет прототип аккумулятора,
  // и значение пропадает молча.
  const extra: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    if (key === "extra") continue;
    (KNOWN_KEYS.has(key) ? known : extra)[key] = value;
  }
  // `extra` предыдущей нормализации не теряется при повторном проходе.
  // Non-object `extra` (строка, массив, число) сохраняется как `extra["extra"]`.
  const priorExtra = source["extra"];
  if (priorExtra !== undefined) {
    if (priorExtra && typeof priorExtra === "object" && !Array.isArray(priorExtra)) {
      Object.assign(extra, priorExtra as Record<string, unknown>);
    } else {
      extra["extra"] = priorExtra;
    }
  }

  const parsed = directedRelationshipSchema.safeParse({ ...known, schemaVersion: 2 });
  // `{ ...extra }`, а не сам аккумулятор: он живёт без прототипа только
  // внутри функции (см. выше), наружу должен уйти обычный объект.
  if (parsed.success) return { ...parsed.data, extra: { ...extra } };

  // Часть полей не той формы. Разбираем по одному: валидное — в профиль,
  // невалидное — в `extra`, чтобы автор увидел его и починил руками.
  const salvaged: Record<string, unknown> = { schemaVersion: 2 };
  for (const [key, value] of Object.entries(known)) {
    const field = directedRelationshipSchema.shape[
      key as keyof typeof directedRelationshipSchema.shape
    ];
    if (field && field.safeParse(value).success) salvaged[key] = value;
    else extra[key] = value;
  }
  return { ...directedRelationshipSchema.parse(salvaged), extra: { ...extra } };
}

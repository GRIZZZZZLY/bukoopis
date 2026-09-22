import { z } from "zod";

/**
 * Проверка различий состава (ТЗ индивидуальности, раздел 9.1, этап 5).
 *
 * Отчёт сравнивает не прилагательные, а РЕАКЦИИ на одинаковые ситуации.
 * Совпадение одной ценности — норма; проблема в систематически
 * взаимозаменяемых мотивировках, реакциях и речи.
 *
 * Каждое направление — предложение. Ничего не меняется автоматически, и
 * требовать сделать героев максимально противоположными нельзя: цель —
 * различимость, а не контраст.
 */

/** Ситуации, по которым сравниваются реакции. Список закрыт: свободная
 *  формулировка превращает отчёт в набор впечатлений, которые не сравнить
 *  между парами. */
export const CAST_CHECK_SITUATIONS = [
  "value_conflict",
  "request_for_help",
  "mistake",
  "pressure_from_authority",
  "talk_with_close",
] as const;
export const castCheckSituationSchema = z.enum(CAST_CHECK_SITUATIONS);
export type CastCheckSituation = z.infer<typeof castCheckSituationSchema>;

export const CAST_CHECK_SITUATION_LABELS: Record<CastCheckSituation, string> = {
  value_conflict: "конфликт ценностей",
  request_for_help: "просьба о помощи",
  mistake: "своя ошибка",
  pressure_from_authority: "давление начальника",
  talk_with_close: "разговор с близким",
};

/** Схема ЧТЕНИЯ: без пределов длины. Сохранённый отчёт не должен ронять
 *  экран этапа из-за длинной формулировки. */
export const castCheckPairSchema = z.object({
  characterIds: z.array(z.number().int().positive()),
  similarity: z.string(),
  basis: z.string(),
  situations: z.array(z.string()),
  directions: z.array(z.string()),
  keep: z.string(),
});
export type CastCheckPair = z.infer<typeof castCheckPairSchema>;

export const castCheckBasisEntrySchema = z.object({
  characterId: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
});
export type CastCheckBasisEntry = z.infer<typeof castCheckBasisEntrySchema>;

export const castCheckReportSchema = z.object({
  generatedAt: z.string(),
  /** Состав на момент проверки: герои и их ревизии. По нему видно, что отчёт
   *  описывает уже не тех героев, — иначе он старел бы молча. */
  basis: z.array(castCheckBasisEntrySchema),
  pairs: z.array(castCheckPairSchema),
  notes: z.string(),
});
export type CastCheckReport = z.infer<typeof castCheckReportSchema>;

/** Схема ОТВЕТА МОДЕЛИ: с пределами и без `basis` — состав на момент
 *  проверки знает сервер, и принять его от модели значит позволить ей
 *  назвать чужой. */
export const castCheckToolSchema = z
  .object({
    pairs: z
      .array(
        z
          .object({
            characterIds: z.array(z.number().int().positive()).length(2),
            similarity: z.string().min(1).max(600),
            basis: z.string().min(1).max(800),
            situations: z.array(castCheckSituationSchema).min(1).max(5),
            // Отчёт обязан предлагать выход: «похожи» без направления —
            // замечание, на которое автор ничего не может сделать.
            directions: z.array(z.string().min(1).max(400)).min(1).max(4),
            keep: z.string().min(1).max(400),
          })
          .refine((p) => p.characterIds[0] !== p.characterIds[1], {
            message: "пара — это два РАЗНЫХ героя",
            path: ["characterIds"],
          }),
      )
      .max(10),
    notes: z.string().min(1).max(1500),
  })
  .strict();
export type CastCheckToolResult = z.infer<typeof castCheckToolSchema>;

export interface CastMember {
  id: number;
  revision: number;
}

export function castCheckBasisOf(
  cast: ReadonlyArray<CastMember>,
): CastCheckBasisEntry[] {
  return cast.map((c) => ({ characterId: c.id, revision: c.revision }));
}

/** Отчёт описывает состав, которого уже нет: героя правили, добавили или
 *  удалили. Сравнение по паре «герой: ревизия», порядок не важен. */
export function isCastCheckStale(
  report: CastCheckReport,
  cast: ReadonlyArray<CastMember>,
): boolean {
  if (report.basis.length !== cast.length) return true;
  const now = new Map(cast.map((c) => [c.id, c.revision]));
  return report.basis.some((b) => now.get(b.characterId) !== b.revision);
}

interface CastProfileLike {
  role?: unknown;
  want?: unknown;
  need?: unknown;
  lie?: unknown;
  voice?: unknown;
  goals?: unknown;
  principles?: unknown;
  values?: unknown;
  contradictions?: unknown;
}

export interface CastForCheck {
  id: number;
  name: string;
  profile: CastProfileLike;
}

function line(label: string, value: unknown): string | null {
  return typeof value === "string" && value.trim() ? `${label}: ${value.trim()}` : null;
}

/** Главное поле элемента списка в профиле V2: цель — `goal`, ценность —
 *  `value`, принцип — `rule` (см. `character-profile.ts`); противоречия —
 *  простые строки. Прежде здесь ждали `{ text }`, которого в V2 нет вовсе, и
 *  непустые списки молча пропадали из промпта проверки. */
const LIST_ITEM_KEYS = ["goal", "value", "rule", "text"] as const;

function listLine(label: string, value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((v) => {
      if (typeof v === "string") return v.trim();
      if (v && typeof v === "object") {
        const rec = v as Record<string, unknown>;
        const key = LIST_ITEM_KEYS.find((k) => typeof rec[k] === "string");
        return key ? (rec[key] as string).trim() : "";
      }
      return "";
    })
    .filter((s) => s.length > 0);
  return items.length > 0 ? `${label}: ${items.join("; ")}` : null;
}

/**
 * Компактное описание принятого состава для модели. Печатаются те поля, по
 * которым и считается похожесть: чего герой хочет, чем не поступится, чем
 * дорожит и как говорит. Описание целиком сюда не идёт — на десяти героях
 * это страница текста, в которой совпадения тонут.
 */
export function renderCastForCheck(cast: ReadonlyArray<CastForCheck>): string {
  return cast
    .map((c) => {
      const rows = [
        line("Роль", c.profile.role),
        line("Хочет", c.profile.want),
        line("Нуждается", c.profile.need),
        line("Самообман", c.profile.lie),
        line("Голос", c.profile.voice),
        listLine("Цели", c.profile.goals),
        listLine("Принципы", c.profile.principles),
        listLine("Ценности", c.profile.values),
        listLine("Противоречия", c.profile.contradictions),
      ].filter((s): s is string => s !== null);
      return [`${c.id} — ${c.name}`, ...rows.map((r) => `  ${r}`)].join("\n");
    })
    .join("\n\n");
}

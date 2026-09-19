import { z } from "zod";
import { extractedCharacterEventSchema } from "./character-events.js";

/**
 * Phase 3 — temporal canon facts.
 *
 * A "fact" is one atomic, time-scoped statement about a canon entity, e.g.
 * (character "Аня", predicate "умеет", object "магия огня") valid from
 * chapter 5. The extractor proposes facts per chapter; the server owns the
 * temporal bookkeeping (valid_to / supersession) so the LLM never juggles IDs.
 */

export const factEntityTypeSchema = z.enum([
  "character",
  "location",
  "item",
  "world",
]);
export type FactEntityType = z.infer<typeof factEntityTypeSchema>;

/**
 * ADR 0003 slice 1 — how the chapter asserts the statement. Only
 * narrated_as_fact and directly_observed become OBJECTIVE canon;
 * everything else is stored but never fed to Writer as world truth and
 * never supersedes canon (a lying character must not rewrite reality).
 */
export const factAssertionModeSchema = z.enum([
  "narrated_as_fact",
  "directly_observed",
  "stated_by_character",
  "believed_by_character",
  "rumor",
  "dream_or_vision",
  "uncertain",
]);
export type FactAssertionMode = z.infer<typeof factAssertionModeSchema>;

export const OBJECTIVE_ASSERTION_MODES: ReadonlyArray<FactAssertionMode> = [
  "narrated_as_fact",
  "directly_observed",
];

export const extractedFactSchema = z.object({
  entityType: factEntityTypeSchema,
  /** Canonical-ish name as it appears in the chapter; server matches by it. */
  entityName: z.string().min(1).max(160),
  /** Short relation key: "умеет", "владеет", "находится", "состояние", … */
  predicate: z.string().min(1).max(80),
  /** The value/Object of the statement. */
  objectText: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1).default(1),
  assertionMode: factAssertionModeSchema.default("narrated_as_fact"),
  /** Ids (`fact_<id>`, as rendered in the active-facts list) of the active
   *  facts this statement replaces. When present, the server closes EXACTLY
   *  these; the same-predicate auto-supersede is only a fallback. */
  supersedesFactIds: z
    .array(z.string().regex(/^fact_\d+$/))
    .max(10)
    .default([]),
});
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

/**
 * Элемент, который схема не приняла, приходит как `null` и не валит весь
 * ответ. Строгий массив стоил слишком дорого: одно негодное событие — и
 * `safeParse` отвергал ВЕСЬ ответ, задание `facts` уходило в `error`, а глава
 * оставалась без фактов, без событий и без заметок. Отсев и подсчёт
 * отброшенного — на сервере (`extractFactsPayload`), потому что здесь, внутри
 * схемы, `.transform` представить в JSON Schema нечем, а по ней строится
 * инструмент модели.
 *
 * Предел длины массива намеренно остался жёстким: превышение означает, что
 * модель не поняла контракт, и тихо срезать хвост хуже, чем повторить вызов.
 */
const lenient = <T extends z.ZodType>(item: T) => item.nullable().catch(null);

export const canonFactExtractionSchema = z.object({
  facts: z.array(lenient(extractedFactSchema)).max(40),
  /** События персонажей идут тем же вызовом: отдельный вид задания потребовал
   *  бы пересборки `memory_jobs` (список видов зашит в SQL CHECK, решение 6
   *  ТЗ). Необязательное с умолчанием — старые staged-результаты в
   *  `result_json` продолжают разбираться. */
  characterEvents: z
    .array(lenient(extractedCharacterEventSchema))
    .max(30)
    .default([]),
  notes: z.string().nullable().optional(),
});
export type CanonFactExtraction = z.infer<typeof canonFactExtractionSchema>;

import { z } from "zod";

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

export const extractedFactSchema = z.object({
  entityType: factEntityTypeSchema,
  /** Canonical-ish name as it appears in the chapter; server matches by it. */
  entityName: z.string().min(1).max(160),
  /** Short relation key: "умеет", "владеет", "находится", "состояние", … */
  predicate: z.string().min(1).max(80),
  /** The value/Object of the statement. */
  objectText: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1).default(1),
});
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

export const canonFactExtractionSchema = z.object({
  facts: z.array(extractedFactSchema).max(40),
  notes: z.string().nullable().optional(),
});
export type CanonFactExtraction = z.infer<typeof canonFactExtractionSchema>;

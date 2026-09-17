import { z } from "zod";

/** Банк образцов речи (ТЗ индивидуальности, раздел 5.2).
 *
 *  Отбор обязан быть детерминированным при одинаковых входах: образцы едят
 *  в кэшируемый префикс промпта Writer'а, и `ORDER BY random()` там уже
 *  однажды стоил полного промаха кэша на каждую генерацию
 *  (см. `style-context.ts`). Здесь случайности нет ни в одном виде. */

export const VOICE_SAMPLE_SITUATIONS = [
  "neutral",
  "conflict",
  "vulnerable",
  "authority",
  "intimate",
  "stranger",
] as const;
export const voiceSampleSituationSchema = z.enum(VOICE_SAMPLE_SITUATIONS);
export type VoiceSampleSituation = z.infer<typeof voiceSampleSituationSchema>;

/** Подписи для интерфейса: внутренний код латиницей в русском экране не
 *  показывается (тот же разбор, что у `ASPECT_STATUS_LABEL`). */
export const VOICE_SITUATION_LABELS: Record<VoiceSampleSituation, string> = {
  neutral: "обычный разговор",
  conflict: "конфликт",
  vulnerable: "уязвимость",
  authority: "с начальником",
  intimate: "с близким",
  stranger: "с незнакомцем",
};

export const VOICE_SAMPLE_ORIGINS = ["author", "accepted_prose", "llm"] as const;
export const voiceSampleOriginSchema = z.enum(VOICE_SAMPLE_ORIGINS);
export type VoiceSampleOrigin = z.infer<typeof voiceSampleOriginSchema>;

export const VOICE_SAMPLE_STATUSES = ["proposed", "accepted", "rejected"] as const;
export const voiceSampleStatusSchema = z.enum(VOICE_SAMPLE_STATUSES);
export type VoiceSampleStatus = z.infer<typeof voiceSampleStatusSchema>;

export const characterVoiceSampleSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  characterId: z.number().int().positive(),
  text: z.string(),
  situation: voiceSampleSituationSchema,
  addresseeCharacterId: z.number().int().positive().nullable(),
  note: z.string().nullable(),
  origin: voiceSampleOriginSchema,
  status: voiceSampleStatusSchema,
  sourceVersionId: z.number().int().positive().nullable(),
  /** Порядок главы-источника. Нужен, чтобы образец из главы 12 не утёк в
   *  подготовку главы 4 (раздел 5.2). */
  sourceChapterOrder: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CharacterVoiceSample = z.infer<typeof characterVoiceSampleSchema>;

export const createVoiceSampleInputSchema = z.object({
  text: z.string().min(1).max(2000),
  situation: voiceSampleSituationSchema,
  addresseeCharacterId: z.number().int().positive().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  origin: voiceSampleOriginSchema.default("author"),
  status: voiceSampleStatusSchema.optional(),
  sourceVersionId: z.number().int().positive().nullable().optional(),
  sourceChapterOrder: z.number().int().nonnegative().nullable().optional(),
});
export type CreateVoiceSampleInput = z.infer<typeof createVoiceSampleInputSchema>;

export const updateVoiceSampleInputSchema = z.object({
  status: voiceSampleStatusSchema,
});
export type UpdateVoiceSampleInput = z.infer<typeof updateVoiceSampleInputSchema>;

export interface VoiceSampleSelection {
  situation: VoiceSampleSituation;
  addresseeCharacterId?: number | null;
  /** Граница сцены. Образец, взятый из главы с этим порядком или позже,
   *  отбрасывается. `null`/`undefined` — границы нет. */
  beforeChapterOrder?: number | null;
  limit?: number;
}

/** Отбор образцов: только принятые, только не из будущего, дальше —
 *  релевантность и стабильный порядок по id. Случайности нет. */
export function selectVoiceSamples(
  samples: CharacterVoiceSample[],
  selection: VoiceSampleSelection,
): CharacterVoiceSample[] {
  const limit = selection.limit ?? 3;
  const boundary = selection.beforeChapterOrder ?? null;
  const scored = samples
    .filter((s) => s.status === "accepted")
    .filter(
      (s) =>
        boundary === null ||
        s.sourceChapterOrder === null ||
        s.sourceChapterOrder < boundary,
    )
    .map((s) => {
      let score = 0;
      if (s.situation === selection.situation) score += 4;
      if (
        selection.addresseeCharacterId != null &&
        s.addresseeCharacterId === selection.addresseeCharacterId
      ) {
        score += 3;
      }
      if (s.origin === "author") score += 1;
      return { sample: s, score };
    })
    .filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score || a.sample.id - b.sample.id);
  return scored.slice(0, limit).map((x) => x.sample);
}

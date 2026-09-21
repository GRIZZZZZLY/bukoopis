import { z } from "zod";

// ─────────── Style fingerprint ───────────
//
// Output of the Style Extractor agent. A compact structured description of
// the author's voice and rhythm. Stored as JSON; injected into Writer's
// system prompt (compressed to ~500-800 tokens).

export const sentenceLengthDistributionSchema = z.object({
  meanWords: z.number().nonnegative(),
  medianWords: z.number().nonnegative(),
  shortShare: z.number().min(0).max(1), // <8 words
  mediumShare: z.number().min(0).max(1), // 8-20 words
  longShare: z.number().min(0).max(1), // >20 words
});
export type SentenceLengthDistribution = z.infer<
  typeof sentenceLengthDistributionSchema
>;

export const densityProfileSchema = z.object({
  dialogue: z.number().min(0).max(1),
  description: z.number().min(0).max(1),
  action: z.number().min(0).max(1),
  introspection: z.number().min(0).max(1),
});
export type DensityProfile = z.infer<typeof densityProfileSchema>;

export const styleFingerprintSchema = z.object({
  language: z.string().min(1),
  voiceSummary: z.string().min(1),
  sentenceLengths: sentenceLengthDistributionSchema,
  density: densityProfileSchema,
  paragraphRhythm: z.string().min(1),
  sceneOpenings: z.string().min(1),
  sceneClosings: z.string().min(1),
  tense: z.enum(["present", "past", "mixed"]),
  metaphorFamilies: z.array(z.string()).max(20),
  signatureSyntax: z.array(z.string()).max(20),
  signatureTropes: z.array(z.string()).max(20),
  thingsToImitate: z.array(z.string()).max(15),
  thingsToAvoid: z.array(z.string()).max(15),
});
export type StyleFingerprint = z.infer<typeof styleFingerprintSchema>;

/**
 * How non-dialogue prose divides. Proportions relative to each other, not to
 * the whole text — the dialogue share is measured from the corpus and the four
 * densities are composed from both.
 */
export const narrativeMixSchema = z.object({
  description: z.number().min(0).max(1),
  action: z.number().min(0).max(1),
  introspection: z.number().min(0).max(1),
});
export type NarrativeMix = z.infer<typeof narrativeMixSchema>;

/**
 * What the Style Extractor is actually asked to produce. Sentence-length
 * statistics and the dialogue share are measured from the corpus in
 * style-engine, not estimated by the model; `language` is known from the
 * profile. The stored fingerprint is assembled from both halves.
 */
export const styleFingerprintLlmSchema = styleFingerprintSchema
  .omit({ language: true, sentenceLengths: true, density: true })
  .extend({ narrativeMix: narrativeMixSchema });
export type StyleFingerprintLlm = z.infer<typeof styleFingerprintLlmSchema>;

export const fatigueWordsSchema = z.object({
  // Words/phrases the writer should avoid for this style. Weighted by harm.
  blacklist: z.array(z.string()).default([]),
  softWarn: z.array(z.string()).default([]),
});
export type FatigueWords = z.infer<typeof fatigueWordsSchema>;

// ─────────── Style blend ───────────
//
// A blend profile is synthesized from two or more extracted profiles instead
// of from a corpus. It is stored as an ordinary style profile, so everything
// downstream (writer, critics, the per-book selector) treats it like any other
// style — the blend only differs in where its fingerprint came from.

export const styleProfileKindSchema = z.enum(["extracted", "blend"]);
export type StyleProfileKind = z.infer<typeof styleProfileKindSchema>;

export const blendSourceSchema = z.object({
  profileId: z.number().int().positive(),
  /** Relative pull of this parent. Normalised server-side; need not sum to 1. */
  weight: z.number().min(0).max(1),
  /**
   * Which traits to take from this parent in particular ("ритм", "метафоры").
   * Free text: the blender reads it, nothing parses it.
   */
  emphasis: z.string().max(200).nullable().optional(),
});
export type BlendSource = z.infer<typeof blendSourceSchema>;

export const blendConfigSchema = z.object({
  sources: z.array(blendSourceSchema).min(2).max(4),
  /** Author's own direction for the synthesis. */
  instructions: z.string().max(2000).nullable().optional(),
});
export type BlendConfig = z.infer<typeof blendConfigSchema>;

export const createStyleBlendInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  sources: z.array(blendSourceSchema).min(2).max(4),
  instructions: z.string().max(2000).nullable().optional(),
  model: z.enum(["sonnet", "opus"]).optional(),
});
export type CreateStyleBlendInput = z.infer<typeof createStyleBlendInputSchema>;

// ─────────── Style profile ───────────

export const styleProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  language: z.string().min(1),
  description: z.string().nullable(),
  kind: styleProfileKindSchema,
  blendConfig: blendConfigSchema.nullable(),
  fingerprint: styleFingerprintSchema.nullable(),
  fatigueWords: fatigueWordsSchema.nullable(),
  corporaCount: z.number().int().nonnegative(),
  totalChars: z.number().int().nonnegative(),
  lastExtractedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StyleProfile = z.infer<typeof styleProfileSchema>;

/** Свежесть паспорта стиля относительно рукописи (заимствование из litrab.ai:
 *  портрет, собранный на третьей главе, к двадцатой тянет автора назад). */
export const styleFreshnessSchema = z.object({
  profileId: z.number().int().positive().nullable(),
  profileName: z.string().nullable(),
  kind: styleProfileKindSchema.nullable(),
  lastExtractedAt: z.string().nullable(),
  /** Версий глав книги, созданных после последнего извлечения. */
  versionsSince: z.number().int().nonnegative(),
  /** Сколько разных глав среди них. */
  chaptersSince: z.number().int().nonnegative(),
  /** Порог — три главы; блендам не считается (у них нет своего корпуса). */
  stale: z.boolean(),
});
export type StyleFreshness = z.infer<typeof styleFreshnessSchema>;

export const createStyleProfileInputSchema = z.object({
  name: z.string().min(1).max(200),
  language: z.string().min(1).max(16).default("ru"),
  description: z.string().max(2000).nullable().optional(),
});
export type CreateStyleProfileInput = z.infer<
  typeof createStyleProfileInputSchema
>;

export const updateStyleProfileInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });
export type UpdateStyleProfileInput = z.infer<
  typeof updateStyleProfileInputSchema
>;

// ─────────── Reference corpus ───────────

export const referenceFormatSchema = z.enum(["txt", "md", "fb2", "epub"]);
export type ReferenceFormat = z.infer<typeof referenceFormatSchema>;

export const referenceCorpusSchema = z.object({
  id: z.number().int().positive(),
  profileId: z.number().int().positive(),
  filename: z.string().min(1),
  format: referenceFormatSchema,
  language: z.string().min(1),
  charCount: z.number().int().nonnegative(),
  sceneCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type ReferenceCorpus = z.infer<typeof referenceCorpusSchema>;

export const uploadReferenceCorpusInputSchema = z.object({
  filename: z.string().min(1).max(500),
  // Base64 for binary (epub) or plain string (txt/md/fb2). Server detects.
  content: z.string().min(1),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});
export type UploadReferenceCorpusInput = z.infer<
  typeof uploadReferenceCorpusInputSchema
>;

// ─────────── Extract action ───────────

export const runExtractInputSchema = z.object({
  // optional override of model
  model: z.enum(["sonnet", "opus"]).optional(),
  // How many scenes the model reads. Statistics are measured over the whole
  // corpus regardless, so this only needs to be representative of the voice.
  sampleSize: z.number().int().min(5).max(100).default(12),
});
export type RunExtractInput = z.infer<typeof runExtractInputSchema>;
/** Форма ДО разбора — `sampleSize` необязателен на проводе, сервер сам
 *  подставляет умолчание при `safeParse`. Клиент шлёт запросы этой формы,
 *  а не пост-парсной `RunExtractInput`, где `.default()` делает поле
 *  обязательным. */
export type RunExtractRequest = z.input<typeof runExtractInputSchema>;

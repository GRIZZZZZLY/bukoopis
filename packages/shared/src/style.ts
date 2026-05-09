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

export const fatigueWordsSchema = z.object({
  // Words/phrases the writer should avoid for this style. Weighted by harm.
  blacklist: z.array(z.string()).default([]),
  softWarn: z.array(z.string()).default([]),
});
export type FatigueWords = z.infer<typeof fatigueWordsSchema>;

// ─────────── Style profile ───────────

export const styleProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  language: z.string().min(1),
  description: z.string().nullable(),
  fingerprint: styleFingerprintSchema.nullable(),
  fatigueWords: fatigueWordsSchema.nullable(),
  corporaCount: z.number().int().nonnegative(),
  totalChars: z.number().int().nonnegative(),
  lastExtractedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StyleProfile = z.infer<typeof styleProfileSchema>;

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
  // sample size: how many scenes to feed into Style Extractor
  sampleSize: z.number().int().min(5).max(100).default(30),
});
export type RunExtractInput = z.infer<typeof runExtractInputSchema>;

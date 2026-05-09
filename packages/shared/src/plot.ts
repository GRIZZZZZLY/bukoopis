import { z } from "zod";

// ──────────────────────────────────────────────────────────────────
// Book outline (level 1)
// ──────────────────────────────────────────────────────────────────

export const arcOutlineSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  keyBeats: z.array(z.string()).min(1).max(10),
});
export type ArcOutline = z.infer<typeof arcOutlineSchema>;

export const bookOutlineVariantSchema = z.object({
  label: z.string().min(1),
  logline: z.string().min(1),
  synopsis: z.string().min(1),
  themes: z.array(z.string()).min(1).max(8),
  protagonist: z.string().min(1),
  antagonist: z.string().nullable(),
  setting: z.string().min(1),
  arcs: z.array(arcOutlineSchema).min(2).max(7),
  estimatedChapters: z.number().int().positive().max(120),
});
export type BookOutlineVariant = z.infer<typeof bookOutlineVariantSchema>;

export const bookOutlineSchema = z.object({
  variants: z.array(bookOutlineVariantSchema).min(1).max(5),
  selectedIndex: z.number().int().nonnegative().nullable(),
  generatedAt: z.string(),
});
export type BookOutline = z.infer<typeof bookOutlineSchema>;

// ──────────────────────────────────────────────────────────────────
// Chapter beat-sheet (level 3)
// ──────────────────────────────────────────────────────────────────

export const beatSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.enum([
    "hook",
    "setup",
    "rising_action",
    "midpoint",
    "complication",
    "climax",
    "resolution",
    "transition",
  ]),
  summary: z.string().min(1),
  goal: z.string().min(1),
  conflict: z.string().min(1),
  outcome: z.string().min(1),
});
export type Beat = z.infer<typeof beatSchema>;

export const chapterBeatSheetVariantSchema = z.object({
  label: z.string().min(1),
  pov: z.string().min(1),
  emotionalGoal: z.string().min(1),
  estimatedWords: z.number().int().positive().max(20000),
  beats: z.array(beatSchema).min(3).max(15),
});
export type ChapterBeatSheetVariant = z.infer<
  typeof chapterBeatSheetVariantSchema
>;

export const chapterPlanSchema = z.object({
  variants: z.array(chapterBeatSheetVariantSchema).min(1).max(5),
  selectedIndex: z.number().int().nonnegative().nullable(),
  generatedAt: z.string(),
});
export type ChapterPlan = z.infer<typeof chapterPlanSchema>;

// ──────────────────────────────────────────────────────────────────
// Generation config (per-call overrides)
// ──────────────────────────────────────────────────────────────────

export const modelChoiceSchema = z.enum(["sonnet", "opus"]);
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const generationConfigSchema = z.object({
  variants: z.number().int().min(1).max(5).default(2),
  temperature: z.number().min(0).max(1).optional(),
  model: modelChoiceSchema.optional(),
});
export type GenerationConfig = z.infer<typeof generationConfigSchema>;

// ──────────────────────────────────────────────────────────────────
// API input types
// ──────────────────────────────────────────────────────────────────

export const generateBookOutlineInputSchema = z.object({
  config: generationConfigSchema.optional(),
});
export type GenerateBookOutlineInput = z.infer<
  typeof generateBookOutlineInputSchema
>;

export const selectBookOutlineInputSchema = z.object({
  selectedIndex: z.number().int().nonnegative(),
});
export type SelectBookOutlineInput = z.infer<
  typeof selectBookOutlineInputSchema
>;

export const generateChapterPlanInputSchema = z.object({
  intent: z.string().min(1).max(20000),
  config: generationConfigSchema.optional(),
});
export type GenerateChapterPlanInput = z.infer<
  typeof generateChapterPlanInputSchema
>;

export const selectChapterPlanInputSchema = z.object({
  selectedIndex: z.number().int().nonnegative(),
});
export type SelectChapterPlanInput = z.infer<
  typeof selectChapterPlanInputSchema
>;

export const writeChapterInputSchema = z.object({
  config: generationConfigSchema.optional(),
});
export type WriteChapterInput = z.infer<typeof writeChapterInputSchema>;

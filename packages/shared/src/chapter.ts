import { z } from "zod";
import { chapterVersionSchema } from "./chapter-version.js";

export const chapterStatusSchema = z.enum(["draft", "in_review", "final"]);
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;

export const chapterSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  orderIndex: z.number().int().nonnegative(),
  title: z.string().min(1),
  intent: z.string().nullable(),
  planJson: z.string().nullable(),
  currentVersionId: z.number().int().positive().nullable(),
  status: chapterStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Chapter = z.infer<typeof chapterSchema>;

export const chapterWithCurrentVersionSchema = chapterSchema.extend({
  currentVersion: chapterVersionSchema.nullable(),
});
export type ChapterWithCurrentVersion = z.infer<
  typeof chapterWithCurrentVersionSchema
>;

export const createChapterInputSchema = z.object({
  title: z.string().min(1).max(500),
});
export type CreateChapterInput = z.infer<typeof createChapterInputSchema>;

export const updateChapterInputSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    status: chapterStatusSchema.optional(),
    orderIndex: z.number().int().nonnegative().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });
export type UpdateChapterInput = z.infer<typeof updateChapterInputSchema>;

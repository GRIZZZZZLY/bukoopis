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

/** Порядок глав здесь НЕ меняется: у него свой маршрут
 *  `POST /books/:id/chapters/reorder`, который одной транзакцией переносит и
 *  производную память (К1 ревью 2026-09-19). Поле оставлено запрещённым явно,
 *  а не просто убрано: вкладка старой версии, пославшая `orderIndex` сюда,
 *  должна получить отказ, а не молча ничего не переставить. */
export const updateChapterInputSchema = z
  .strictObject({
    title: z.string().min(1).max(500).optional(),
    status: chapterStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });
export type UpdateChapterInput = z.infer<typeof updateChapterInputSchema>;

export const reorderChaptersInputSchema = z.object({
  /** Все главы книги в новом порядке. Неполный список отвергается: половина
   *  перестановки хуже, чем её отсутствие. */
  chapterIds: z.array(z.number().int().positive()).min(1).max(2000),
});
export type ReorderChaptersInput = z.infer<typeof reorderChaptersInputSchema>;

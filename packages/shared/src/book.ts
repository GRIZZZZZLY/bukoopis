import { z } from "zod";
import { modelChoiceSchema } from "./plot.js";

export const bookStatusSchema = z.enum(["draft", "active", "archived"]);
export type BookStatus = z.infer<typeof bookStatusSchema>;

export const writerProviderSchema = z.enum(["anthropic", "ollama"]);
export type WriterProvider = z.infer<typeof writerProviderSchema>;

export const bookSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  language: z.string().min(1),
  premise: z.string().nullable(),
  outlineJson: z.string().nullable(),
  styleProfileId: z.number().int().positive().nullable(),
  status: bookStatusSchema,
  writerModel: modelChoiceSchema,
  plotModel: modelChoiceSchema,
  criticModel: modelChoiceSchema,
  writerProvider: writerProviderSchema,
  writerLocalModel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Book = z.infer<typeof bookSchema>;

export const createBookInputSchema = z.object({
  title: z.string().min(1).max(500),
  language: z.string().min(1).max(16).optional(),
  premise: z.string().max(20000).nullable().optional(),
});
export type CreateBookInput = z.infer<typeof createBookInputSchema>;

export const updateBookInputSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    premise: z.string().max(20000).nullable().optional(),
    status: bookStatusSchema.optional(),
    styleProfileId: z.number().int().positive().nullable().optional(),
    writerModel: modelChoiceSchema.optional(),
    plotModel: modelChoiceSchema.optional(),
    criticModel: modelChoiceSchema.optional(),
    writerProvider: writerProviderSchema.optional(),
    writerLocalModel: z.string().min(1).max(120).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });
export type UpdateBookInput = z.infer<typeof updateBookInputSchema>;

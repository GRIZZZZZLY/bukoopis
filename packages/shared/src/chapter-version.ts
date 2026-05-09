import { z } from "zod";

export const versionSourceSchema = z.enum(["manual", "agent"]);
export type VersionSource = z.infer<typeof versionSourceSchema>;

export const proseMirrorDocSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string(),
    content: z.array(proseMirrorDocSchema).optional(),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z.array(z.unknown()).optional(),
  }),
);

export const chapterVersionSchema = z.object({
  id: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  parentVersionId: z.number().int().positive().nullable(),
  contentJson: z.string().min(1),
  contentText: z.string(),
  wordCount: z.number().int().nonnegative(),
  source: versionSourceSchema,
  branchLabel: z.string().nullable(),
  summary: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type ChapterVersion = z.infer<typeof chapterVersionSchema>;

export const createChapterVersionInputSchema = z.object({
  contentJson: z.unknown().refine(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      typeof (v as { type?: unknown }).type === "string",
    { message: "contentJson must be ProseMirror doc" },
  ),
});
export type CreateChapterVersionInput = z.infer<
  typeof createChapterVersionInputSchema
>;

export const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;

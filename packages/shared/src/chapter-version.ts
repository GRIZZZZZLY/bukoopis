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

const proseMirrorContentJson = z.unknown().refine(
  (v) =>
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as { type?: unknown }).type === "string",
  { message: "contentJson must be ProseMirror doc" },
);

// ADR 0002 (Step 6): POST /versions is ALWAYS a deliberate commit — the old
// `finalize` flag is gone (unknown keys from older clients are stripped).
// Debounced autosaves go to PUT /chapters/:id/draft instead.
export const createChapterVersionInputSchema = z.object({
  contentJson: proseMirrorContentJson,
});
export type CreateChapterVersionInput = z.infer<
  typeof createChapterVersionInputSchema
>;

export const saveChapterDraftInputSchema = z.object({
  contentJson: proseMirrorContentJson,
});
export type SaveChapterDraftInput = z.infer<typeof saveChapterDraftInputSchema>;

/** Working draft row (chapter_drafts) as returned by GET /api/chapters/:id. */
export const chapterDraftSchema = z.object({
  chapterId: z.number().int().positive(),
  contentJson: z.string().min(1),
  contentText: z.string(),
  wordCount: z.number().int().nonnegative(),
  baseVersionId: z.number().int().positive().nullable(),
  updatedAt: z.string(),
});
export type ChapterDraft = z.infer<typeof chapterDraftSchema>;

export const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;

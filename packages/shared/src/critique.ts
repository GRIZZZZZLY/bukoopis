import { z } from "zod";

export const criticTypeSchema = z.enum([
  "canon",
  "style",
  "editor",
  "reader",
]);
export type CriticType = z.infer<typeof criticTypeSchema>;

export const issueSeveritySchema = z.enum([
  "blocking",
  "suggestion",
  "nit",
]);
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;

export const critiqueIssueSchema = z.object({
  severity: issueSeveritySchema,
  summary: z.string().min(1),
  excerpt: z.string().nullable().optional(),
  suggestion: z.string().nullable().optional(),
});
export type CritiqueIssue = z.infer<typeof critiqueIssueSchema>;

export const criticReportSchema = z.object({
  critic: criticTypeSchema,
  overallNotes: z.string().min(1),
  issues: z.array(critiqueIssueSchema),
});
export type CriticReport = z.infer<typeof criticReportSchema>;

export const critiqueReportStatusSchema = z.enum([
  "pending",
  "done",
  "error",
]);
export type CritiqueReportStatus = z.infer<typeof critiqueReportStatusSchema>;

export const fullCritiqueReportSchema = z.object({
  critics: z.array(criticReportSchema),
  blockingCount: z.number().int().nonnegative(),
  suggestionCount: z.number().int().nonnegative(),
  nitCount: z.number().int().nonnegative(),
  generatedAt: z.string(),
});
export type FullCritiqueReport = z.infer<typeof fullCritiqueReportSchema>;

export const critiqueReportSchema = z.object({
  id: z.number().int().positive(),
  chapterVersionId: z.number().int().positive(),
  status: critiqueReportStatusSchema,
  report: fullCritiqueReportSchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CritiqueReport = z.infer<typeof critiqueReportSchema>;

export const runCritiqueInputSchema = z.object({
  // optional override of which critics to run; default = all 4
  critics: z.array(criticTypeSchema).min(1).optional(),
});
export type RunCritiqueInput = z.infer<typeof runCritiqueInputSchema>;

export const runRepairInputSchema = z.object({
  // optional override: only address selected severity levels
  severities: z.array(issueSeveritySchema).min(1).optional(),
});
export type RunRepairInput = z.infer<typeof runRepairInputSchema>;

export const REPAIR_BRANCH_PREFIX = "repair-";
export const REPAIR_MAX_ITERATIONS = 3;

export const CRITIC_LABELS: Record<CriticType, string> = {
  canon: "Canon Guard",
  style: "Style",
  editor: "Editor",
  reader: "Reader-Experience",
};

export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  blocking: "блокирует",
  suggestion: "предложение",
  nit: "мелочь",
};

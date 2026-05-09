import { z } from "zod";
import { generationConfigSchema } from "./plot.js";

export const inlineCommandSchema = z.enum([
  "continue",
  "rewrite",
  "shorten",
  "intensify",
  "lengthen",
]);
export type InlineCommand = z.infer<typeof inlineCommandSchema>;

export const INLINE_COMMAND_LABELS: Record<InlineCommand, string> = {
  continue: "Продолжить",
  rewrite: "Переписать",
  shorten: "Сократить",
  intensify: "Усилить эмоцию",
  lengthen: "Развернуть",
};

export const INLINE_COMMANDS_REQUIRING_SELECTION: InlineCommand[] = [
  "rewrite",
  "shorten",
  "intensify",
  "lengthen",
];

export const runInlineCommandInputSchema = z.object({
  command: inlineCommandSchema,
  selectionText: z.string().nullable(),
  beforeText: z.string().max(8000),
  afterText: z.string().max(8000),
  guidance: z.string().max(2000).nullable().optional(),
  config: generationConfigSchema.optional(),
});
export type RunInlineCommandInput = z.infer<
  typeof runInlineCommandInputSchema
>;

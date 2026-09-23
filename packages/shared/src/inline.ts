import { z } from "zod";
import { generationConfigSchema } from "./plot.js";

export const inlineCommandSchema = z.enum([
  "continue",
  "rewrite",
  "shorten",
  "intensify",
  "lengthen",
  "describe",
  // Узкие операции (второй разбор прозы 2026-09-23): «Переписать» просило
  // «улучшить прозу» и возвращало текст образнее исходного. У каждой из этих
  // трёх одна задача и свой предел изменения.
  "clarify",
  "dedupe",
  "natural_dialogue",
]);
export type InlineCommand = z.infer<typeof inlineCommandSchema>;

export const INLINE_COMMAND_LABELS: Record<InlineCommand, string> = {
  continue: "Продолжить",
  rewrite: "Переписать",
  shorten: "Сократить",
  intensify: "Усилить эмоцию",
  lengthen: "Развернуть",
  describe: "Описать",
  clarify: "Прояснить",
  dedupe: "Убрать повтор",
  natural_dialogue: "Естественнее реплика",
};

export const INLINE_COMMANDS_REQUIRING_SELECTION: InlineCommand[] = [
  "rewrite",
  "shorten",
  "intensify",
  "lengthen",
  "describe",
  "clarify",
  "dedupe",
  "natural_dialogue",
];

/** Канал восприятия для «Описать» (заимствование из litrab.ai): модель
 *  вплетает ОДНУ деталь ровно этого канала, остальное не трогает. */
export const senseChannelSchema = z.enum([
  "sight",
  "sound",
  "smell",
  "taste",
  "touch",
  "metaphor",
]);
export type SenseChannel = z.infer<typeof senseChannelSchema>;

export const SENSE_CHANNEL_LABELS: Record<SenseChannel, string> = {
  sight: "Зрение",
  sound: "Слух",
  smell: "Обоняние",
  taste: "Вкус",
  touch: "Осязание",
  metaphor: "Метафора",
};

export const runInlineCommandInputSchema = z.object({
  command: inlineCommandSchema,
  selectionText: z.string().nullable(),
  beforeText: z.string().max(8000),
  afterText: z.string().max(8000),
  guidance: z.string().max(2000).nullable().optional(),
  /** Только для `describe`; маршрут отвергает `describe` без канала. */
  sense: senseChannelSchema.optional(),
  config: generationConfigSchema.optional(),
});
export type RunInlineCommandInput = z.infer<
  typeof runInlineCommandInputSchema
>;

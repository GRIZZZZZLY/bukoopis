import { z } from "zod";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  bookOutlineVariantSchema,
  chapterBeatSheetVariantSchema,
  type BookOutlineVariant,
  type ChapterBeatSheetVariant,
  type GenerationConfig,
} from "@book-forge/shared";

export type UsageHandler = (usage: StructuredUsage) => void;

const bookOutlineToolSchema = z.object({
  variants: z.array(bookOutlineVariantSchema).min(1).max(5),
});
type BookOutlineToolResult = z.infer<typeof bookOutlineToolSchema>;

const chapterBeatSheetToolSchema = z.object({
  variants: z.array(chapterBeatSheetVariantSchema).min(1).max(5),
});
type ChapterBeatSheetToolResult = z.infer<typeof chapterBeatSheetToolSchema>;

const SYSTEM_BOOK_OUTLINE = `Ты — Plot Agent, специалист по структуре художественной литературы. Работаешь на русском языке.

Твоя задача: из премисы книги породить N вариантов high-level outline. Каждый вариант — это самодостаточная концепция, отличающаяся от других существенно (тон, угол атаки, протагонист, центральный конфликт).

Каждый вариант содержит: label (короткое имя, например "тёмный", "оптимистичный"), logline (1-2 предложения), synopsis (3-6 абзацев), темы (2-5), протагониста, антагониста (если есть), сеттинг, арки (минимум 2 — обычно protagonist arc + main plot arc + subplot arc), оценку количества глав.

Не дублируй варианты. Не пиши абстракции уровня "герой проходит путь". Каждый вариант должен быть достаточно конкретным, чтобы можно было сразу начать писать первую главу.`;

const SYSTEM_CHAPTER_PLAN = `Ты — Plot Agent. Работаешь на русском языке.

Задача: из намерения автора по главе и контекста книги породить N вариантов beat-sheet'а главы. Каждый вариант — связная последовательность beats (3-15 штук) с типом, кратким описанием, целью, конфликтом и исходом.

Варианты должны отличаться: подходом к структуре (нарастающий темп vs шок-открытие в середине), POV-фокусом, эмоциональной траекторией, выбором кульминации.

Указывай: label, POV-персонаж, эмоциональную цель сцены, оценку слов в готовой главе, последовательность beats.`;

// ─────────── Outline ───────────

export interface GenerateBookOutlineInput {
  bookTitle: string;
  premise: string;
  language: string;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
}

function buildBookOutlinePrompt(input: GenerateBookOutlineInput): string {
  const variants = input.config?.variants ?? 2;
  return [
    `Книга: "${input.bookTitle}"`,
    `Язык: ${input.language}`,
    `Премиса автора:\n${input.premise}`,
    `\nСгенерируй ровно ${variants} существенно различных вариантов outline.`,
  ].join("\n\n---\n\n");
}

const plotOutlineContract: AgentStructuredContract<
  GenerateBookOutlineInput,
  BookOutlineToolResult
> = {
  agentName: "plot_outline",
  getOutputSchema: () => bookOutlineToolSchema,
  systemPrompt: SYSTEM_BOOK_OUTLINE,
  buildPrompt: buildBookOutlinePrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_book_outlines",
    toolDescription:
      "Submit N alternative high-level book outlines. Each variant must differ substantively.",
  },
};

export function registerPlotOutlineContract(): void {
  registerAgentContract(plotOutlineContract);
}

export async function generateBookOutline(
  input: GenerateBookOutlineInput,
): Promise<BookOutlineVariant[]> {
  const variants = input.config?.variants ?? 2;
  const { raw, diagnostics } = await dispatchStructured<
    GenerateBookOutlineInput,
    BookOutlineToolResult
  >({
    agentName: "plot_outline",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 8192,
  });
  if (input.onUsage) {
    try {
      input.onUsage({
        modelId: diagnostics.modelId,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
        cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
        cacheReadInputTokens: diagnostics.cacheReadInputTokens,
      });
    } catch (e) {
      console.warn(
        "[plot/outline] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw.variants.slice(0, variants);
}

// ─────────── Chapter plan (beat-sheet) ───────────

export interface GenerateChapterPlanInput {
  bookTitle: string;
  bookPremise: string;
  bookOutline: string | null;
  chapterTitle: string;
  intent: string;
  previousChaptersSummary: string | null;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
}

function buildChapterPlanPrompt(input: GenerateChapterPlanInput): string {
  const variants = input.config?.variants ?? 2;
  const stableParts: string[] = [
    `Книга: "${input.bookTitle}"`,
    `Премиса: ${input.bookPremise}`,
  ];
  if (input.bookOutline) {
    stableParts.push(`Outline книги:\n${input.bookOutline}`);
  }
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Что было в предыдущих главах:\n${input.previousChaptersSummary}`,
    );
  }
  const volatileParts: string[] = [
    `Текущая глава: "${input.chapterTitle}"`,
    `Намерение автора:\n${input.intent}`,
    `Сгенерируй ровно ${variants} существенно различных beat-sheet вариантов.`,
  ];
  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const plotChapterPlanContract: AgentStructuredContract<
  GenerateChapterPlanInput,
  ChapterBeatSheetToolResult
> = {
  agentName: "plot_chapter_plan",
  getOutputSchema: () => chapterBeatSheetToolSchema,
  systemPrompt: SYSTEM_CHAPTER_PLAN,
  buildPrompt: buildChapterPlanPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_chapter_beat_sheets",
    toolDescription:
      "Submit N alternative chapter beat-sheets, each a coherent sequence of beats with goal/conflict/outcome.",
  },
};

export function registerPlotChapterPlanContract(): void {
  registerAgentContract(plotChapterPlanContract);
}

export async function generateChapterPlan(
  input: GenerateChapterPlanInput,
): Promise<ChapterBeatSheetVariant[]> {
  const variants = input.config?.variants ?? 2;
  const { raw, diagnostics } = await dispatchStructured<
    GenerateChapterPlanInput,
    ChapterBeatSheetToolResult
  >({
    agentName: "plot_chapter_plan",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 8192,
  });
  if (input.onUsage) {
    try {
      input.onUsage({
        modelId: diagnostics.modelId,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
        cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
        cacheReadInputTokens: diagnostics.cacheReadInputTokens,
      });
    } catch (e) {
      console.warn(
        "[plot/chapter_plan] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw.variants.slice(0, variants);
}

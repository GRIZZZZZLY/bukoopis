import { z } from "zod";
import {
  callStructured,
  generateThenStructure,
  type HybridUsageEvent,
  type StructuredUsage,
  type SystemBlock,
} from "@book-forge/llm";
import {
  bookOutlineVariantSchema,
  chapterBeatSheetVariantSchema,
  type BookOutlineVariant,
  type ChapterBeatSheetVariant,
  type GenerationConfig,
} from "@book-forge/shared";

export type UsageHandler = (usage: StructuredUsage) => void;

function hybridUsageToStructured(handler: UsageHandler): (e: HybridUsageEvent) => void {
  // Emit each stage's usage as a separate StructuredUsage event so pricing
  // (getModelRates) receives raw model IDs and computes per-stage cost
  // correctly. Caller's usage logger will see two rows per hybrid call:
  // one for the subscription generate pass (zero-cost via local-LLM rate
  // table) and one for the api extract pass.
  return (e) =>
    handler({
      modelId: e.modelId,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheCreationInputTokens: e.cacheCreationInputTokens,
      cacheReadInputTokens: e.cacheReadInputTokens,
    });
}

const bookOutlineToolSchema = z.object({
  variants: z.array(bookOutlineVariantSchema).min(1).max(5),
});

const chapterBeatSheetToolSchema = z.object({
  variants: z.array(chapterBeatSheetVariantSchema).min(1).max(5),
});

const SYSTEM_BOOK_OUTLINE = `Ты — Plot Agent, специалист по структуре художественной литературы. Работаешь на русском языке.

Твоя задача: из премисы книги породить N вариантов high-level outline. Каждый вариант — это самодостаточная концепция, отличающаяся от других существенно (тон, угол атаки, протагонист, центральный конфликт).

Каждый вариант содержит: label (короткое имя, например "тёмный", "оптимистичный"), logline (1-2 предложения), synopsis (3-6 абзацев), темы (2-5), протагониста, антагониста (если есть), сеттинг, арки (минимум 2 — обычно protagonist arc + main plot arc + subplot arc), оценку количества глав.

Не дублируй варианты. Не пиши абстракции уровня "герой проходит путь". Каждый вариант должен быть достаточно конкретным, чтобы можно было сразу начать писать первую главу.`;

const SYSTEM_CHAPTER_PLAN = `Ты — Plot Agent. Работаешь на русском языке.

Задача: из намерения автора по главе и контекста книги породить N вариантов beat-sheet'а главы. Каждый вариант — связная последовательность beats (3-15 штук) с типом, кратким описанием, целью, конфликтом и исходом.

Варианты должны отличаться: подходом к структуре (нарастающий темп vs шок-открытие в середине), POV-фокусом, эмоциональной траекторией, выбором кульминации.

Указывай: label, POV-персонаж, эмоциональную цель сцены, оценку слов в готовой главе, последовательность beats.`;

export interface GenerateBookOutlineInput {
  bookTitle: string;
  premise: string;
  language: string;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
}

export async function generateBookOutline(
  input: GenerateBookOutlineInput,
): Promise<BookOutlineVariant[]> {
  const variants = input.config?.variants ?? 2;

  // Pass 1: subscription prose (markdown). The Plot agent writes outline
  // variants as headed markdown — humanly readable and no JSON-prompting
  // fragility on the heavy generation pass.
  const proseSystem = `${SYSTEM_BOOK_OUTLINE}\n\n---\n\nКнига: "${input.bookTitle}"\nЯзык: ${input.language}\nПремиса автора:\n${input.premise}\n\n---\n\nФорматирование: верни ${variants} вариантов в markdown. Каждый вариант начинается с заголовка \"## Вариант N: <label>\" и содержит подзаголовки \"Logline\", \"Synopsis\", \"Темы\", \"Протагонист\", \"Антагонист\", \"Сеттинг\", \"Арки\", \"Оценка глав\". Ничего лишнего. Никакого JSON.`;
  const prosePrompt = `Сгенерируй ровно ${variants} существенно различных вариантов outline в markdown.`;

  // Pass 2: api structured extraction. Sonnet re-reads the markdown and
  // emits the typed `bookOutlineToolSchema` — reliable tool_use path.
  const extractSystem = `Ты — парсер. Получаешь markdown с N вариантами book outline. Извлекаешь их в structured формате по предоставленной схеме. Никакого редактирования содержания — только извлечение полей.`;
  const buildExtractPrompt = (prose: string) =>
    `Markdown с вариантами:\n\n${prose}\n\n---\n\nИзвлеки ровно ${variants} вариантов в structured формате (submit_book_outlines).`;

  const result = await generateThenStructure({
    agentName: "plot",
    textModel: input.config?.model ?? "opus",
    textSystem: proseSystem,
    textPrompt: prosePrompt,
    extractModel: "sonnet",
    extractSystem,
    extractPrompt: buildExtractPrompt,
    extractSchema: bookOutlineToolSchema,
    extractSchemaName: "submit_book_outlines",
    extractSchemaDescription:
      "Submit N alternative high-level book outlines, each parsed verbatim from the provided markdown.",
    extractMaxTokens: 8192,
    ...(input.onUsage
      ? { onUsage: hybridUsageToStructured(input.onUsage) }
      : {}),
  });

  return result.variants.slice(0, variants);
}

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

export async function generateChapterPlan(
  input: GenerateChapterPlanInput,
): Promise<ChapterBeatSheetVariant[]> {
  const variants = input.config?.variants ?? 2;

  // Stable: SYSTEM + book + premise + outline + previous summary. Volatile:
  // current chapter intent + variants count.
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
  const stableSystem = `${SYSTEM_CHAPTER_PLAN}\n\n---\n\n${stableParts.join("\n\n")}`;
  const system: SystemBlock[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];

  const volatileParts: string[] = [
    `Текущая глава: "${input.chapterTitle}"`,
    `Намерение автора:\n${input.intent}`,
    `Сгенерируй ровно ${variants} существенно различных beat-sheet вариантов.`,
  ];

  const result = await callStructured({
    agentName: "plot",
    model: input.config?.model ?? "sonnet",
    system,
    prompt: volatileParts.join("\n\n"),
    schema: chapterBeatSheetToolSchema,
    schemaName: "submit_chapter_beat_sheets",
    schemaDescription:
      "Submit N alternative chapter beat-sheets, each a coherent sequence of beats with goal/conflict/outcome.",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 8192,
    onUsage: input.onUsage,
  });

  return result.variants.slice(0, variants);
}

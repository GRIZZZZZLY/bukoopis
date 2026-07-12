import { streamText, streamTextOllama, type SystemBlock } from "@book-forge/llm";
import type {
  ChapterBeatSheetVariant,
  GenerationConfig,
} from "@book-forge/shared";

export type WriterProvider = "anthropic" | "ollama";

const SYSTEM_WRITER = `Ты — Writer Agent. Пишешь художественную прозу на русском языке.

Получаешь: контекст книги + beat-sheet главы + (опционально) краткое содержание предыдущих глав.

Твоя задача: написать связный текст главы, точно следуя последовательности beats. Каждый beat = логический блок прозы, обычно 1-4 абзаца.

Требования:
— Не пересказывай beats — превращай их в живую сцену с диалогами, действием, описаниями.
— Соблюдай POV из beat-sheet. Объективный канон мира используй для непротиворечивости, но НЕ вкладывай в мысли/речь POV-персонажа то, чего он ещё не знает. В его сознании допустимо лишь то, что перечислено в блоке «Известно POV-персонажу» (если он есть).
— Стиль: ясный, без избыточных метафор, без LLM-клише ("казалось", "по сути", "не X, а Y", избытка списков из трёх).
— Целевой объём — близко к estimatedWords ± 30%.
— Не выводи никаких служебных пометок, заголовков, списков beats. Только сама проза, разделённая на абзацы.
— В начале не повторяй название главы.

Пиши прозу сразу. Без вступлений типа "Вот глава:".`;

export interface WriteChapterInput {
  bookTitle: string;
  bookPremise: string;
  bookOutline: string | null;
  studioContext: string | null;
  /** Phase 1 — top-k relevant chunks from prior chapters (hybridSearch). */
  retrievedContext: string | null;
  chapterTitle: string;
  beatSheet: ChapterBeatSheetVariant;
  previousChaptersSummary: string | null;
  characterContext: string | null;
  /** ADR 0003 slice 3b — what the POV character knows so far (POV guard). */
  povKnowledge?: string | null;
  loreContext: string | null;
  styleContext: string | null; // fingerprint + few-shot from reference corpus
  fatigueWords: string[]; // additional avoid-list
  config?: GenerationConfig;
  /** Cloud (Anthropic) by default; "ollama" runs against a local server. */
  provider?: WriterProvider;
  /** Required when provider="ollama". Tag like "qwen2.5:14b-instruct". */
  localModelTag?: string;
  /** Optional override for OLLAMA_BASE_URL. */
  localBaseUrl?: string;
}

export async function* writeChapter(
  input: WriteChapterInput,
): AsyncGenerator<
  string,
  {
    text: string;
    modelId: string;
    tokens: {
      input: number;
      output: number;
      cacheCreation: number;
      cacheRead: number;
    };
  },
  void
> {
  const beatsBlock = input.beatSheet.beats
    .map(
      (b) =>
        `${b.index + 1}. [${b.type}] ${b.summary}\n   Цель: ${b.goal}\n   Конфликт: ${b.conflict}\n   Исход: ${b.outcome}`,
    )
    .join("\n\n");

  // Stable system: SYSTEM_WRITER + book context + outline + character/lore +
  // style + previous summary + fatigue list. These remain identical across
  // many calls for the same book, so they get a single cache_control block.
  const stableParts = [
    `Книга: "${input.bookTitle}"`,
    `Премиса: ${input.bookPremise}`,
  ];
  if (input.bookOutline) {
    stableParts.push(`Outline книги:\n${input.bookOutline}`);
  }
  if (input.studioContext) {
    stableParts.push(`Контекст studio:\n${input.studioContext}`);
  }
  if (input.retrievedContext) {
    stableParts.push(input.retrievedContext);
  }
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Краткое содержание предыдущих глав:\n${input.previousChaptersSummary}`,
    );
  }
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.povKnowledge) stableParts.push(input.povKnowledge);
  if (input.loreContext) stableParts.push(input.loreContext);
  if (input.styleContext) stableParts.push(input.styleContext);
  if (input.fatigueWords.length > 0) {
    stableParts.push(
      `Слова и обороты с повышенной частотой — не злоупотребляй ими. Единичное употребление допустимо, если оно естественно и не создаёт повтора рядом:\n- ${input.fatigueWords.join("\n- ")}`,
    );
  }
  const stableSystem = `${SYSTEM_WRITER}\n\n---\n\n${stableParts.join("\n\n")}`;
  const system: SystemBlock[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];

  const volatileParts = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.beatSheet.pov}`,
    `Эмоциональная цель: ${input.beatSheet.emotionalGoal}`,
    `Целевой объём: ~${input.beatSheet.estimatedWords} слов`,
    `Beats:\n${beatsBlock}`,
    "Напиши главу.",
  ];

  const provider: WriterProvider = input.provider ?? "anthropic";
  const gen =
    provider === "ollama"
      ? streamTextOllama({
          agentName: "writer",
          model: input.config?.model ?? "opus",
          modelTag: input.localModelTag ?? "",
          ...(input.localBaseUrl !== undefined
            ? { baseUrl: input.localBaseUrl }
            : {}),
          system,
          prompt: volatileParts.join("\n\n"),
          ...(input.config?.temperature !== undefined
            ? { temperature: input.config.temperature }
            : {}),
          maxTokens: 16384,
        })
      : streamText({
          agentName: "writer",
          model: input.config?.model ?? "opus",
          system,
          prompt: volatileParts.join("\n\n"),
          ...(input.config?.temperature !== undefined
            ? { temperature: input.config.temperature }
            : {}),
          maxTokens: 16384,
        });

  if (provider === "ollama" && !input.localModelTag) {
    throw new Error("ollama provider requires localModelTag");
  }

  let result = {
    text: "",
    modelId: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  while (true) {
    const next = await gen.next();
    if (next.done) {
      result = next.value;
      break;
    }
    yield next.value;
  }

  return {
    text: result.text,
    modelId: result.modelId,
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      cacheCreation: result.cacheCreationInputTokens,
      cacheRead: result.cacheReadInputTokens,
    },
  };
}

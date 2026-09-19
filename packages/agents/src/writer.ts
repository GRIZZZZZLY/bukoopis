import { streamText, streamTextOllama, type SystemBlock } from "@book-forge/llm";
import {
  extractNarrativeArchitecture,
  renderChapterClosing,
  renderChapterContract,
  renderClicheRule,
  renderNarrativeArchitecture,
  RU_DIALOGUE_RULE,
  STYLE_PRECEDENCE_RULE,
  type ChapterBeatSheetVariant,
  type GenerationConfig,
} from "@book-forge/shared";

export type WriterProvider = "anthropic" | "ollama";

const SYSTEM_WRITER = `Ты — Writer Agent. Пишешь художественную прозу на русском языке.

Получаешь: контекст книги + beat-sheet главы + (опционально) краткое содержание предыдущих глав.

Твоя задача: написать связный текст главы, следуя последовательности beats. Каждый beat = логический блок прозы, обычно 1-4 абзаца.

Требования:
— Не пересказывай beats — превращай их в живую сцену с диалогами, действием, описаниями. Beats — каркас, не сценарий: не переноси их формулировки в текст дословно; отдельная деталь может прийти не по порядку или остаться за кадром, если исход beat'а сохранён.
— Соблюдай POV из beat-sheet. Объективный канон мира используй для непротиворечивости, но НЕ вкладывай в мысли/речь POV-персонажа то, чего он ещё не знает. Что каждый герой знает к началу сцены, перечислено под «Знает» в его карточке в блоке «Персонажи в сцене». Канон мира может быть шире: герой узнаёт не всё и не сразу.
— Не объясняй тему и иронию словами нарратора: смысл несут события. Нарратор не подводит итог, герой не формулирует, что он понял и чему научился.
— Регистр меняется от сцены к сцене: длина предложений, плотность описаний и доля диалога в сцене покоя и в сцене ужаса не должны совпадать. Одна каденция на всю главу — машинный признак.
— Блок «Контракт главы» — обязательства, а не пожелания. Всё из «Обязано случиться» должно произойти в тексте. Ничто из «Чего быть не должно» не появляется — это запрет, и он сильнее беата: если beat требует запрещённого, выполняй запрет, а beat оставь несделанным. Названное в «Что раскрывается именно здесь» раскрывай здесь, не раньше и не позже.
— Финал главы задан в блоке «Финал главы»; держи его. После кульминации не более одного абзаца рефлексии, последний абзац — действие, реплика или образ, не осмысление. Если финал не задан, заканчивай действием.
— Оставляй слабину: не каждое предложение должно работать. Обычная фраза, необъяснённая деталь, незакрытый хвост допустимы. Не заканчивай каждый абзац ударной короткой фразой.
— Стиль по умолчанию: ясный, без избыточных метафор.
${renderClicheRule()}
${RU_DIALOGUE_RULE}
— Целевой объём — близко к estimatedWords ± 30%.
— Не выводи никаких служебных пометок, заголовков, списков beats. Только сама проза, разделённая на абзацы.
— В начале не повторяй название главы.

${STYLE_PRECEDENCE_RULE}

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
  /**
   * Verbatim closing passage of the preceding chapter. Summaries carry plot but
   * lose intonation, rhythm and unfinished physical action, so an opening
   * written from a summary alone reads as a hard cut.
   */
  previousChapterTail?: string | null;
  characterContext: string | null;
  /** ADR 0003 slice 3b — what the POV character knows so far (POV guard). */
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
  /** Отмена вызова (task 7 — остановка генерации). */
  signal?: AbortSignal;
}

/**
 * Volatile half of the Writer prompt — everything that changes per chapter or
 * per beat-sheet variant, so it sits outside the cache_control prefix.
 */
export function buildWriterVolatilePrompt(input: WriteChapterInput): string {
  const beatsBlock = input.beatSheet.beats
    .map(
      (b) =>
        `${b.index + 1}. [${b.type}] ${b.summary}\n   Цель: ${b.goal}\n   Конфликт: ${b.conflict}\n   Исход: ${b.outcome}`,
    )
    .join("\n\n");

  const parts = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.beatSheet.pov}`,
    `Эмоциональная цель: ${input.beatSheet.emotionalGoal}`,
    `Целевой объём: ~${input.beatSheet.estimatedWords} слов`,
    `Beats:\n${beatsBlock}`,
  ];
  // Контракт идёт сразу после beats и перед финалом: он их ограничивает, и
  // прочитанный раньше запрет весит больше, чем прочитанный после.
  if (input.beatSheet.contract) {
    const contract = renderChapterContract(input.beatSheet.contract);
    if (contract) parts.push(contract);
  }
  if (input.beatSheet.closing) {
    parts.push(`Финал главы: ${renderChapterClosing(input.beatSheet.closing)}`);
  }
  parts.push("Напиши главу.");
  return parts.join("\n\n");
}

/**
 * Stable half of the Writer system prompt — book context, memory layers, style.
 * Identical across many calls for the same chapter, so it carries the single
 * `cache_control` block. Extracted so prompt composition is directly testable.
 */
export function buildWriterStableSystem(input: WriteChapterInput): string {
  const stableParts = [
    `Книга: "${input.bookTitle}"`,
    `Премиса: ${input.bookPremise}`,
  ];
  if (input.bookOutline) {
    stableParts.push(`Outline книги:\n${input.bookOutline}`);
    // The outline arrives as the variant's JSON, where the sheet is a set of
    // English enum keys; rendered in Russian it becomes an instruction.
    const architecture = extractNarrativeArchitecture(input.bookOutline);
    if (architecture) {
      stableParts.push(
        `Архитектура книги (решения Plot Agent, держи их в каждой главе):\n${renderNarrativeArchitecture(architecture)}`,
      );
    }
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
  if (input.previousChapterTail) {
    stableParts.push(
      `Финал предыдущей главы (дословно, последние абзацы). Продолжай от него: держи интонацию, ритм и место действия, доигрывай незавершённое действие. Не пересказывай этот фрагмент и не начинай главу его повтором:\n${input.previousChapterTail}`,
    );
  }
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);
  if (input.styleContext) stableParts.push(input.styleContext);
  if (input.fatigueWords.length > 0) {
    stableParts.push(
      `Слова и обороты с повышенной частотой — не злоупотребляй ими. Единичное употребление допустимо, если оно естественно и не создаёт повтора рядом:\n- ${input.fatigueWords.join("\n- ")}`,
    );
  }
  return `${SYSTEM_WRITER}\n\n---\n\n${stableParts.join("\n\n")}`;
}

export async function* writeChapter(
  input: WriteChapterInput,
): AsyncGenerator<
  string,
  {
    text: string;
    modelId: string;
    stopReason: string | null;
    tokens: {
      input: number;
      output: number;
      cacheCreation: number;
      cacheRead: number;
    };
  },
  void
> {
  const stableSystem = buildWriterStableSystem(input);
  const system: SystemBlock[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];
  const volatilePrompt = buildWriterVolatilePrompt(input);

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
          prompt: volatilePrompt,
          ...(input.config?.temperature !== undefined
            ? { temperature: input.config.temperature }
            : {}),
          maxTokens: 16384,
        })
      : streamText({
          agentName: "writer",
          model: input.config?.model ?? "opus",
          system,
          prompt: volatilePrompt,
          ...(input.config?.temperature !== undefined
            ? { temperature: input.config.temperature }
            : {}),
          // Opus 5 thinks by default and thinking shares this budget with the
          // prose, so 16384 (fine when Opus 4.7 ran without thinking) would cut
          // a long chapter off mid-sentence. A 4k-word RU chapter is ~11k output
          // tokens; the rest is headroom for planning. Safe because this call
          // streams.
          maxTokens: 32000,
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
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
    stopReason: null as string | null,
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
    stopReason: result.stopReason,
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      cacheCreation: result.cacheCreationInputTokens,
      cacheRead: result.cacheReadInputTokens,
    },
  };
}

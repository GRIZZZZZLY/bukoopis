import { z } from "zod";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  arcOutlineSchema,
  bookOutlineVariantSchema,
  chapterBeatSheetVariantSchema,
  voiceSampleSituationSchema,
  chapterClosingSchema,
  chapterContractSchema,
  narrativeArchitectureSchema,
  type BookOutlineVariant,
  type ChapterBeatSheetVariant,
  type GenerationConfig,
} from "@book-forge/shared";

export type UsageHandler = (usage: StructuredUsage) => void;

// Stored schemas keep architecture/closing optional for old rows; the agent
// must fill them on every fresh generation.
//
/** Схема хранения ослаблена ради варианта из авторского оглавления (см.
 *  комментарий у `bookOutlineVariantSchema`). Генератору послаблений нет:
 *  здесь всё, что он должен вернуть, снова обязательно. */
export const bookOutlineToolSchema = z.object({
  variants: z
    .array(
      bookOutlineVariantSchema.extend({
        logline: z.string().min(1),
        synopsis: z.string().min(1),
        themes: z.array(z.string()).min(1).max(8),
        protagonist: z.string().min(1),
        antagonist: z.string().nullable(),
        setting: z.string().min(1),
        arcs: z.array(arcOutlineSchema).min(2).max(7),
        architecture: narrativeArchitectureSchema,
      }),
    )
    .min(1)
    .max(5),
});
type BookOutlineToolResult = z.infer<typeof bookOutlineToolSchema>;

export const chapterBeatSheetToolSchema = z.object({
  variants: z
    .array(
      chapterBeatSheetVariantSchema.extend({
        closing: chapterClosingSchema,
        // Обязателен на выходе по той же причине, что и closing: свежий план
        // обязан определиться. «Не задано» и «ничего не запрещено» для
        // критиков неразличимы, а цена различия — заблокированный поворот.
        contract: chapterContractSchema,
        // Тот же приём: в хранилище необязателен, на выходе обязателен.
        // Без регистра отбор образцов речи молча берёт нейтральные.
        dialogueRegister: voiceSampleSituationSchema,
      }),
    )
    .min(1)
    .max(5),
});
type ChapterBeatSheetToolResult = z.infer<typeof chapterBeatSheetToolSchema>;

export const SYSTEM_BOOK_OUTLINE = `Ты — Plot Agent, специалист по структуре художественной литературы. Работаешь на русском языке.

Твоя задача: из премисы книги породить N вариантов high-level outline. Каждый вариант — это самодостаточная концепция, отличающаяся от других существенно (тон, угол атаки, протагонист, центральный конфликт).

Каждый вариант содержит: label (короткое имя, например "тёмный", "оптимистичный"), logline (1-2 предложения), synopsis (3-6 абзацев), темы (2-5), протагониста, антагониста (если есть), сеттинг, арки (минимум 2 — обычно protagonist arc + main plot arc + subplot arc), оценку количества глав, архитектурный лист (architecture).

В synopsis обязаны быть названы четыре опорные точки, иначе структура нежизнеспособна: инцидент-завязка, поворот середины (событие, которое меняет постановку задачи, а не просто повышает ставки), низшая точка героя, кульминация. Не отделывайся связкой «затем события нарастают».

Архитектурный лист (architecture) — решения о строении истории, принятые ДО синопсиса; синопсис обязан им соответствовать. Ориентиры взяты из измерений человеческой и машинной прозы: машинный текст объясняет тему словами нарратора, держит одну тугую причинную цепь, раскрывает карты рано, решает финал выбором героя и его внутренним принятием. Человеческие значения умеренные — цель полоса, не противоположный полюс.
— themeHandling: stated / implied / withheld. По умолчанию implied: события несут тему, нарратор не формулирует урок.
— subplot: none / parallel / contrasting / independent. В большинстве вариантов подсюжет есть; contrasting или independent ценнее parallel.
— resolutionDriver: protagonist_choice / mixed / external. Примерно в половине вариантов исход решают случай, другие люди или обстоятельства, не выбор героя.
— endingMode: external_act / internal_acceptance / partial / open / catastrophic. Связка «выбор героя + внутреннее принятие + рост» — самый сильный машинный отпечаток финала. Не бери её по умолчанию; internal_acceptance допустим не более чем в одном варианте и только если премиса его требует.
— timeStructure: linear / moderate_anachrony / braided. Целевая полоса moderate_anachrony; braided только если премиса о времени.
— revelationPacing: front_loaded / even / back_loaded. Предпочтительно back_loaded: главные откровения во второй половине книги.
— emotionMode: explicit_led / behavior_led / embodied_led / mixed. Предпочтительно behavior_led: эмоции через поступки и прямое называние; телесные ощущения только на пиках.
— rarityMove: одно структурное решение, нетипичное для этой премисы. Ровно одно.
— humanMoves: 3–5 «человеческих» ходов под эту премису — какие из решений выше и почему. Не больше пяти: все ходы сразу дают новый отпечаток.
Варианты должны различаться и архитектурой, не только тоном.

Не дублируй варианты. Не пиши абстракции уровня "герой проходит путь". Каждый вариант должен быть достаточно конкретным, чтобы можно было сразу начать писать первую главу.`;

export const SYSTEM_CHAPTER_PLAN = `Ты — Plot Agent. Работаешь на русском языке.

Задача: из намерения автора по главе и контекста книги породить N вариантов beat-sheet'а главы. Каждый вариант — связная последовательность beats (3-15 штук) с типом, кратким описанием, целью, конфликтом и исходом.

Варианты должны отличаться: подходом к структуре (нарастающий темп vs шок-открытие в середине), POV-фокусом, эмоциональной траекторией, выбором кульминации, финалом (closing.mode).

Финал главы (closing) обязателен: mode — external_act / open / partial / internal_acceptance / catastrophic / cut_mid_action; note — одна фраза о том, чем именно глава заканчивается: действие, реплика, образ.
— По умолчанию глава заканчивается действием, репликой или обрывом, не осмыслением. Связка «герой всё понял, принял и решился» (internal_acceptance, внутреннее принятие) — машинный отпечаток; допустима не более чем в одном варианте и только если намерение автора её требует.
— Рефлексия не последний beat. Если beat осмысления нужен, ставь его перед финальным действием, один, не серию.
— В средней трети хотя бы один beat, которого начало главы не предсказывает: событие, а не рост ставок.
— Меняй плотность между соседними beats: диалоговый рядом с описательным, быстрый после медленного.

Контракт главы (contract) обязателен. Это не пересказ beats, а обязательства главы — по ним её потом проверяют:
— mustHappen: что обязано случиться. Не случилось — глава не выполнила план. 1-5 пунктов, каждый проверяем по тексту.
— mustNotHappen: чего в этой главе быть не должно — тайна, назначенная позже, встреча не в срок, смерть, которая нужна живой. Пусто оставляй, только если запретов действительно нет.
— expectedRevelations: что читатель узнаёт именно здесь. Попавшее сюда не считается упоминанием без подготовки.
— allowedCanonSupersessions: факты канона, которые эта глава вправе отменить. Каждый: statement (что перестаёт быть верным), becomes (чем становится) и factId вида fact_<число>, если факт есть в списке действующих выше. Это ЕДИНСТВЕННЫЙ способ разрешить главе противоречить канону: критик канона блокирует любое расхождение, которого здесь нет, — включая поворот, ради которого глава и пишется. Если глава ничего не отменяет, оставляй список пустым.

dialogueRegister — преобладающий регистр диалога в этой главе: neutral (обычный разговор), conflict (ссора, допрос, столкновение), vulnerable (признание, слабость), authority (приказ, отчёт старшему), intimate (близкие, наедине), stranger (с чужим). По нему подбираются образцы речи героев, поэтому он про то, КАК герои говорят в этой сцене, а не про то, чем она кончается.

Указывай: label, POV-персонаж, эмоциональную цель сцены, оценку слов в готовой главе, последовательность beats, closing, contract, dialogueRegister.`;

// ─────────── Outline ───────────

/** Свой предел ожидания у планировщика (живой прогон 2026-09-20).
 *
 *  Общий `LLM_TIMEOUT_MS` (120 с) рассчитан на короткий структурный ответ.
 *  План книги и беат-лист главы — самые большие ответы в проекте: логлайн,
 *  синопсис, арки, архитектурный лист, поглавные строки, контракт главы. На
 *  подписке такой ответ идёт две минуты и дольше, и общий предел рубил его
 *  ровно на середине — этап плана нельзя было пройти вообще. */
const PLOT_TIMEOUT_MS = 600_000;

export interface GenerateBookOutlineInput {
  bookTitle: string;
  premise: string;
  language: string;
  studioContext?: string | null;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
}

function buildBookOutlinePrompt(input: GenerateBookOutlineInput): string {
  const variants = input.config?.variants ?? 2;
  const parts: string[] = [
    `Книга: "${input.bookTitle}"`,
    `Язык: ${input.language}`,
    `Премиса автора:\n${input.premise}`,
  ];
  if (input.studioContext) {
    parts.push(`Контекст studio:\n${input.studioContext}`);
  }
  parts.push(
    `\nСгенерируй ровно ${variants} существенно различных вариантов outline.`,
  );
  return parts.join("\n\n---\n\n");
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
    timeoutMs: PLOT_TIMEOUT_MS,
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
  studioContext?: string | null;
  /** Phase 1 — top-k relevant chunks from prior chapters (hybridSearch). */
  retrievedContext?: string | null;
  /** Phase 4 — relevant open episodic notes (threads/foreshadow). */
  openThreads?: string | null;
  /** Слайс 4.5 — действующие факты канона с идентификаторами. Без них
   *  планировщик может назвать отменяемый факт только словами, и критику
   *  нечего сопоставлять по ссылке. */
  activeFacts?: string | null;
  chapterTitle: string;
  intent: string;
  previousChaptersSummary: string | null;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
}

export function buildChapterPlanPrompt(input: GenerateChapterPlanInput): string {
  const variants = input.config?.variants ?? 2;
  const stableParts: string[] = [
    `Книга: "${input.bookTitle}"`,
    `Премиса: ${input.bookPremise}`,
  ];
  if (input.studioContext) {
    stableParts.push(`Контекст studio:\n${input.studioContext}`);
  }
  if (input.retrievedContext) {
    stableParts.push(input.retrievedContext);
  }
  if (input.bookOutline) {
    stableParts.push(`Outline книги:\n${input.bookOutline}`);
  }
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Что было в предыдущих главах:\n${input.previousChaptersSummary}`,
    );
  }
  if (input.openThreads) {
    stableParts.push(input.openThreads);
  }
  if (input.activeFacts) {
    stableParts.push(input.activeFacts);
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
    timeoutMs: PLOT_TIMEOUT_MS,
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

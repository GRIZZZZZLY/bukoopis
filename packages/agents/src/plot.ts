import { z } from "zod";
import {
  registerAgentContract,
  dispatchStructured,
  type LocalModelRef,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  arcOutlineSchema,
  bookOutlineVariantSchema,
  outlineChapterSchema,
  chapterBeatSheetVariantSchema,
  voiceSampleSituationSchema,
  chapterClosingSchema,
  chapterContractSchema,
  narrativeArchitectureSchema,
  type BookOutlineVariant,
  type ChapterBeatSheetVariant,
  type GenerationConfig,
} from "@book-forge/shared";
import { AUTHOR_FACING_LANGUAGE_RULES } from "./language-rules.js";

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
        // Карточка структуры необязательна в хранилище (листы до неё),
        // обязательна на выходе.
        architecture: narrativeArchitectureSchema.extend({
          openingPoint: z.string().min(1),
          leftOpen: z.string().min(1),
          stance: z.string().min(1),
          teller: z.string().min(1),
          anchors: z.array(z.string().min(1)).min(1).max(6),
          places: z.array(z.string().min(1)).min(1).max(8),
          unsaid: z.string().min(1),
        }),
        // Обязателен на выходе, необязателен в хранилище — тот же приём, что
        // у `architecture` и `contract`. Без поглавных строк утверждать
        // нечего: автор генерировал план и упирался в «у варианта нет
        // поглавных строк» (живой прогон 2026-09-20).
        chapters: z.array(outlineChapterSchema).min(1).max(200),
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

Каждый вариант содержит: label (короткое имя, например "тёмный", "оптимистичный"), logline (1-2 предложения), synopsis (3-6 абзацев), темы (2-5), протагониста, антагониста (если есть), сеттинг, арки (минимум 2 — обычно protagonist arc + main plot arc + subplot arc), оценку количества глав, архитектурный лист (architecture) и ПОГЛАВНЫЙ СПИСОК (chapters): по строке на главу — название и цель обязательно, POV, конфликт, ставки и крючок короткой фразой, если они очевидны. Строки держи сжатыми, как в оглавлении, без пересказа. Без поглавного списка план нельзя утвердить, и вся работа над вариантом пропадает.

В synopsis обязаны быть названы четыре опорные точки, иначе структура нежизнеспособна: инцидент-завязка, поворот середины (событие, которое меняет постановку задачи; одного повышения ставок мало), низшая точка героя, кульминация. Не отделывайся связкой «затем события нарастают».

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
Дальше карточка структуры — по строке на решение:
— openingPoint: с какого момента начинается рассказ относительно хода событий. Начало рассказа и начало событий — разные решения; машинный текст начинает с первого события и с описания места.
— leftOpen: что в книге так и останется необъяснённым или нерешённым. Одна вещь, конкретно.
— stance: что герой делает такого, чего история не оправдывает; если герой задуман однозначным — почему.
— teller: кто рассказывает, кому, знает ли рассказчик, что его слушают.
— anchors: 1–6 конкретных названных вещей мира — книги, песни, улицы, заведения, марки, даты, реальные или внутримировые. Не жанровые отсылки без имени.
— places: 1–8 мест действия по ходу книги. Если история не сдвигается с одного места, это тоже решение, и его надо принять сознательно.
— unsaid: одна фраза о смысле книги, которой в тексте не будет ни у нарратора, ни у героев.
Не переворачивай каждое умолчание: книга, где все решения взяты с «человеческой» стороны, так же шаблонна. Меняй то, что пришло рефлексом; оставляй то, что нужно истории.
Модель, которая будет писать прозу, по замерам держит самую плоскую эскалацию событий и тихие финалы с эпилогом. В синопсисе положение героя ухудшается быстрее, чем кажется естественным, а кульминация может быть последней точкой книги, без эпилога.
Варианты должны различаться и архитектурой, и тоном.

Не дублируй варианты. Не пиши абстракции уровня "герой проходит путь". Каждый вариант должен быть достаточно конкретным, чтобы можно было сразу начать писать первую главу.

${AUTHOR_FACING_LANGUAGE_RULES}`;

export const SYSTEM_CHAPTER_PLAN = `Ты — Plot Agent. Работаешь на русском языке.

Задача: из намерения автора по главе и контекста книги породить N вариантов плана главы. Каждый вариант — последовательность beats (3-15 штук) с типом, кратким описанием, целью, конфликтом и исходом.

Две разные вещи — не смешивай их:
— Обязательства главы — это контракт (ниже): что обязано случиться и чего быть не должно. По нему главу проверяют.
— Beats — предлагаемый способ рассказать эти события. Это ориентир для писателя, текст по ним не размечается: писатель вправе одно событие задержать, другое передать одной фразой.

Варианты должны отличаться: POV-фокусом, эмоциональной траекторией, порядком и подробностью событий, тем, где глава останавливается (closing.mode). Не каждая глава строится вокруг кульминации и поворота: спокойная глава, переход, бытовая сцена — законные варианты, если того требует намерение автора.

Beat не обязан содержать локальный конфликт. Спокойный переход, совместная работа, обычный разговор — допустимые beats. Если у beat'а нет того, что мешает героям, пиши в conflict ровно «локального конфликта нет» — не выдумывай помеху. Conflict — обстоятельство сцены (кто или что мешает, чего герой не знает). Как проза это покажет, в conflict не входит: не пиши в план «тело реагирует раньше разума», «жест выдаёт страх» и подобные указания писателю. Исход (outcome) — что изменилось по фактам, коротко; эффект сцены на читателя сюда не входит.

Где глава останавливается (closing) обязателен: mode — external_act / open / partial / internal_acceptance / catastrophic / cut_mid_action; note — событие, на котором глава останавливается, одним фактом. Не пиши в note готовую последнюю фразу или картинку. Так можно: «Ивар уходит из таверны, не ответив». Так нельзя: «вышел в ветер, который был с севера».
— Связка «герой всё понял, принял и решился» (internal_acceptance, внутреннее принятие) — машинный отпечаток; допустима не более чем в одном варианте и только если намерение автора её требует.
— Рефлексия не последний beat. Если beat осмысления нужен, ставь его перед точкой остановки, один, не серию.

Контракт главы (contract) обязателен. Это обязательства главы, по ним её потом проверяют; пересказывать beats здесь не нужно:
— mustHappen: что обязано случиться. Не случилось — глава не выполнила план. 1-5 пунктов, каждый проверяем по тексту.
— mustNotHappen: чего в этой главе быть не должно — тайна, назначенная позже, встреча не в срок, смерть, которая нужна живой. Пусто оставляй, только если запретов действительно нет.
— expectedRevelations: что читатель узнаёт именно здесь. Попавшее сюда не считается упоминанием без подготовки.
— allowedCanonSupersessions: факты канона, которые эта глава вправе отменить. Каждый: statement (что перестаёт быть верным), becomes (чем становится) и factId вида fact_<число>, если факт есть в списке действующих выше. Это ЕДИНСТВЕННЫЙ способ разрешить главе противоречить канону: критик канона блокирует любое расхождение, которого здесь нет, — включая поворот, ради которого глава и пишется. Если глава ничего не отменяет, оставляй список пустым.

dialogueRegister — преобладающий регистр диалога в этой главе: neutral (обычный разговор), conflict (ссора, допрос, столкновение), vulnerable (признание, слабость), authority (приказ, отчёт старшему), intimate (близкие, наедине), stranger (с чужим). По нему подбираются образцы речи героев, поэтому он описывает, КАК герои говорят в этой сцене; чем она кончается, на него не влияет.

Указывай: label, POV-персонаж, эмоциональную цель сцены, оценку слов в готовой главе, последовательность beats, closing, contract, dialogueRegister.

${AUTHOR_FACING_LANGUAGE_RULES}`;

// ─────────── Outline ───────────

/** Свой предел ожидания у планировщика (живой прогон 2026-09-20).
 *
 *  Общий `LLM_TIMEOUT_MS` (120 с) рассчитан на короткий структурный ответ.
 *  План книги и беат-лист главы — самые большие ответы в проекте: логлайн,
 *  синопсис, арки, архитектурный лист, поглавные строки, контракт главы. На
 *  подписке такой ответ идёт две минуты и дольше, и общий предел рубил его
 *  ровно на середине — этап плана нельзя было пройти вообще. */
const PLOT_TIMEOUT_MS = 600_000;

/** У плана книги свой, больший предел: с обязательным поглавным списком
 *  (до двух вариантов по десятку-другому строк) ответ перестал укладываться в
 *  600 с — измерено живьём 2026-09-20, до требования глав уходило 496 с, после
 *  упиралось в таймаут. Вызов разовый на книгу, и отказ здесь дороже
 *  ожидания. */
const PLOT_OUTLINE_TIMEOUT_MS = 1_200_000;

export interface GenerateBookOutlineInput {
  bookTitle: string;
  premise: string;
  language: string;
  studioContext?: string | null;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
  /** Локальная модель мастерской (настройка книги); без неё — Claude. */
  local?: LocalModelRef;
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
    ...(input.local ? { local: input.local } : {}),
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 16000,
    timeoutMs: PLOT_OUTLINE_TIMEOUT_MS,
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

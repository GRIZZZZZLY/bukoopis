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

Твоя задача: написать связный текст главы по её плану.

Как писать:
— Пиши связную художественную прозу на русском в голосе, заданном профилем и образцами.
— Выбирай слова, которые естественны для этого повествователя, героя и ситуации. Простая формулировка подходит, если точно передаёт происходящее. Грамматика и понятность важны; специально добавлять ошибки, неряшливость или разговорные словечки не нужно.
— План задаёт события и ограничения. Распределяй внимание по ходу сцены: важный момент можно задержать, переход — передать кратко. Границы беатов не обязаны совпадать с абзацами. Не переноси формулировки плана в текст дословно; деталь может прийти не по порядку или остаться за кадром, если событие произошло.
— Герой может прямо подумать «я боялся», отложить ответ, повторить слово или заняться привычным делом. Выбирай реакцию из ситуации. Не добавляй телесный жест только ради демонстрации чувства.
— Обычные реплики и простые связующие предложения допустимы. Не придавай каждому предмету символическое значение. Не разъясняй уже понятный смысл поступка или разговора.
— Заверши главу в указанной событийной точке. Выразительность последней фразы определяется сценой и голосом книги.
— Образцы показывают манеру повествования. Их персонажи, события и характерные формулировки не относятся к нашей книге.

Требования:
— Соблюдай POV из beat-sheet. Объективный канон мира используй для непротиворечивости, но НЕ вкладывай в мысли/речь POV-персонажа то, чего он ещё не знает. Что каждый герой знает к началу сцены, перечислено под «Знает» в его карточке в блоке «Персонажи в сцене». Канон мира может быть шире: герой узнаёт не всё и не сразу.
— Не объясняй тему и иронию словами нарратора: смысл несут события. Нарратор не подводит итог, герой не формулирует, что он понял и чему научился.
— Блок «Замысел сцены» говорит, ИЗ ЧЕГО каждый участник действует: чего хочет здесь, о чём молчит, чем готов поступиться. Это знание для тебя, а не текст для читателя: не пересказывай карточку персонажа и не объясняй скрытую психологию после реплики. Замысел не отменяет контракт главы: где они спорят, сильнее контракт.
— Три уровня не смешивай: голос повествователя, восприятие POV и прямая речь персонажа — разные вещи. При близком POV выбор деталей может идти от опыта героя, но авторский синтаксис не обязан меняться под него целиком. Индивидуальность живёт прежде всего в прямой речи и в том, что герой замечает.
— Характер — не частотное правило. Инженер не обязан говорить числами, военный — приказами, замкнутый человек — односложно. Нейтральная общая реплика, смена регистра и поступок против самоописания допустимы, когда сцена даёт основание.
— Блок «Контракт главы» — обязательства, а не пожелания. Всё из «Обязано случиться» должно произойти в тексте. Ничто из «Чего быть не должно» не появляется — это запрет, и он сильнее беата: если beat требует запрещённого, выполняй запрет, а beat оставь несделанным. Названное в «Что раскрывается именно здесь» раскрывай здесь, не раньше и не позже.
— Где глава останавливается, сказано в блоке «Где глава останавливается»: это событие, а не готовая последняя фраза. Не подводи итог после этого события и не добавляй рефлексивного хвоста.
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
  /** Анкета непрерывности предыдущей главы: где герои остались, что при них,
   *  что осталось незакрытым. Исходная обстановка сцены. */
  sceneState?: string | null;
  characterContext: string | null;
  /** Замысел сцены (этап 5), уже отрендеренный: чего каждый участник хочет
   *  здесь, о чём молчит, где его граница. `null` — подготовка не удалась;
   *  Писатель идёт по тому же снимку без неё, а запуск помечает деградацию. */
  sceneIntent?: string | null;
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
  /** Режим «по беатам» (заимствование из litrab.ai: на длинной генерации
   *  сползают голоса, ритм и детали). Один вызов — один беат; стабильная
   *  часть промпта та же, меняется только этот блок. */
  beat?: { index: number; textSoFar: string };
}

/**
 * Volatile half of the Writer prompt — everything that changes per chapter or
 * per beat-sheet variant, so it sits outside the cache_control prefix.
 */
/** Нет локального конфликта — планировщик так и пишет (см. plot.ts). Строку
 *  «Что мешает: нет» Писателю не показываем: это приглашение выдумать помеху. */
function hasLocalConflict(conflict: string): boolean {
  return !/^\s*(локального\s+конфликта\s+нет|нет|—|-)\s*\.?\s*$/i.test(conflict);
}

/** Беат глазами Писателя: что происходит, что мешает (если мешает), к чему
 *  приходит. Тип беата (setup/climax…) и его «цель» — рабочие пометки
 *  планировщика: показанные Писателю, они превращали сцену в размеченный
 *  beat sheet, где каждая деталь «работает» (второй разбор 2026-09-23). */
function renderBeatForWriter(b: ChapterBeatSheetVariant["beats"][number]): string {
  const lines = [b.summary];
  if (hasLocalConflict(b.conflict)) lines.push(`   Что мешает: ${b.conflict}`);
  lines.push(`   К чему приходит: ${b.outcome}`);
  return lines.join("\n");
}

/** Где глава останавливается: событие и вид финала, без готовой фразы. */
function renderStopPoint(closing: NonNullable<ChapterBeatSheetVariant["closing"]>): string {
  return `Где глава останавливается (событие, а не готовая последняя фраза): ${renderChapterClosing(closing)}`;
}

export function buildWriterVolatilePrompt(input: WriteChapterInput): string {
  const beatsBlock = input.beatSheet.beats
    .map((b) => `${b.index + 1}. ${renderBeatForWriter(b)}`)
    .join("\n\n");

  const parts = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.beatSheet.pov}`,
    `Эмоциональная цель: ${input.beatSheet.emotionalGoal}`,
    `Целевой объём: ~${input.beatSheet.estimatedWords} слов`,
  ];
  // Замысел идёт ПЕРЕД беатами: беат говорит, что происходит, а замысел — из
  // чего герой в это идёт. Прочитанное раньше намерение окрашивает беаты;
  // прочитанное после выглядит комментарием к уже понятой сцене.
  if (input.sceneIntent) parts.push(input.sceneIntent);
  parts.push(`План событий (ориентир, а не разметка текста):\n${beatsBlock}`);
  // Контракт идёт сразу после beats и перед финалом: он их ограничивает, и
  // прочитанный раньше запрет весит больше, чем прочитанный после.
  if (input.beatSheet.contract) {
    const contract = renderChapterContract(input.beatSheet.contract);
    if (contract) parts.push(contract);
  }
  // Задание по беатам само несёт финал главы — но только последнему беату:
  // прочитанный раньше времени, он тянет модель закрывать главу на середине.
  if (input.beat) {
    parts.push(buildWriterBeatBlock(input));
    return parts.join("\n\n");
  }
  if (input.beatSheet.closing) {
    parts.push(renderStopPoint(input.beatSheet.closing));
  }
  parts.push("Напиши главу.");
  return parts.join("\n\n");
}

/** Блок одного беата. Идёт ПОСЛЕ контракта: запрет прочитан до задания. */
export function buildWriterBeatBlock(input: WriteChapterInput): string {
  const beat = input.beat;
  if (!beat) return "";
  const beats = input.beatSheet.beats;
  const total = beats.length;
  const current = beats[beat.index];
  if (!current) throw new Error(`beat index ${beat.index} out of range (${total})`);
  const isLast = beat.index === total - 1;
  const perBeatWords = Math.max(150, Math.round(input.beatSheet.estimatedWords / total));
  const lines = [
    "Режим: глава пишется по беатам, по одному вызову на беат.",
    beat.textSoFar.trim().length > 0
      ? `Уже написано (дословно; продолжай ровно с этого места, не повторяй и не пересказывай):\n${beat.textSoFar}`
      : "Уже написано: ничего — глава только начинается.",
    `Сейчас пиши ТОЛЬКО беат ${beat.index + 1} из ${total}:\n${renderBeatForWriter(current)}`,
    "Остальные беаты даны для ориентира — не забегай в них.",
    `Объём этого куска: ~${perBeatWords} слов.`,
  ];
  if (isLast) {
    lines.push(
      input.beatSheet.closing
        ? `Это последний беат — на нём глава останавливается. ${renderStopPoint(input.beatSheet.closing)}`
        : "Это последний беат — на нём глава останавливается. Не подводи итог и не добавляй рефлексивного хвоста.",
    );
  } else {
    lines.push(
      "Не завершай главу: не подводи итог, не ставь финальную точку сцены, не пиши рефлексивный хвост. Закончи там, где беат кончается по смыслу — можно на полуслове действия.",
    );
  }
  lines.push("Выведи только прозу этого беата.");
  return lines.join("\n\n");
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
  if (input.sceneState) stableParts.push(input.sceneState);
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

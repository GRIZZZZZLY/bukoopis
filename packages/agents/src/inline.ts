import { streamText, type SystemBlock } from "@book-forge/llm";
import {
  renderClicheRule,
  RU_DIALOGUE_RULE,
  SENSE_CHANNEL_LABELS,
  type GenerationConfig,
  type InlineCommand,
  type SenseChannel,
} from "@book-forge/shared";

export const INLINE_SYSTEM_BASE = `Ты — Inline Writer. Помогаешь автору переписывать или продолжать художественную прозу на русском, фрагмент за фрагментом.

Правила:
— Выводишь ТОЛЬКО прозу. Никаких пояснений, заголовков "Вот результат:", служебных пометок.
— Сохраняешь стиль, голос, тон и POV из контекста. Не меняешь персонажей и факты.
${renderClicheRule()}
${RU_DIALOGUE_RULE}
— Не цитируешь окружающий контекст; пишешь только новый/переписанный фрагмент.
— Не добавляешь лишних абзацев, пустых строк до/после ответа.`;

// «intensify» used to prescribe the tell we measure: emotion through bodily
// sensation runs ~38% in human corpora against ~81% in machine prose, and our
// own chapters were already embodied-led. Inline is a hand tool applied over
// and over, so the command now leads with behaviour and rations the body to
// the peak. «lengthen» is rebalanced away from stacking senses for the same
// reason (sensory density is another AI-drift feature).
export const INLINE_COMMAND_INSTRUCTIONS: Record<InlineCommand, string> = {
  continue: `Команда: продолжить с текущей точки. Selection пустой — пиши новый фрагмент, который естественно продолжает текст ДО курсора. Длина: 1-3 абзаца. Не повторяй уже написанное.`,
  rewrite: `Команда: переписать выделенный фрагмент. Сохрани смысл и события, но улучши прозу — естественнее, живее, без LLM-tells. Длина — близко к оригиналу.`,
  shorten: `Команда: сократить выделенный фрагмент. Сохрани все ключевые события, реплики, поворотные моменты. Убери воду, повторы, избыточные описания. Целевая длина — 50-70% от оригинала.`,
  intensify: `Команда: усилить эмоциональный заряд выделенного фрагмента. Основной инструмент — поступок, реплика и поведение: что персонаж делает, чего избегает, что говорит не к месту. Прямое называние чувства тоже допустимо. Телесную реакцию оставляй только на пике эпизода, не больше одного раза на фрагмент, и не из набора «сердце замерло / мурашки / холодок по спине». Сохрани события и длину (±20%).`,
  lengthen: `Команда: развернуть выделенный фрагмент. Разворачивай конкретикой: названные предметы, точные действия, мысли POV-персонажа, нюансы реплик. Не нагромождай ощущения — в одной фразе одно чувство, не три. Не добавляй новых сюжетных событий — только глубину тому что уже есть. Длина — 150-200% от оригинала.`,
  describe: `Команда: описать — вплести одну сенсорную деталь. Канал задаётся отдельно.`,
};

const SENSE_HINT: Record<SenseChannel, string> = {
  sight: "зрение — что видно: свет, цвет, движение, одна конкретная вещь в поле зрения",
  sound: "слух — что слышно или, наоборот, какой звук пропал",
  smell: "обоняние — запах, привязанный к месту или человеку",
  taste: "вкус — во рту, на губах, в воздухе",
  touch: "осязание — температура, фактура, вес, давление на кожу",
  metaphor:
    "метафора — одно сравнение или одна метафора, бытовая и предметная, без книжной приподнятости; не больше одного на фрагмент",
};

/** «Описать» — инструмент против сцены-схемы, а не для перегруза: одна
 *  деталь одного канала, фраза автора остаётся как есть. Текст ПОСЛЕ
 *  фрагмента модели не показывается — её дело насытить написанное, а не
 *  продолжить сцену. */
export function describeInstruction(sense: SenseChannel): string {
  return `Команда: описать. Канал: ${SENSE_CHANNEL_LABELS[sense].toLowerCase()} (${SENSE_HINT[sense]}).
Оставь выделенный фрагмент как есть — та же фраза, тот же порядок слов — и вплети в него или сразу за ним ОДНУ деталь этого канала. Одну, не три. Деталь конкретная, привязанная к этому месту и этому герою, не из набора штампов жанра.
Не переписывай остальное. Не добавляй событий, реплик и новых персонажей. Не объясняй ощущение и не называй чувство героя словом.
Длина: исходный фрагмент плюс не больше одного предложения. Верни фрагмент целиком, с вплетённой деталью.`;
}

export interface RunInlineInput {
  command: InlineCommand;
  selectionText: string | null;
  beforeText: string;
  afterText: string;
  bookContext: string;
  characterContext: string | null;
  loreContext: string | null;
  guidance?: string | null;
  sense?: SenseChannel | null;
  config?: GenerationConfig;
}

/**
 * Stable half of the Inline system prompt — rules plus the per-book
 * invariants. Extracted so prompt composition is directly testable.
 */
export function buildInlineStableSystem(input: RunInlineInput): string {
  const stableParts: string[] = [`Контекст книги:\n${input.bookContext}`];
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);
  return `${INLINE_SYSTEM_BASE}\n\n---\n\n${stableParts.join("\n\n")}`;
}

/** Volatile half — the text slice, the author's guidance and the command. */
export function buildInlineVolatilePrompt(input: RunInlineInput): string {
  const parts: string[] = [`Текст ДО редактируемого места:\n${input.beforeText}`];
  parts.push(
    input.selectionText
      ? `Выделенный фрагмент:\n${input.selectionText}`
      : "(Selection пустой — режим продолжения)",
  );
  // «Описать» текста ПОСЛЕ не видит намеренно: иначе модель начинает
  // продолжать сцену вместо того, чтобы насытить написанное.
  if (input.command !== "describe") {
    parts.push(`Текст ПОСЛЕ:\n${input.afterText}`);
  }
  if (input.guidance && input.guidance.trim()) {
    parts.push(`Дополнительные указания автора:\n${input.guidance}`);
  }
  if (input.command === "describe") {
    if (!input.sense) throw new Error('command "describe" requires sense');
    parts.push(describeInstruction(input.sense));
  } else {
    parts.push(INLINE_COMMAND_INSTRUCTIONS[input.command]);
  }
  return parts.join("\n\n");
}

export async function* runInlineCommand(
  input: RunInlineInput,
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
  // Stable: rules + book + characters + lore (per-book invariants).
  // Volatile: before/selection/after slice + per-call guidance + command.
  const system: SystemBlock[] = [
    {
      type: "text",
      text: buildInlineStableSystem(input),
      cache_control: { type: "ephemeral" },
    },
  ];

  // Most inline edits should use Sonnet for cost; only "intensify" benefits
  // measurably from Opus. Use Sonnet by default, allow override via config.
  const model =
    input.config?.model ?? (input.command === "intensify" ? "opus" : "sonnet");

  const gen = streamText({
    agentName: "inline",
    model,
    system,
    prompt: buildInlineVolatilePrompt(input),
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });

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

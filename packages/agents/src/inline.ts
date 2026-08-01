import { streamText, type SystemBlock } from "@book-forge/llm";
import {
  renderClicheRule,
  RU_DIALOGUE_RULE,
  type GenerationConfig,
  type InlineCommand,
} from "@book-forge/shared";

const SYSTEM_BASE = `Ты — Inline Writer. Помогаешь автору переписывать или продолжать художественную прозу на русском, фрагмент за фрагментом.

Правила:
— Выводишь ТОЛЬКО прозу. Никаких пояснений, заголовков "Вот результат:", служебных пометок.
— Сохраняешь стиль, голос, тон и POV из контекста. Не меняешь персонажей и факты.
${renderClicheRule()}
${RU_DIALOGUE_RULE}
— Не цитируешь окружающий контекст; пишешь только новый/переписанный фрагмент.
— Не добавляешь лишних абзацев, пустых строк до/после ответа.`;

const COMMAND_INSTRUCTIONS: Record<InlineCommand, string> = {
  continue: `Команда: продолжить с текущей точки. Selection пустой — пиши новый фрагмент, который естественно продолжает текст ДО курсора. Длина: 1-3 абзаца. Не повторяй уже написанное.`,
  rewrite: `Команда: переписать выделенный фрагмент. Сохрани смысл и события, но улучши прозу — естественнее, живее, без LLM-tells. Длина — близко к оригиналу.`,
  shorten: `Команда: сократить выделенный фрагмент. Сохрани все ключевые события, реплики, поворотные моменты. Убери воду, повторы, избыточные описания. Целевая длина — 50-70% от оригинала.`,
  intensify: `Команда: усилить эмоциональный заряд выделенного фрагмента. Конкретизируй ощущения через тело и действия (не "ему было страшно", а "руки дрожали"). Сохрани события и длину (±20%).`,
  lengthen: `Команда: развернуть выделенный фрагмент. Добавь сенсорные детали, мысли POV-персонажа, нюансы реплик. Не добавляй новых сюжетных событий — только глубину тому что уже есть. Длина — 150-200% от оригинала.`,
};

export interface RunInlineInput {
  command: InlineCommand;
  selectionText: string | null;
  beforeText: string;
  afterText: string;
  bookContext: string;
  characterContext: string | null;
  loreContext: string | null;
  guidance?: string | null;
  config?: GenerationConfig;
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
  // Stable: SYSTEM_BASE + book + characters + lore (per-book invariants).
  // Volatile: before/selection/after slice + per-call guidance + command.
  const stableParts: string[] = [`Контекст книги:\n${input.bookContext}`];
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);
  const stableSystem = `${SYSTEM_BASE}\n\n---\n\n${stableParts.join("\n\n")}`;
  const system: SystemBlock[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];

  const volatileParts: string[] = [
    `Текст ДО редактируемого места:\n${input.beforeText}`,
  ];
  if (input.selectionText) {
    volatileParts.push(`Выделенный фрагмент:\n${input.selectionText}`);
  } else {
    volatileParts.push("(Selection пустой — режим продолжения)");
  }
  volatileParts.push(`Текст ПОСЛЕ:\n${input.afterText}`);
  if (input.guidance && input.guidance.trim()) {
    volatileParts.push(`Дополнительные указания автора:\n${input.guidance}`);
  }
  volatileParts.push(COMMAND_INSTRUCTIONS[input.command]);

  // Most inline edits should use Sonnet for cost; only "intensify" benefits
  // measurably from Opus. Use Sonnet by default, allow override via config.
  const model =
    input.config?.model ?? (input.command === "intensify" ? "opus" : "sonnet");

  const gen = streamText({
    agentName: "inline",
    model,
    system,
    prompt: volatileParts.join("\n\n"),
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

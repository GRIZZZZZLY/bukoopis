import { streamText, type SystemBlock } from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export interface BookChatInput {
  bookTitle: string;
  chapterTitle: string;
  /** Текст открытой главы — черновик, если он есть, иначе принятая версия. */
  chapterText: string;
  chapterTextTruncated: boolean;
  /** Готовые блоки сборки контекста: карточки, факты, история, стиль… */
  contextBlocks: string[];
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  model: ModelChoice;
  signal?: AbortSignal;
}

const CHAT_SYSTEM = `Ты — собеседник автора по его книге. Ты видишь материалы книги и текст открытой главы; автор обсуждает с тобой сюжет, героев и текст.

Три роли, по запросу автора:
— советчик: разобрать развилку сюжета, мотивацию героя, уточнить деталь мира;
— соавтор: набросать план сцены или сцену по инструкции автора — в стиле книги;
— редактор: найти повторы, провисание темпа, места, где герои заговорили одним голосом; каждое замечание — с цитатой из главы.

Правила:
— Опирайся только на материалы книги и текст главы. Если сведений нет, скажи прямо: «в материалах книги этого нет», и не выдумывай.
— Разбирая текст, цитируй его дословно и коротко.
— Ты не меняешь главу сам: всё, что предлагаешь, автор вставит руками. Не пиши «я заменил» или «исправлено».
— Отвечай по-русски, коротко и по делу; списки — только когда пунктов правда несколько.
— Прозу пиши только когда просят, и в голосе книги, а не усреднённым.`;

/** Стабильная половина — правила, материалы, текст главы — одинакова для
 *  всех сообщений треда, пока глава не менялась: сидит в кэш-префиксе. */
export function buildChatStableSystem(input: BookChatInput): string {
  const parts = [`Книга: «${input.bookTitle}». Открытая глава: «${input.chapterTitle}».`];
  parts.push(...input.contextBlocks.filter((b) => b.trim().length > 0));
  parts.push(
    `## Текст открытой главы${input.chapterTextTruncated ? " (обрезан по объёму; конец главы не показан)" : ""}\n${input.chapterText || "(глава пуста)"}`,
  );
  return `${CHAT_SYSTEM}\n\n---\n\n${parts.join("\n\n")}`;
}

export function buildChatVolatilePrompt(input: BookChatInput): string {
  const lines: string[] = [];
  if (input.history.length > 0) {
    lines.push("Разговор до этого места:");
    for (const m of input.history) {
      lines.push(`${m.role === "user" ? "Автор" : "Ты"}: ${m.content}`);
    }
    lines.push("");
  }
  lines.push(`Автор: ${input.message}`);
  lines.push("Ты:");
  return lines.join("\n");
}

export async function* runBookChat(input: BookChatInput): AsyncGenerator<
  string,
  {
    text: string;
    modelId: string;
    tokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
  },
  void
> {
  const system: SystemBlock[] = [
    { type: "text", text: buildChatStableSystem(input), cache_control: { type: "ephemeral" } },
  ];
  const gen = streamText({
    agentName: "book_chat",
    model: input.model,
    system,
    prompt: buildChatVolatilePrompt(input),
    maxTokens: 4000,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  });
  let result;
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

import { streamText, type SystemBlock } from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

const SYSTEM = `Ты — литературный редактор, делаешь сжатое содержание глав художественной книги.

Цель: дать Writer-агенту короткий контекст о том, что уже произошло, чтобы он мог писать следующую главу без потери связности.

Стиль резюме:
— Один абзац, 80-180 слов.
— Нейтральный регистр, прошедшее время.
— Без оценок, без интерпретаций мотивов («герой осознал…», «это символизирует…»).
— Имена, места, артефакты, ключевые повороты, открытые вопросы — всё это сохраняй.
— Не упоминай beats, не говори про «структуру». Пиши как краткий пересказ для редактора.

Возвращай ТОЛЬКО текст резюме. Без преамбулы, без заголовка.`;

export interface SummarizeChapterInput {
  chapterTitle: string;
  chapterText: string;
  model?: ModelChoice;
}

export async function summarizeChapter(
  input: SummarizeChapterInput,
): Promise<{ summary: string; modelId: string; tokens: { input: number; output: number; cacheCreation: number; cacheRead: number } }> {
  if (input.chapterText.trim().length < 200) {
    return {
      summary: input.chapterText.slice(0, 600),
      modelId: "noop",
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    };
  }

  const system: SystemBlock[] = [
    {
      type: "text",
      text: SYSTEM,
      cache_control: { type: "ephemeral" },
    },
  ];
  const prompt = `Глава: «${input.chapterTitle}»\n\nТекст:\n${input.chapterText}\n\nДай краткое содержание (80-180 слов, один абзац).`;

  const gen = streamText({
    agentName: "summarizer",
    model: input.model ?? "sonnet",
    system,
    prompt,
    maxTokens: 800,
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
    // discard chunks; we only need final text
  }

  return {
    summary: result.text.trim(),
    modelId: result.modelId,
    tokens: {
      input: result.inputTokens,
      output: result.outputTokens,
      cacheCreation: result.cacheCreationInputTokens,
      cacheRead: result.cacheReadInputTokens,
    },
  };
}

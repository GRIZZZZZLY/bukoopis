import { streamText, type SystemBlock } from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

/**
 * Phase 2 — rolling-window memory.
 *
 * Compresses a run of already-summarized older chapters into ONE meta-summary
 * so the Writer/Plot prompt stays bounded as the book grows (recent chapters
 * keep their verbatim per-chapter summary; everything older collapses here).
 */

const SYSTEM = `Ты — литературный редактор. Делаешь единое сжатое содержание группы ранних глав художественной книги.

Цель: дать Writer-агенту компактный, но непрерывный контекст о том, что произошло за все ранние главы, чтобы он не терял связность на длинной книге.

Стиль:
— 200-400 слов, 2-4 абзаца, прошедшее время, нейтральный регистр.
— Сохраняй: имена персонажей, места, артефакты, ключевые сюжетные повороты, открытые линии и невыполненные обещания (foreshadowing).
— Соблюдай хронологию. Не оценивай, не интерпретируй мотивы, не упоминай «структуру»/«beats».
— Это рекурсивное сжатие уже сжатых резюме — не выдумывай деталей, которых нет во входных резюме.

Возвращай ТОЛЬКО текст мета-резюме. Без преамбулы, без заголовка.`;

export interface MetaSummarizeInput {
  bookTitle: string;
  /** Ordered per-chapter summaries (earliest first), already compressed. */
  chapterSummaries: Array<{ order: number; title: string; summary: string }>;
  model?: ModelChoice;
}

export interface MetaSummarizeResult {
  summary: string;
  modelId: string;
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
}

export async function metaSummarize(
  input: MetaSummarizeInput,
): Promise<MetaSummarizeResult> {
  const joined = input.chapterSummaries
    .map((c) => `Глава #${c.order} «${c.title}»:\n${c.summary}`)
    .join("\n\n");

  // Nothing meaningful to compress — return the concatenation untouched.
  if (joined.trim().length < 200) {
    return {
      summary: joined.trim(),
      modelId: "noop",
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    };
  }

  const system: SystemBlock[] = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
  ];
  const prompt = `Книга: «${input.bookTitle}»\n\nРезюме ранних глав (по порядку):\n\n${joined}\n\nДай единое мета-резюме (200-400 слов).`;

  const gen = streamText({
    agentName: "summarizer",
    model: input.model ?? "sonnet",
    system,
    prompt,
    maxTokens: 1200,
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
    // discard chunks; only final text matters
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

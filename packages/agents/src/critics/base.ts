import {
  callStructured,
  type AgentName,
  type StructuredUsage,
  type SystemBlock,
} from "@book-forge/llm";
import {
  criticReportSchema,
  type CriticReport,
  type CriticType,
  type GenerationConfig,
} from "@book-forge/shared";

export interface CriticInput {
  chapterText: string;
  chapterTitle: string;
  pov: string;
  emotionalGoal: string;
  /** Rendered accepted beat-sheet of the chapter (optional; editor critic uses it). */
  beatSheet?: string | null;
  bookContext: string; // premise + outline
  previousChaptersSummary: string | null;
  /** Финал предыдущей главы дословно и найденные фрагменты ранних глав —
   *  та же история, что видел Writer (AC-36). Без них критик сверял главу с
   *  пересказами и не мог заметить, что она повторяет уже написанное
   *  предложение или рвёт незакрытое действие. */
  previousChapterTail?: string | null;
  retrievedContext?: string | null;
  /** Контракт главы (слайс 4.5), уже отрендеренный: что обязано случиться,
   *  чего быть не должно, что раскрывается и какие факты канона глава вправе
   *  отменить. Без него критик канона блокирует запланированный поворот. */
  chapterContract?: string | null;
  characterContext: string | null;
  loreContext: string | null;
  /**
   * Rendered style fingerprint of the book's target style profile. Only the
   * style critic uses it — without it the critic judges prose against a
   * generic "clean LLM prose" bar and flags a deliberately dense author voice
   * as a defect.
   */
  styleContext?: string | null;
  /**
   * Measured structural LLM tells for this chapter (renderStructuralTells in
   * style-engine): counts per 1000 words with quoted examples. Only the style
   * critic uses it — evidence instead of impression.
   */
  structuralTellsContext?: string | null;
  config?: GenerationConfig;
  onUsage?: (usage: StructuredUsage & { critic: CriticType }) => void;
}

/**
 * Shared calibration for the prose critics. Distilled from the sepia review
 * protocol and Wikipedia's "Signs of AI writing" ineffective-indicators list:
 * a single hit is not a verdict, a quote is mandatory, and several things that
 * look like tells in English are ordinary in Russian prose.
 */
export const CRITIC_CALIBRATION_RULE = `Калибровка:
— Сигнал только с цитатой. Нет цитаты — нет замечания.
— Один маркер не вердикт. Отмечай кластеры и повторяемость; единичное попадание — максимум nit.
— Не считай дефектом: тире в диалоге и в пунктуации (норма русского текста); длинные периоды и плотную метафорику, если их предписывает блок «Стиль»; безупречную грамматику; формальный регистр; переходные слова сами по себе.
— Не требуй противоположного полюса: цель — умеренность, а не вычистить все сравнения или раздробить все предложения. Если текст уже на пределе (фрагменты, стаккато, обрывы), отмечай перегиб отдельно как over-correction, не как ИИ-признак.`;

/**
 * История книги для критика или Reviser'а — одним местом. Этот блок был
 * переписан шесть раз (четыре критика, база и Reviser), и каждая копия
 * знала только о пересказе. Поле, добавленное в одну, молча не доходило до
 * остальных — ровно так архитектурный лист когда-то дошёл до критиков и не
 * дошёл до Reviser'а.
 */
export function renderHistoryBlocks(
  input: Pick<CriticInput, "previousChaptersSummary" | "previousChapterTail" | "retrievedContext">,
): string[] {
  const parts: string[] = [];
  if (input.retrievedContext) parts.push(input.retrievedContext);
  if (input.previousChaptersSummary) {
    parts.push(`Предыдущие главы (краткое):\n${input.previousChaptersSummary}`);
  }
  if (input.previousChapterTail) {
    parts.push(
      `Финал предыдущей главы (дословно, последние абзацы):\n${input.previousChapterTail}`,
    );
  }
  return parts;
}

const criticOutputSchema = criticReportSchema.omit({ critic: true });

export interface RunCriticOptions {
  critic: CriticType;
  agentName: AgentName;
  system: string;
  task: string;
  input: CriticInput;
}

export async function runCritic(
  opts: RunCriticOptions,
): Promise<CriticReport> {
  const stableParts: string[] = [
    `Книга/контекст:\n${opts.input.bookContext}`,
    ...renderHistoryBlocks(opts.input),
  ];
  if (opts.input.characterContext) stableParts.push(opts.input.characterContext);
  if (opts.input.loreContext) stableParts.push(opts.input.loreContext);
  const stableSystem = `${opts.system}\n\n---\n\n${stableParts.join("\n\n")}`;
  const system: SystemBlock[] = [
    { type: "text", text: stableSystem, cache_control: { type: "ephemeral" } },
  ];

  const volatileParts: string[] = [
    `Глава: "${opts.input.chapterTitle}"`,
    `POV: ${opts.input.pov}`,
    `Эмоциональная цель: ${opts.input.emotionalGoal}`,
    `Текст главы:\n\n${opts.input.chapterText}`,
    `\nЗадача:\n${opts.task}`,
  ];

  const result = await callStructured({
    agentName: opts.agentName,
    model: opts.input.config?.model ?? "sonnet",
    system,
    prompt: volatileParts.join("\n\n"),
    schema: criticOutputSchema,
    schemaName: `submit_${opts.critic}_critique`,
    schemaDescription: `Submit a structured critique report from the ${opts.critic} critic. Return all issues found with severity and concrete suggestions.`,
    ...(opts.input.config?.temperature !== undefined
      ? { temperature: opts.input.config.temperature }
      : {}),
    maxTokens: 4096,
    onUsage: opts.input.onUsage
      ? (usage) => opts.input.onUsage?.({ ...usage, critic: opts.critic })
      : undefined,
  });

  return { ...result, critic: opts.critic } as CriticReport;
}

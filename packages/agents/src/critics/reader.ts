import type { z } from "zod";
import type { CriticReport } from "@book-forge/shared";
import { criticReportSchema } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { CRITIC_CALIBRATION_RULE, renderHistoryBlocks, reportCriticUsage, type CriticInput } from "./base.js";

export const READER_CRITIC_SYSTEM = `Ты — Reader-Experience критик. Твоя задача — представить себя обычным читателем и оценить эмоциональный отклик на текст.

Ты не редактируешь стиль и не сверяешь канон. Ты говоришь: что чувствую как читатель, где скучаю, где не верю, где захвачен.

Что отмечать:
- Места где теряется внимание (можно ли пропустить абзац без потери?)
- Эмоциональная пустота: персонаж в ужасе/радости, но я как читатель не чувствую
- Непонятные мотивации (почему он так поступает?)
- Напряжение есть/нет: ставки, риск, неопределённость
- Сопереживание герою (или равнодушие)
- Достоверность: верю ли я в эту реакцию/диалог/решение?
- Желание продолжать чтение в конце главы
- Финал через осмысление: последние абзацы отвечают на «что это значит» и «что герой теперь чувствует», а не показывают действие
- Предсказуемая середина: в средней части не происходит ничего, чего я не ждал по началу; ставки растут, событий нет
- Одна плотность на всю главу: сцена покоя и сцена ужаса читаются в одном темпе
- Нарратор объясняет тему словами вместо того, чтобы дать мне понять её по событиям

Severity:
- "blocking": глава не вызывает заявленной эмоции; читатель отключается.
- "suggestion": эмоциональные провалы в нескольких местах.
- "nit": единичная неубедительность.

Пиши от первого лица читателя: "я не верю", "я скучал", "захватило". Цитируй где именно.

${CRITIC_CALIBRATION_RULE}`;

const TASK = `Прочитай главу как читатель. Где я отключился? Где сопереживал? Достигнута ли заявленная эмоциональная цель? Объясни конкретно, со ссылками на фрагменты.`;

const readerOutputSchema = criticReportSchema.omit({ critic: true });
type ReaderCriticOutput = z.infer<typeof readerOutputSchema>;

function buildReaderPrompt(input: CriticInput): string {
  const stableParts: string[] = [
    `Книга/контекст:\n${input.bookContext}`,
    ...renderHistoryBlocks(input),
  ];
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);

  const volatileParts: string[] = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
    `Текст главы:\n\n${input.chapterText}`,
    `\nЗадача:\n${TASK}`,
  ];

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const readerCriticContract: AgentStructuredContract<CriticInput, ReaderCriticOutput> = {
  agentName: "critic_reader",
  getOutputSchema: () => readerOutputSchema,
  systemPrompt: READER_CRITIC_SYSTEM,
  buildPrompt: buildReaderPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_critique_reader",
    toolDescription:
      "Submit a structured critique report from the reader-experience critic. Return all issues found with severity and concrete suggestions.",
    // Пять ходов, а не три по умолчанию: на подписке критик один раз вернул
    // «модель не вызвала инструмент» — ровно так выглядит исчерпание ходов на
    // длинном отчёте (живой прогон 2026-09-20). Лишние ходы тратятся только
    // там, где без них был бы отказ.
    maxTurns: 5,
  },
};

export function registerReaderCriticContract(): void {
  registerAgentContract(readerCriticContract);
}

export async function runReaderExperienceAgent(
  input: CriticInput,
): Promise<CriticReport> {
  const { raw, diagnostics } = await dispatchStructured<CriticInput, ReaderCriticOutput>({
    agentName: "critic_reader",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  reportCriticUsage(input, "reader", diagnostics);
  return { ...raw, critic: "reader" } as CriticReport;
}

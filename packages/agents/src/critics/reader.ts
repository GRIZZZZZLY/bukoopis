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

Ты не редактируешь стиль и не сверяешь канон. Ты говоришь: где мне как читателю трудно, где не верится, где повтор.

Что отмечать — всегда с конкретным местом:
- Где трудно следить: я теряю, кто говорит, где мы, что сейчас произошло
- Где не верится: реакция, реплика или решение не вяжутся с тем, что я знаю о герое и ситуации
- Где повтор: то, что я уже понял, объясняют ещё раз — нарратор, герой или деталь
- Где непонятна мотивация: я не понимаю, почему герой так поступает, и текст не даёт мне основания догадаться
- Где нарратор объясняет смысл словами вместо того, чтобы дать мне понять его по событиям
- Где текст старается произвести впечатление: образ ради образа, реплика ради цитаты

Не считай дефектами сами по себе: спокойствие, бытовые подробности, паузы, обычные реплики, отсутствие сильной эмоции, отсутствие крючка в конце, прямо названное чувство. Не требуй «показать чувство через тело»: такая подсказка приводит к штампу «руки сами», «раньше, чем понял». Спокойная сцена не обязана «держать в напряжении». Абзац, который можно пропустить, не дефект, если он даёт сцене воздух или время.

Если читать было легко и я верил происходящему, так и скажи в overallNotes и не придумывай замечаний ради количества.

Severity:
- "blocking": я перестаю понимать происходящее или не верю ключевому поступку.
- "suggestion": заметный повтор или неверная реакция в нескольких местах.
- "nit": единичная неубедительность.

Пиши от первого лица читателя: «я не верю», «здесь я потерялся», «это мне уже сказали». Цитируй, где именно.

${CRITIC_CALIBRATION_RULE}`;

const TASK = `Прочитай главу как читатель. Где мне трудно следить, где не верится, где повтор? Объясни конкретно, со ссылками на фрагменты.`;

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

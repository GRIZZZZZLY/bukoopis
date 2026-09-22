import type { z } from "zod";
import type { CriticReport } from "@book-forge/shared";
import { criticReportSchema } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import { renderHistoryBlocks, reportCriticUsage, type CriticInput } from "./base.js";

export const CANON_SYSTEM = `Ты — Canon Guard, критик канона художественной книги. Работаешь на русском.

Твоя единственная цель — найти противоречия канону: персонажу/локации/предмету/прежним главам/правилам мира. Ты не оцениваешь стиль, ритм или эмоции — только факты и непрерывность.

Severity:
- "blocking": явное противоречие установленному факту (имя, родственники, способности, географическое положение, прежние события). Блокирует публикацию.
- "suggestion": возможное несоответствие, требует проверки автором (двусмысленность, спорная интерпретация).
- "nit": мелкая неточность стиля повествования (например, упоминание объекта без подготовки).

Контракт главы (если он передан) — это разрешения автора, а не текст для проверки:
— Факт, названный в «Факты канона, которые эта глава вправе отменить», глава меняет НАМЕРЕННО. Это не замечание. Не предлагай вернуть прежнее значение и не требуй согласовать его с каноном: канон здесь и меняется.
— Расхождение с фактом, которого в контракте нет, — замечание прежней тяжести. Разрешение на один факт не снимает проверку с остальных.
— Сведение из «Что раскрывается именно здесь» раскрывается по плану: не отмечай его как упоминание без подготовки.

Каждое замечание — короткое, с цитатой из текста и конкретной правкой.`;

const TASK = `Проверь главу на противоречия канону. Сверяй факты с разделами «Персонажи», «Локации», «Артефакты», «Открытые крючки», «Предыдущие главы» (если есть). Если канона мало — отмечай это в overallNotes, но не выдумывай несуществующие факты.

Возвращай: список issues + overallNotes (1-3 предложения о состоянии канона главы).`;

const canonOutputSchema = criticReportSchema.omit({ critic: true });
type CanonCriticOutput = z.infer<typeof canonOutputSchema>;

export function buildCanonPrompt(input: CriticInput): string {
  const stableParts: string[] = [
    `Книга/контекст:\n${input.bookContext}`,
    ...renderHistoryBlocks(input),
  ];
  if (input.chapterContract) stableParts.push(input.chapterContract);
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

const canonCriticContract: AgentStructuredContract<CriticInput, CanonCriticOutput> = {
  agentName: "critic_canon",
  getOutputSchema: () => canonOutputSchema,
  systemPrompt: CANON_SYSTEM,
  buildPrompt: buildCanonPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_critique_canon",
    toolDescription:
      "Submit a structured critique report from the canon critic. Return all issues found with severity and concrete suggestions.",
    // Пять ходов, а не три по умолчанию: на подписке критик один раз вернул
    // «модель не вызвала инструмент» — ровно так выглядит исчерпание ходов на
    // длинном отчёте (живой прогон 2026-09-20). Лишние ходы тратятся только
    // там, где без них был бы отказ.
    maxTurns: 5,
  },
};

export function registerCanonCriticContract(): void {
  registerAgentContract(canonCriticContract);
}

export async function runCanonGuard(input: CriticInput): Promise<CriticReport> {
  const { raw, diagnostics } = await dispatchStructured<CriticInput, CanonCriticOutput>({
    agentName: "critic_canon",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  reportCriticUsage(input, "canon", diagnostics);
  return { ...raw, critic: "canon" } as CriticReport;
}

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
  bookContext: string; // premise + outline
  previousChaptersSummary: string | null;
  characterContext: string | null;
  loreContext: string | null;
  config?: GenerationConfig;
  onUsage?: (usage: StructuredUsage & { critic: CriticType }) => void;
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
  ];
  if (opts.input.previousChaptersSummary) {
    stableParts.push(
      `Предыдущие главы (краткое):\n${opts.input.previousChaptersSummary}`,
    );
  }
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

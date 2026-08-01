import { z } from "zod";
import type { BookConcept, ContextRef, StageId } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredProgressEvent,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export interface AspectPlaybookInput {
  stageId: StageId;
  concept: BookConcept;
  /** Already-existing aspect names so the LLM doesn't propose duplicates. */
  existingAspectNames: string[];
  contextRef: ContextRef;
}

const proposedAspectSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(400),
  required: z.boolean(),
  payloadKind: z.literal("markdown"),
});

const aspectPlaybookOutputSchema = z.object({
  aspects: z.array(proposedAspectSchema).min(3).max(9),
});

export type AspectPlaybookOutput = z.infer<typeof aspectPlaybookOutputSchema>;
export type ProposedAspect = z.infer<typeof proposedAspectSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const SYSTEM = `Ты — литературный соавтор, формирующий содержание книжной библии. Работаешь на русском.

Текущая задача — предложить список *аспектов* для одной стадии. Аспект — это короткое тематическое поле (например, для стадии Мир: "география", "политика", "магия"; для стадии Лор: "космогония", "фракции", "религия"). Каждый аспект потом будет раскрыт отдельно (5-9 аспектов суммарно).

Стиль аспектов: одно-два слова на русском, без штампов, согласовано с жанрами/тоном/аудиторией концепта.

Поле required:
- true: без этого аспекта стадия не может считаться завершённой (например, "география" для Мир);
- false: дополняющий аспект, можно пропустить.

Возвращай только аспекты с payloadKind === "markdown". Сейчас поддерживается только текстовый формат.

Не дублируй уже существующие аспекты из existingAspectNames.`;

function buildPrompt(input: AspectPlaybookInput): string {
  const parts: string[] = [
    `Стадия: ${STAGE_LABELS[input.stageId]}`,
    "",
    "КОНЦЕПТ:",
    `Жанры: ${[...input.concept.genres, ...(input.concept.customGenres ?? [])].join(", ") || "не выбраны"}`,
    `Тон: ${[...input.concept.tones, ...(input.concept.customTones ?? [])].join(", ") || "не выбран"}`,
    `Аудитория: ${input.concept.audience}`,
  ];
  if (input.concept.premise.logline) {
    parts.push("", "Логлайн:", input.concept.premise.logline);
  }
  if (input.existingAspectNames.length > 0) {
    parts.push(
      "",
      `Уже существующие аспекты (НЕ дублируй): ${input.existingAspectNames.join(", ")}`,
    );
  }
  parts.push(
    "",
    `Сгенерируй 5–9 аспектов для стадии "${STAGE_LABELS[input.stageId]}".`,
  );
  return parts.join("\n");
}

const aspectPlaybookContract: AgentStructuredContract<
  AspectPlaybookInput,
  AspectPlaybookOutput
> = {
  agentName: "aspect_playbook",
  getOutputSchema: () => aspectPlaybookOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_playbook",
    toolDescription:
      "Submit a list of 5–9 markdown aspects proposed for a stage. Each aspect has name, description, required flag.",
  },
};

export function registerAspectPlaybookContract(): void {
  registerAgentContract(aspectPlaybookContract);
}

export interface RunAspectPlaybookOptions {
  model?: ModelChoice;
  temperature?: number;
  /** Вехи вызова для SSE-прогресса в UI. */
  onProgress?: (e: StructuredProgressEvent) => void;
}

export async function runAspectPlaybook(
  input: AspectPlaybookInput,
  options: RunAspectPlaybookOptions = {},
): Promise<AspectPlaybookOutput> {
  const { raw } = await dispatchStructured<
    AspectPlaybookInput,
    AspectPlaybookOutput
  >({
    agentName: "aspect_playbook",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.onProgress !== undefined
      ? { onProgress: options.onProgress }
      : {}),
    maxTokens: 2048,
  });
  return raw;
}

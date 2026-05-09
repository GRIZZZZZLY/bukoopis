import { z } from "zod";
import type {
  AspectVariant,
  BookConcept,
  ContextRef,
  StageId,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export interface AspectRefineInput {
  stageId: StageId;
  concept: BookConcept;
  aspect: {
    id: string;
    name: string;
    description?: string;
  };
  parentVariant: {
    id: string;
    payload: string;
    label: string;
  };
  instructions: string;
  /** Other accepted aspects in the same stage. */
  accumulated: Array<{ name: string; finalPayload: string }>;
  contextRef: ContextRef;
}

const refinedVariantSchema = z.object({
  label: z.string().min(1).max(60),
  payload: z.string().min(20).max(20000),
});

const aspectRefineOutputSchema = z.object({
  variant: refinedVariantSchema,
});

export type AspectRefineOutput = z.infer<typeof aspectRefineOutputSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const SYSTEM = `Ты — литературный соавтор. Работаешь на русском. Тебе дают существующий вариант раскрытия аспекта и инструкции автора по его доработке. Твоя задача — выдать ОДИН новый вариант, учитывающий инструкции, в той же форме (markdown-абзац 200–500 слов).

Сохраняй внутреннюю согласованность: учитывай все принятые аспекты той же стадии. Не придумывай противоречий с ними.

Label: одно-два слова, кратко описывающие изменение ("темнее", "короче", "с фракцией X").`;

function buildPrompt(input: AspectRefineInput): string {
  const parts: string[] = [
    `Стадия: ${STAGE_LABELS[input.stageId]}`,
    `Аспект: ${input.aspect.name}`,
  ];
  if (input.aspect.description) {
    parts.push(`Описание аспекта: ${input.aspect.description}`);
  }
  parts.push(
    "",
    "ИСХОДНЫЙ ВАРИАНТ:",
    `Label: ${input.parentVariant.label}`,
    input.parentVariant.payload,
    "",
    "ИНСТРУКЦИИ ОТ АВТОРА:",
    input.instructions,
  );
  if (input.accumulated.length > 0) {
    parts.push("", "ПРИНЯТЫЕ АСПЕКТЫ ТОЙ ЖЕ СТАДИИ:");
    for (const a of input.accumulated) {
      parts.push(`### ${a.name}`, a.finalPayload, "");
    }
  }
  parts.push(
    "",
    "Выдай ОДИН доработанный вариант, согласно инструкциям. НЕ дублируй исходник дословно.",
  );
  return parts.join("\n");
}

const aspectRefineContract: AgentStructuredContract<
  AspectRefineInput,
  AspectRefineOutput
> = {
  agentName: "aspect_refine",
  getOutputSchema: () => aspectRefineOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_refined_variant",
    toolDescription:
      "Submit one refined markdown variant of an existing aspect variant, following user instructions.",
  },
};

export function registerAspectRefineContract(): void {
  registerAgentContract(aspectRefineContract);
}

export interface RunAspectRefineOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runAspectRefine(
  input: AspectRefineInput,
  options: RunAspectRefineOptions = {},
): Promise<AspectRefineOutput> {
  const { raw } = await dispatchStructured<
    AspectRefineInput,
    AspectRefineOutput
  >({
    agentName: "aspect_refine",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    maxTokens: 2048,
  });
  return raw;
}

/** Helper: take refine output and produce a storable AspectVariant
 *  linked to the parent via parentVariantId. */
export function toStoredRefinedVariant(
  output: AspectRefineOutput,
  meta: {
    parentVariantId: string;
    contextRef: ContextRef;
    modelId: string;
  },
): AspectVariant {
  return {
    id: crypto.randomUUID(),
    label: output.variant.label,
    payloadKind: "markdown" as const,
    payload: output.variant.payload,
    status: "generated" as const,
    editSource: "refine" as const,
    parentVariantId: meta.parentVariantId,
    generatedAt: new Date().toISOString(),
    modelId: meta.modelId,
    contextRef: meta.contextRef,
  };
}

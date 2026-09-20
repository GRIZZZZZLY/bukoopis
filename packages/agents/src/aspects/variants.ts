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
  type StructuredProgressEvent,
  type StructuredUsage,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export interface AspectVariantsInput {
  stageId: StageId;
  concept: BookConcept;
  aspect: {
    id: string;
    name: string;
    description?: string;
  };
  /** Accumulated context from already-accepted aspects in this stage. */
  accumulated: Array<{ name: string; finalPayload: string }>;
  draft?: string;
  contextRef: ContextRef;
}

const variantPayloadSchema = z.string().min(20).max(20000);

const proposedVariantSchema = z.object({
  label: z.string().min(1).max(60),
  payload: variantPayloadSchema,
});

const aspectVariantsOutputSchema = z.object({
  variants: z.array(proposedVariantSchema).min(2).max(3),
});

export type AspectVariantsOutput = z.infer<typeof aspectVariantsOutputSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const SYSTEM = `Ты — литературный соавтор, раскрывающий аспект книжной библии в нескольких альтернативных формулировках. Работаешь на русском.

На вход даётся: стадия (мир/лор/...), концепт книги, имя аспекта (например, "география"), уже принятые аспекты той же стадии (контекст), опционально черновик от автора.

Цель: выдать 2–3 НЕЗАВИСИМЫХ варианта, каждый — самостоятельная подача аспекта в виде markdown-абзаца (200–500 слов). Не "продолжение" предыдущего, а альтернативное направление.

Стиль: ёмко, конкретно, без штампов и общих мест. Согласовано с жанрами/тоном/аудиторией концепта. Учти все принятые аспекты — варианты должны им не противоречить.

Если дан ЧЕРНОВИК ОТ АВТОРА: его конкретика (имена, факты, образы, заданные ограничения) обязательна к сохранению во ВСЕХ вариантах — это материал автора, а не одна из версий. Варьируй подачу, акценты и следствия из черновика, но не отменяй и не заменяй то, что автор уже решил. Пробелы в черновике — как раз то место, где варианты должны расходиться.

У каждого варианта есть короткий label (одно-два слова, отличающее этот вариант: "морской", "пустынный", "тёмный", "героический" и т.п.) и payload — собственно текст.`;

function buildPrompt(input: AspectVariantsInput): string {
  const parts: string[] = [
    `Стадия: ${STAGE_LABELS[input.stageId]}`,
    `Аспект: ${input.aspect.name}`,
  ];
  if (input.aspect.description) {
    parts.push(`Описание аспекта: ${input.aspect.description}`);
  }
  parts.push(
    "",
    "КОНЦЕПТ:",
    `Жанр: ${input.concept.genre ?? "не задан"}`,
    `Тон: ${input.concept.tone ?? "не задан"}`,
    `Аудитория: ${input.concept.audience}`,
  );
  if (input.concept.premise.logline) {
    parts.push("Логлайн:", input.concept.premise.logline);
  }
  if (input.accumulated.length > 0) {
    parts.push("", "ПРИНЯТЫЕ АСПЕКТЫ ЭТОЙ ЖЕ СТАДИИ (ниже — порядковый):");
    for (const a of input.accumulated) {
      parts.push(`### ${a.name}`, a.finalPayload, "");
    }
  }
  if (input.draft && input.draft.trim()) {
    parts.push("ЧЕРНОВИК ОТ АВТОРА:", input.draft.trim());
  }
  parts.push(
    "",
    `Сгенерируй 2–3 разных по углу варианта раскрытия аспекта "${input.aspect.name}". Каждый вариант — markdown-абзац 200–500 слов.`,
  );
  return parts.join("\n");
}

const aspectVariantsContract: AgentStructuredContract<
  AspectVariantsInput,
  AspectVariantsOutput
> = {
  agentName: "aspect_variants",
  getOutputSchema: () => aspectVariantsOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_variants",
    toolDescription:
      "Submit 2–3 alternative markdown payloads for a single stage aspect.",
  },
};

export function registerAspectVariantsContract(): void {
  registerAgentContract(aspectVariantsContract);
}

export interface RunAspectVariantsOptions {
  model?: ModelChoice;
  temperature?: number;
  /** Вехи вызова для SSE-прогресса в UI. */
  onProgress?: (e: StructuredProgressEvent) => void;
  /** Расход вызова. Без него работа Мастерской не попадала в журнал
   *  расходов вовсе: шестнадцать вызовов агентов и ни одной строки. */
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export async function runAspectVariants(
  input: AspectVariantsInput,
  options: RunAspectVariantsOptions = {},
): Promise<AspectVariantsOutput> {
  const { raw, diagnostics } = await dispatchStructured<
    AspectVariantsInput,
    AspectVariantsOutput
  >({
    agentName: "aspect_variants",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.onProgress !== undefined
      ? { onProgress: options.onProgress }
      : {}),
    maxTokens: 4096,
  });
  if (options.onUsage) {
    try {
      options.onUsage({
        modelId: diagnostics.modelId,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
        cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
        cacheReadInputTokens: diagnostics.cacheReadInputTokens,
      });
    } catch (e) {
      console.warn(`[${'aspect_variants'}] onUsage callback threw:`, e instanceof Error ? e.message : e);
    }
  }
  return raw;
}

/** Helper: take server-side output (from runAspectVariants) and produce
 *  storable AspectVariant[] with crypto-random IDs and timestamps. */
export function toStoredVariants(
  output: AspectVariantsOutput,
  meta: { contextRef: ContextRef; modelId: string },
): AspectVariant[] {
  const now = new Date().toISOString();
  return output.variants.map((v) => ({
    id: crypto.randomUUID(),
    label: v.label,
    payloadKind: "markdown" as const,
    payload: v.payload,
    status: "generated" as const,
    editSource: "llm" as const,
    generatedAt: now,
    modelId: meta.modelId,
    contextRef: meta.contextRef,
  }));
}

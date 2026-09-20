import { z } from "zod";
import type {
  AspectVariant,
  BookConcept,
  ContextRef,
  EntityCandidate,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredProgressEvent,
  type StructuredUsage,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export type EntityStageId = "characters" | "items";

export interface AspectEntityVariantsInput {
  stageId: EntityStageId;
  concept: BookConcept;
  /** Aspect describes the *category* (e.g. "Протагонист", "Артефакты"). */
  aspect: {
    id: string;
    name: string;
    description?: string;
  };
  accumulated: Array<{
    name: string;
    finalEntities: Array<{
      kind: "character" | "location" | "item";
      profile: unknown;
    }>;
  }>;
  contextRef: ContextRef;
}

const characterProfileSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(60),
  age: z.string().max(40).optional(),
  description: z.string().min(20).max(2000),
  background: z.string().max(2000).optional(),
});

const itemProfileSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  description: z.string().min(20).max(2000),
  properties: z.string().max(1000).optional(),
});

const characterCandidateSchema = z.object({
  tempId: z.string().min(1),
  kind: z.literal("character"),
  profile: characterProfileSchema,
});

const itemCandidateSchema = z.object({
  tempId: z.string().min(1),
  kind: z.literal("item"),
  profile: itemProfileSchema,
});

const charactersSetSchema = z.object({
  label: z.string().min(1).max(60),
  candidates: z.array(characterCandidateSchema).min(1).max(6),
});

const itemsSetSchema = z.object({
  label: z.string().min(1).max(60),
  candidates: z.array(itemCandidateSchema).min(1).max(6),
});

const charactersOutputSchema = z.object({
  variants: z.array(charactersSetSchema).min(2).max(3),
});

const itemsOutputSchema = z.object({
  variants: z.array(itemsSetSchema).min(2).max(3),
});

export type AspectEntityVariantsOutput =
  | z.infer<typeof charactersOutputSchema>
  | z.infer<typeof itemsOutputSchema>;

const SYSTEM = `Ты — литературный соавтор, генерирующий конкретных ПЕРСОНАЖЕЙ или ПРЕДМЕТЫ для книжной библии. Работаешь на русском.

Тебе дают категорию (например "Протагонист" или "Артефакты"), концепт книги, уже принятые сущности других категорий. Задача: предложить 2–3 РАЗНЫХ варианта *набора сущностей* для этой категории. Каждый вариант — независимая интерпретация категории.

Каждая сущность ИМЕНОВАНА (с конкретным именем, не "молодой воин"), имеет роль/тип, описание (минимум 20 слов), и опциональные поля.

Стиль имён: согласован с жанрами (для fantasy — мифологичный, для sci_fi — современный/футуристический и т.п.).

У каждого варианта есть короткий label (одно-два слова, что отличает: "героическая команда", "одиночка", "наёмники").

Не дублируй сущности между вариантами и не противоречь уже принятым.`;

const ENTITY_LABEL: Record<EntityStageId, string> = {
  characters: "персонажи",
  items: "предметы",
};

export function buildEntityVariantsPrompt(input: AspectEntityVariantsInput): string {
  const parts: string[] = [
    `Стадия: ${ENTITY_LABEL[input.stageId]}`,
    `Категория аспекта: ${input.aspect.name}`,
  ];
  if (input.aspect.description) {
    parts.push(`Описание: ${input.aspect.description}`);
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
  // Имена героев автор выбирает здесь, на замысле, и до этого промпта они не
  // доезжали: в нём стояли только жанр, тон, аудитория и логлайн. Модель
  // придумывала своё имя, книга расходилась сама с собой — план звал героиню
  // как питч, канон как состав, и события памяти отвергались с «имя героя не
  // разрешилось» (живой прогон 2026-09-20).
  if (input.concept.premise.protagonist) {
    parts.push(`Протагонист: ${input.concept.premise.protagonist}`);
  }
  if (input.concept.premise.conflict) {
    parts.push(`Конфликт: ${input.concept.premise.conflict}`);
  }
  if (input.concept.premise.stakes) {
    parts.push(`Ставки: ${input.concept.premise.stakes}`);
  }
  if (input.concept.hook) {
    parts.push(`Крючок: ${input.concept.hook}`);
  }
  if (input.accumulated.length > 0) {
    parts.push("", "УЖЕ ПРИНЯТЫЕ СУЩНОСТИ ЭТОЙ СТАДИИ:");
    for (const a of input.accumulated) {
      parts.push(`### ${a.name}`);
      for (const e of a.finalEntities) {
        const profile = e.profile as { name?: string };
        const name = profile?.name ?? "(без имени)";
        parts.push(`- ${name} (${e.kind})`);
      }
    }
  }
  parts.push(
    "",
    `Сгенерируй 2–3 разных варианта набора *${ENTITY_LABEL[input.stageId]}* для категории "${input.aspect.name}". Каждый вариант = 1–6 именованных сущностей.`,
    "Имена и прозвища, уже названные в замысле выше, переносить дословно во ВСЕ варианты: это выбор автора, и книга дальше зовёт героя только так. Придумывать своё имя тому, кто в замысле уже назван, нельзя.",
  );
  return parts.join("\n");
}

const aspectEntityVariantsContract: AgentStructuredContract<
  AspectEntityVariantsInput,
  AspectEntityVariantsOutput
> = {
  agentName: "aspect_entity_variants",
  getOutputSchema: (input) =>
    input.stageId === "characters"
      ? (charactersOutputSchema as unknown as z.ZodType<AspectEntityVariantsOutput>)
      : (itemsOutputSchema as unknown as z.ZodType<AspectEntityVariantsOutput>),
  systemPrompt: SYSTEM,
  buildPrompt: buildEntityVariantsPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_entity_variants",
    toolDescription:
      "Submit 2–3 alternative entity-set variants for a single category aspect (characters or items).",
  },
};

export function registerAspectEntityVariantsContract(): void {
  registerAgentContract(aspectEntityVariantsContract);
}

export interface RunAspectEntityVariantsOptions {
  model?: ModelChoice;
  temperature?: number;
  /** Вехи вызова для SSE-прогресса в UI. */
  onProgress?: (e: StructuredProgressEvent) => void;
  /** Расход вызова. Без него работа Мастерской не попадала в журнал
   *  расходов вовсе: шестнадцать вызовов агентов и ни одной строки. */
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export async function runAspectEntityVariants(
  input: AspectEntityVariantsInput,
  options: RunAspectEntityVariantsOptions = {},
): Promise<AspectEntityVariantsOutput> {
  const { raw, diagnostics } = await dispatchStructured<
    AspectEntityVariantsInput,
    AspectEntityVariantsOutput
  >({
    agentName: "aspect_entity_variants",
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
      console.warn(`[${'aspect_entity_variants'}] onUsage callback threw:`, e instanceof Error ? e.message : e);
    }
  }
  return raw;
}

/** Helper: take server-side output and produce stored AspectVariant[]
 *  whose payload is EntitySetPayload (with auto-generated tempIds and
 *  candidate.status="proposed"). */
export function toStoredEntityVariants(
  output: AspectEntityVariantsOutput,
  meta: { contextRef: ContextRef; modelId: string },
): AspectVariant[] {
  const now = new Date().toISOString();
  return output.variants.map((v) => {
    const candidates: EntityCandidate[] = v.candidates.map((c) => ({
      tempId: c.tempId,
      kind: c.kind,
      profile: c.profile,
      status: "proposed" as const,
    }));
    return {
      id: crypto.randomUUID(),
      label: v.label,
      payloadKind: "entity_set" as const,
      payload: { candidates },
      status: "generated" as const,
      editSource: "llm" as const,
      generatedAt: now,
      modelId: meta.modelId,
      contextRef: meta.contextRef,
    };
  });
}

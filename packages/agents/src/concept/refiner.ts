import { z } from "zod";
import type { BookConcept } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type LocalModelRef,
  type AgentStructuredContract,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";
import { CONCEPT_LANGUAGE_RULES } from "../language-rules.js";

export const PREMISE_FIELDS = [
  "protagonist",
  "conflict",
  "stakes",
  "logline",
] as const;
export type PremiseField = (typeof PREMISE_FIELDS)[number];

export interface ConceptRefinerInput {
  field: PremiseField;
  concept: BookConcept;
  accumulated: {
    protagonist?: string;
    conflict?: string;
    stakes?: string;
  };
  draft?: string;
}

const variantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  payload: z.string().min(1).max(2000),
});

const conceptRefinerOutputSchema = z.object({
  variants: z.array(variantSchema).min(2).max(3),
});

export type ConceptRefinerOutput = z.infer<typeof conceptRefinerOutputSchema>;
export type ConceptRefinerVariant = z.infer<typeof variantSchema>;

const FIELD_LABELS: Record<PremiseField, string> = {
  protagonist: "Протагонист",
  conflict: "Конфликт",
  stakes: "Ставки",
  logline: "Логлайн",
};

export const FIELD_INSTRUCTIONS: Record<PremiseField, string> = {
  protagonist:
    'Опиши главного героя одним коротким абзацем (40–80 слов): кто он, что хочет, какая внутренняя сила или слабость определяет его выбор. Без имени, если в концепте имя не задано.',
  conflict:
    'Сформулируй центральный конфликт книги (40–80 слов): кто/что мешает протагонисту, на каком уровне (внешний/внутренний/межличностный/системный) и почему столкновение неизбежно.',
  stakes:
    'Опиши ставки одним абзацем (30–60 слов): что протагонист потеряет если проиграет, что приобретёт если победит. Делай ставки конкретными и ощутимыми ("спасёт мир" — слишком общо).',
  logline:
    'Собери одно-двух-предложный логлайн ≤ 280 символов: кто чего хочет и что стоит на пути, начало свободное. Согласуй с протагонистом, конфликтом и ставками выше.',
};

export const CONCEPT_REFINER_SYSTEM = `Ты — литературный соавтор, помогающий формулировать центральный замысел книги. Работаешь на русском.

Цель — предлагать НЕСКОЛЬКО разных по углу формулировок одного и того же поля премисы, чтобы автор мог выбрать и доработать.

Стиль: ёмко, конкретно, без штампов. Не используй "судьба мира", "избранный", "тайные силы" если этого нет в концепте автора.

Возвращай ровно 2 или 3 варианта. Каждый — независимая формулировка (альтернатива предыдущему). У каждого есть короткий label (одно-два слова, что-то отличающее этот вариант: "героическая", "тёмная", "ироничная" и т.п.) и payload — собственно текст.
${CONCEPT_LANGUAGE_RULES}`;

function genresLine(c: BookConcept): string {
  return `Жанр: ${c.genre ?? "не задан"}`;
}

function tonesLine(c: BookConcept): string {
  return `Тон: ${c.tone ?? "не задан"}`;
}

function audienceLine(c: BookConcept): string {
  return `Аудитория: ${c.audience}`;
}

function buildPrompt(input: ConceptRefinerInput): string {
  const parts: string[] = [
    `Поле для генерации: ${FIELD_LABELS[input.field]}`,
    "",
    "КОНЦЕПТ:",
    genresLine(input.concept),
    tonesLine(input.concept),
    audienceLine(input.concept),
  ];

  const acc = input.accumulated;
  if (acc.protagonist) {
    parts.push("", "ПРИНЯТЫЙ ПРОТАГОНИСТ:", acc.protagonist);
  }
  if (acc.conflict) {
    parts.push("", "ПРИНЯТЫЙ КОНФЛИКТ:", acc.conflict);
  }
  if (acc.stakes) {
    parts.push("", "ПРИНЯТЫЕ СТАВКИ:", acc.stakes);
  }
  if (input.draft && input.draft.trim()) {
    parts.push("", "ЧЕРНОВИК ОТ АВТОРА (учти, не игнорируй):", input.draft.trim());
  }

  parts.push("", "ИНСТРУКЦИЯ:", FIELD_INSTRUCTIONS[input.field]);
  parts.push(
    "",
    "Сгенерируй разные по углу варианты. Не дублируй варианты по смыслу.",
  );

  return parts.join("\n");
}

const conceptRefinerContract: AgentStructuredContract<
  ConceptRefinerInput,
  ConceptRefinerOutput
> = {
  agentName: "concept_refiner",
  getOutputSchema: () => conceptRefinerOutputSchema,
  systemPrompt: CONCEPT_REFINER_SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_concept_variants",
    toolDescription:
      "Submit alternative formulations of one premise field (protagonist, conflict, stakes, or logline).",
  },
};

export function registerConceptRefinerContract(): void {
  registerAgentContract(conceptRefinerContract);
}

export interface RunConceptRefinerOptions {
  model?: ModelChoice;
  /** Локальная модель мастерской (настройка книги); без неё — Claude. */
  local?: LocalModelRef;
  temperature?: number;
}

export async function runConceptRefiner(
  input: ConceptRefinerInput,
  options: RunConceptRefinerOptions = {},
): Promise<ConceptRefinerOutput> {
  const { raw } = await dispatchStructured<
    ConceptRefinerInput,
    ConceptRefinerOutput
  >({
    agentName: "concept_refiner",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.local ? { local: options.local } : {}),
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    maxTokens: 2048,
  });
  return raw;
}

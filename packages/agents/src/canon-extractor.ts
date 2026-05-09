import { z } from "zod";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import type { GenerationConfig, ModelChoice } from "@book-forge/shared";

// ─────────── Types of canon already in book (passed as context) ───────────

export interface ExistingCharacterRef {
  id: number;
  name: string;
  description: string;
}
export interface ExistingLocationRef {
  id: number;
  name: string;
  description: string;
}
export interface ExistingItemRef {
  id: number;
  name: string;
  description: string;
}
export interface ExistingHookRef {
  id: number;
  description: string;
  status: string;
}

export interface ExistingCanon {
  characters: ExistingCharacterRef[];
  locations: ExistingLocationRef[];
  items: ExistingItemRef[];
  hooks: ExistingHookRef[];
}

// ─────────── Output schema ───────────

const candidateStatus = z.enum(["new", "existing", "ambiguous"]);

const baseCandidate = {
  status: candidateStatus,
  existingId: z.number().int().positive().nullable(),
  quote: z.string().min(1).max(400),
  mentionCount: z.number().int().min(1).max(50),
};

export const characterCandidateSchema = z.object({
  ...baseCandidate,
  name: z.string().min(1).max(120),
  profile: z.string().nullable(),
});
export type CharacterCandidate = z.infer<typeof characterCandidateSchema>;

export const locationCandidateSchema = z.object({
  ...baseCandidate,
  name: z.string().min(1).max(120),
  profile: z.string().nullable(),
});
export type LocationCandidate = z.infer<typeof locationCandidateSchema>;

export const itemCandidateSchema = z.object({
  ...baseCandidate,
  name: z.string().min(1).max(120),
  profile: z.string().nullable(),
});
export type ItemCandidate = z.infer<typeof itemCandidateSchema>;

export const hookCandidateSchema = z.object({
  ...baseCandidate,
  description: z.string().min(1).max(300),
  type: z.enum(["opened", "closed", "continued"]),
});
export type HookCandidate = z.infer<typeof hookCandidateSchema>;

export const relationshipCandidateSchema = z.object({
  ...baseCandidate,
  fromName: z.string().min(1).max(120),
  toName: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  tension: z.number().min(-1).max(1),
});
export type RelationshipCandidate = z.infer<typeof relationshipCandidateSchema>;

export const canonExtractionResultSchema = z.object({
  characters: z.array(characterCandidateSchema),
  locations: z.array(locationCandidateSchema),
  items: z.array(itemCandidateSchema),
  hooks: z.array(hookCandidateSchema),
  relationships: z.array(relationshipCandidateSchema),
  notes: z.string().nullable().optional(),
});
export type CanonExtractionResult = z.infer<typeof canonExtractionResultSchema>;

// ─────────── Agent ───────────

const SYSTEM = `Ты — Canon Extractor, литературный архивариус. Работаешь на русском.

Твоя единственная задача — извлечь упоминаемые в главе сущности и сравнить их со списком уже известного канона книги.

Категории сущностей:
- character: одушевлённые персонажи, имеющие имя или явную идентификацию (например, «смотритель маяка», если он действует в сцене)
- location: географические объекты, помещения, ландшафт
- item: значимые предметы (письмо, лампа, кольцо), не служебная мелочь
- hook: «крючки» — открытые вопросы, обещания, тайны, предчувствия
- relationship: связь между двумя названными персонажами

Для каждого кандидата:
- status="existing" — если он уже есть в каноне (по имени или явной отсылке) → укажи existingId
- status="ambiguous" — если упоминание похоже на существующий канон, но не совпадает однозначно → укажи existingId предполагаемого совпадения
- status="new" — если кандидат не сводится к существующему канону

Цитата (quote): фрагмент главы (≤400 символов), где упоминание встречается впервые.
mentionCount: сколько раз упомянут в этой главе (1..50).

Не выдумывай. Если глава не содержит явного основания для добавления — пропускай. Лучше меньше, чем шум.

Hooks (type):
- "opened" — крючок открыт впервые в главе
- "closed" — открытый ранее крючок закрыт в главе
- "continued" — открытый крючок упомянут/развит, но не закрыт

Возвращай:
- characters, locations, items, hooks, relationships — массивы кандидатов
- notes — 1-2 коротких предложения о состоянии канона главы (например, «Глава вводит двух новых персонажей и закрывает крючок о письме»)`;

const TASK = `Извлеки кандидатов канона из текста главы. Сверь с прилагающимся каноном книги. Возвращай только то, что явно упомянуто в тексте.`;

export interface ExtractCanonInput {
  chapterTitle: string;
  chapterText: string;
  existingCanon: ExistingCanon;
  config?: GenerationConfig;
  model?: ModelChoice;
  onUsage?: (usage: StructuredUsage) => void;
}

function formatExistingCanon(c: ExistingCanon): string {
  const fmt = (
    label: string,
    arr: Array<{ id: number; name?: string; description: string }>,
  ) => {
    if (arr.length === 0) return `${label}: (нет)`;
    const lines = arr.map(
      (e) =>
        `  - id=${e.id}${e.name ? ` "${e.name}"` : ""}: ${truncate(e.description, 200)}`,
    );
    return `${label}:\n${lines.join("\n")}`;
  };
  const hooks = c.hooks.map((h) => ({
    id: h.id,
    description: `[${h.status}] ${h.description}`,
  }));
  return [
    fmt("Персонажи", c.characters),
    fmt("Локации", c.locations),
    fmt("Артефакты", c.items),
    fmt("Крючки", hooks),
  ].join("\n\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function buildCanonGuardPrompt(input: ExtractCanonInput): string {
  const existingCanonBlock = formatExistingCanon(input.existingCanon);
  return [
    `Канон книги (на момент извлечения):\n${existingCanonBlock}`,
    `Глава: "${input.chapterTitle}"`,
    `Текст главы:\n\n${input.chapterText}`,
    `\nЗадача:\n${TASK}`,
  ].join("\n\n---\n\n");
}

const canonGuardContract: AgentStructuredContract<ExtractCanonInput, CanonExtractionResult> = {
  agentName: "canon_guard",
  getOutputSchema: () => canonExtractionResultSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildCanonGuardPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_canon_extraction",
    toolDescription:
      "Submit structured canon entities extracted from a chapter, with new/existing/ambiguous decisions vs the book's current canon.",
  },
};

export function registerCanonGuardContract(): void {
  registerAgentContract(canonGuardContract);
}

export async function extractCanon(
  input: ExtractCanonInput,
): Promise<CanonExtractionResult> {
  const { raw, diagnostics } = await dispatchStructured<
    ExtractCanonInput,
    CanonExtractionResult
  >({
    agentName: "canon_guard",
    payload: input,
    model: input.model ?? input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  if (input.onUsage) {
    const usage: StructuredUsage = {
      modelId: diagnostics.modelId,
      inputTokens: diagnostics.inputTokens,
      outputTokens: diagnostics.outputTokens,
      cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
      cacheReadInputTokens: diagnostics.cacheReadInputTokens,
    };
    try {
      input.onUsage(usage);
    } catch (e) {
      console.warn(
        "[canon-extractor] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

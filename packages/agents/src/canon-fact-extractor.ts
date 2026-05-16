import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  canonFactExtractionSchema,
  type CanonFactExtraction,
  type ModelChoice,
  type GenerationConfig,
} from "@book-forge/shared";

/**
 * Phase 3 — temporal canon facts.
 *
 * Reads a freshly written chapter and emits atomic, time-scoped statements
 * about canon entities. The server owns valid_to / supersession bookkeeping;
 * this agent only states what is true *as of this chapter*.
 */

export interface CanonFactExtractorInput {
  bookTitle: string;
  chapterTitle: string;
  chapterOrder: number;
  chapterText: string;
  /** Materialized canon names so the extractor anchors to known entities. */
  knownEntities: {
    characters: string[];
    locations: string[];
    items: string[];
  };
  /** Currently-active facts (rendered) so the model only emits deltas. */
  activeFacts: string | null;
  model?: ModelChoice;
  config?: GenerationConfig;
  onUsage?: (u: StructuredUsage) => void;
}

const SYSTEM = `Ты — Canon Archivist, литературный архивариус непрерывности. Работаешь на русском.

Задача: прочитать главу и выписать АТОМАРНЫЕ факты о каноне, истинные НА МОМЕНТ ЭТОЙ ГЛАВЫ.

Факт = (entityType, entityName, predicate, objectText):
- entityType: character | location | item | world
- entityName: имя сущности так, как она названа в каноне/главе
- predicate: короткий ключ отношения — "умеет", "владеет", "находится", "состояние", "знает", "ранен", "союзник", "враг", "правило_мира" и т.п.
- objectText: значение факта (1 короткое предложение)

Правила:
- Только факты, явно следующие из текста главы. Не домысливай.
- Фиксируй ИЗМЕНЕНИЯ состояния: если в главе герой потерял предмет / получил способность / узнал тайну / переместился — это факт.
- Если факт уже есть в списке активных фактов и НЕ изменился — НЕ повторяй его.
- Если факт ПРОТИВОРЕЧИТ активному (новое состояние) — выпиши новую формулировку с тем же entityName и predicate; сервер сам закроет старую версию.
- Не более 40 фактов. Лучше меньше и точнее.

Возвращай: facts[] + notes (1-2 предложения о ключевых изменениях канона, либо null).`;

function buildPrompt(input: CanonFactExtractorInput): string {
  const known = [
    input.knownEntities.characters.length > 0
      ? `Персонажи: ${input.knownEntities.characters.join(", ")}`
      : null,
    input.knownEntities.locations.length > 0
      ? `Локации: ${input.knownEntities.locations.join(", ")}`
      : null,
    input.knownEntities.items.length > 0
      ? `Предметы: ${input.knownEntities.items.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const stableParts: string[] = [`Книга: "${input.bookTitle}"`];
  if (known) stableParts.push(`Известный канон:\n${known}`);
  if (input.activeFacts) {
    stableParts.push(`Активные факts (на начало главы):\n${input.activeFacts}`);
  }

  const volatileParts: string[] = [
    `Глава #${input.chapterOrder}: "${input.chapterTitle}"`,
    `Текст главы:\n\n${input.chapterText}`,
    "Выпиши атомарные факты канона по этой главе.",
  ];

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const canonFactExtractorContract: AgentStructuredContract<
  CanonFactExtractorInput,
  CanonFactExtraction
> = {
  agentName: "canon_fact_extractor",
  getOutputSchema: () => canonFactExtractionSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_canon_facts",
    toolDescription:
      "Submit atomic, time-scoped canon facts extracted from a chapter (entityType/entityName/predicate/objectText).",
  },
};

export function registerCanonFactExtractorContract(): void {
  registerAgentContract(canonFactExtractorContract);
}

export async function extractCanonFacts(
  input: CanonFactExtractorInput,
): Promise<CanonFactExtraction> {
  const { raw, diagnostics } = await dispatchStructured<
    CanonFactExtractorInput,
    CanonFactExtraction
  >({
    agentName: "canon_fact_extractor",
    payload: input,
    model: input.model ?? input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  if (input.onUsage) {
    try {
      input.onUsage({
        modelId: diagnostics.modelId,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
        cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
        cacheReadInputTokens: diagnostics.cacheReadInputTokens,
      });
    } catch (e) {
      console.warn(
        "[canon-fact-extractor] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  episodicNoteExtractionSchema,
  type EpisodicNoteExtraction,
  type ModelChoice,
  type GenerationConfig,
} from "@book-forge/shared";

/**
 * Phase 4 — episodic memory.
 *
 * Reads a freshly written chapter and emits Zettelkasten-style notes: open
 * threads, planted foreshadowing, arc deltas, themes, mysteries. Also names
 * which currently-open notes the chapter resolves so the server can close
 * them. The server owns embedding + linking; this agent only states content.
 */

export interface EpisodicNoteExtractorInput {
  bookTitle: string;
  chapterTitle: string;
  chapterOrder: number;
  chapterText: string;
  /** Rendered list of currently-open notes (title — kind — body). */
  openNotes: string | null;
  model?: ModelChoice;
  config?: GenerationConfig;
  onUsage?: (u: StructuredUsage) => void;
}

const SYSTEM = `Ты — Story Memory, литературный аналитик непрерывности. Работаешь на русском.

Задача: по тексту главы выписать ЭПИЗОДИЧЕСКИЕ ЗАМЕТКИ — то, что должно «помниться» дальше по книге:
- kind="thread": открытая сюжетная линия / незавершённое действие
- kind="foreshadow": намёк, обещание, предчувствие, «ружьё на стене»
- kind="arc_delta": заметное изменение в арке персонажа (рост, падение, прозрение)
- kind="theme": тематический мотив, который автор развивает
- kind="mystery": загадка / поставленный вопрос без ответа

Для каждой заметки: title (короткий ярлык), body (1-3 предложения сути), tags (имена/места/мотивы).

Также: если глава ЗАКРЫВАЕТ одну из открытых заметок (ниже) — верни её идентификатор вида note_<число> (указан в начале строки заметки) в resolvedNoteIds.

Правила:
- Только то, что реально есть в главе. Не выдумывай.
- Не дублируй уже открытые заметки, если они не изменились.
- ≤ 20 новых заметок. Лучше меньше и важнее.

Возвращай: newNotes[] + resolvedNoteIds[] + notes (1-2 предложения или null).`;

function buildPrompt(input: EpisodicNoteExtractorInput): string {
  const stableParts: string[] = [`Книга: "${input.bookTitle}"`];
  if (input.openNotes) {
    stableParts.push(`Открытые заметки (на начало главы):\n${input.openNotes}`);
  }
  const volatileParts: string[] = [
    `Глава #${input.chapterOrder}: "${input.chapterTitle}"`,
    `Текст главы:\n\n${input.chapterText}`,
    "Выпиши эпизодические заметки и отметь закрытые.",
  ];
  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const episodicNoteExtractorContract: AgentStructuredContract<
  EpisodicNoteExtractorInput,
  EpisodicNoteExtraction
> = {
  agentName: "episodic_note_extractor",
  getOutputSchema: () => episodicNoteExtractionSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_episodic_notes",
    toolDescription:
      "Submit Zettelkasten-style episodic notes (threads/foreshadow/arc/theme/mystery) for a chapter plus ids (note_<id>) of open notes it resolves.",
  },
};

export function registerEpisodicNoteExtractorContract(): void {
  registerAgentContract(episodicNoteExtractorContract);
}

export async function extractEpisodicNotes(
  input: EpisodicNoteExtractorInput,
): Promise<EpisodicNoteExtraction> {
  const { raw, diagnostics } = await dispatchStructured<
    EpisodicNoteExtractorInput,
    EpisodicNoteExtraction
  >({
    agentName: "episodic_note_extractor",
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
        "[episodic-note-extractor] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

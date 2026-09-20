import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  canonFactToolSchema,
  type CanonFactToolResult,
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

/** Экспортируется ради тестов: промпт — это и есть работа агента, а
 *  проверка схемы проверяет zod, а не то, что модели сказали. */
/** Свой предел ожидания у агента, который читает главу целиком (живой
 *  прогон 2026-09-20). Общий `LLM_TIMEOUT_MS` рассчитан на короткий
 *  структурный ответ; разбор главы в две-три тысячи слов на подписке идёт
 *  дольше, и общий предел рубил его на середине — память главы не
 *  собиралась вовсе, а очередь молча повторяла задание пять раз. */
const CHAPTER_AGENT_TIMEOUT_MS = 600_000;

export const CANON_FACT_EXTRACTOR_SYSTEM = `Ты — Canon Archivist, литературный архивариус непрерывности. Работаешь на русском.

Задача: прочитать главу и выписать АТОМАРНЫЕ факты о каноне, истинные НА МОМЕНТ ЭТОЙ ГЛАВЫ.

События персонажей — что узнал и почувствовал конкретный герой — выписывает отдельный агент своим вызовом. Здесь их не нужно: два массива в одном ответе модель сериализует во вложенную строку, и события терялись все до одного (живой прогон 2026-09-20).

Факт = (entityType, entityName, predicate, objectText):
- entityType: character | location | item | world
- entityName: если сущность есть в списке известных (ниже) — используй ЕЁ каноническое имя (именительный падеж), не форму из текста («Ивану»→«Иван»); иначе имя как в главе
- predicate: короткий ключ отношения — "умеет", "владеет", "находится", "состояние", "знает", "ранен", "союзник", "враг", "правило_мира" и т.п.
- objectText: значение факта (1 короткое предложение)

К каждому факту добавь assertionMode — КАК глава это утверждает:
- "narrated_as_fact": рассказчик утверждает это как реальность мира
- "directly_observed": событие происходит на сцене, POV видит сам
- "stated_by_character": персонаж ГОВОРИТ это (может лгать/ошибаться)
- "believed_by_character": персонаж так думает/считает
- "rumor": слух, пересказ, «говорят, что…»
- "dream_or_vision": сон, видение, галлюцинация
- "uncertain": текст оставляет вопрос открытым
ВАЖНО: реплика персонажа о мире — это stated_by_character, НЕ narrated_as_fact. Каноном мира становятся только narrated_as_fact и directly_observed.

Правила фактов:
- Только факты, явно следующие из текста главы. Не домысливай.
- Фиксируй ИЗМЕНЕНИЯ состояния: если в главе герой потерял предмет / получил способность / узнал тайну / переместился — это факт.
- Если факт уже есть в списке активных фактов и НЕ изменился — НЕ повторяй его.
- Если новое состояние ЗАМЕНЯЕТ конкретный активный факт — укажи его идентификатор (вида fact_12, указан в начале строки активного факта) в supersedesFactIds. Так «потерял ключ» закроет именно факт о ключе, не задев другие владения.
- Если supersedesFactIds не указан, сервер закроет активный факт с тем же entityName и predicate (fallback) — поэтому для мультизначных предикатов («владеет», «умеет», «союзник») указывай id явно.
- Не более 40 фактов. Лучше меньше и точнее.

Возвращай: facts[] (с assertionMode и, где нужно, supersedesFactIds) + notes (1-2 предложения о ключевых изменениях канона, либо null).`;

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
    stableParts.push(`Активные факты (на начало главы):\n${input.activeFacts}`);
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
  CanonFactToolResult
> = {
  agentName: "canon_fact_extractor",
  // Только факты: события уехали своему агенту. Схема чтения
  // `canonFactExtractionSchema` осталась с полем событий — по ней
  // разбираются staged-результаты заданий, записанных до разделения.
  getOutputSchema: () => canonFactToolSchema,
  systemPrompt: CANON_FACT_EXTRACTOR_SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_canon_facts",
    toolDescription:
      "Submit atomic, time-scoped canon facts extracted from a chapter (entityType/entityName/predicate/objectText) together with per-character events (knowledge/state/relation_shift/commitment), each carrying a verbatim quote from the chapter.",
    // Ходов больше трёх (живой прогон 2026-09-20). Схема здесь самая
    // сложная в проекте: два массива объектов с вложенными данными и
    // дословными цитатами. Модель заполняет её не с первого раза, и трёх
    // ходов не хватало — задание падало с «Reached maximum number of
    // turns», то есть память главы не собиралась вовсе. Лишние ходы
    // тратятся только там, где без них был бы отказ.
    maxTurns: 6,
  },
};

export function registerCanonFactExtractorContract(): void {
  registerAgentContract(canonFactExtractorContract);
}

export async function extractCanonFacts(
  input: CanonFactExtractorInput,
): Promise<CanonFactToolResult> {
  const { raw, diagnostics } = await dispatchStructured<
    CanonFactExtractorInput,
    CanonFactToolResult
  >({
    agentName: "canon_fact_extractor",
    payload: input,
    model: input.model ?? input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    // 8192 не хватает на полный ответ: 40 фактов и 30 событий с дословными
    // цитатами — это больше десяти тысяч токенов, а обрыв приходит сюда как
    // «инструмент не вызван», без `stop_reason`. Пока предел не доезжал до
    // подписки, его занижение ничего не стоило; теперь доезжает.
    maxTokens: 16000,
    timeoutMs: CHAPTER_AGENT_TIMEOUT_MS,
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

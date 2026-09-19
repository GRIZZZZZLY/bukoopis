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

/** Экспортируется ради тестов: промпт — это и есть работа агента, а
 *  проверка схемы проверяет zod, а не то, что модели сказали. */
export const CANON_FACT_EXTRACTOR_SYSTEM = `Ты — Canon Archivist, литературный архивариус непрерывности. Работаешь на русском.

Задача: прочитать главу и выписать АТОМАРНЫЕ факты о каноне, истинные НА МОМЕНТ ЭТОЙ ГЛАВЫ, и события персонажей.

ФАКТЫ КНИГИ vs СОБЫТИЯ ПЕРСОНАЖА

Факт книги — то, что произошло объективно (герой потерял ключ, переместился, мир имеет правило).
Событие персонажа — то, что стало известно или изменилось У КОНКРЕТНОГО ГЕРОЯ (герой узнал о закрытии станции, испугался, обещал помочь).

Как герой получил сведение:
- Услышанное и увиденное РАЗЛИЧАТЬ: acquisition = observed ТОЛЬКО если герой это видел сам; told — если ему сказали (или он подслушал); inferred — если он вывел из увиденного («на столе два прибора — значит, ждали гостя»); believed — если верит без подтверждения («она была уверена, что брат жив»).
- Поле acquisition ОБЯЗАТЕЛЬНО для knowledge и должно быть одним из четырёх выше. Одно событие без него отвергает ВЕСЬ ответ, вместе с фактами. Значения "unknown" у тебя нет: оно означает «происхождение не записано» и оставлено для старых авторских записей — если из текста не понять, откуда герой знает, событие лучше не записывать вовсе.
- ЛОЖЬ, УСЛЫШАННАЯ ГЕРОЕМ, — это событие знания с acquisition: "told", а НЕ факт книги. Герой может верить неправде; канон книги от его убеждений не меняется.

ИМЕНА ГЕРОЕВ в событиях: subjectName и addresseeName пиши в именительном падеже — «Ивану» → «Иван», «с Рин» → «Рин». Если герой есть в списке известного канона (если такой список дан ниже), бери имя оттуда дословно. Имя, которое не удастся сопоставить с героем книги, событие не запишет.

ДОКАЗАТЕЛЬСТВО
- Каждое событие несёт evidenceQuote — ДОСЛОВНЫЙ отрывок из текста главы, скопированный СИМВОЛ В СИМВОЛ, вместе со знаками препинания и тире. Не пересказывай, не сокращай, не исправляй опечатки.
- Позиции считать НЕ НАДО: сервер сам находит цитату в тексте.
- Цитата должна встречаться в главе РОВНО ОДИН РАЗ. Короткий обрывок вроде «— Да.» встречается много раз и будет отвергнут — бери отрывок подлиннее, вместе с окружающими словами.
- Событие, чью цитату не удалось найти, не записывается.

Что записывать как событие и КАКИЕ ПОЛЯ у data:
- knowledge — герой узнал факт, умение, чувство другого. data: { fact: "что именно узнал", acquisition: "observed|told|inferred|believed", source: "от кого или откуда, если это видно из текста; иначе null" }
- state — усталость, раздражение, намерение, эмоция, если это видно из текста. data: { state: "что с героем", scope: "scene|chapter|until_resolved|unknown", endCondition: "чем это кончится, словами из текста; иначе null", endsAtChapterOrder: "номер главы, с которой это точно позади, если он назван; иначе null" }
- relation_shift — конкретное изменение отношения к другому герою. data: { quality: "доверие|уважение|привязанность|страх|обида|…", from: "как было", to: "как стало" }, addresseeName — к кому
- commitment — обещание, долг, взятое обязательство. data: { commitment: "что обещал", toWhom: "кому" }

Имена полей менять нельзя. Ключи не из этого списка отбрасываются молча, поэтому событие, где главное поле названо по-своему, оказывается пустым — и отвергает ВЕСЬ ответ, вместе с фактами.

- relation_shift — только конкретные изменения, НЕ ГИПОТЕЗЫ. Вывод о длительном отношении («теперь презирает всех») из одной реплики — НЕ событие. Записывать только то, что в тексте сказано или показано. Такие события автор подтверждает вручную, поэтому лучше пропустить сомнительное, чем нагрузить его списком догадок.
- При состояниях (state): если из текста не видно, когда это кончится, оставлять scope: "unknown", а не придумывать срок. scope: "scene" и "chapter" означают, что состояние кончается вместе со сценой или главой, и дальше герою не приписывается.
- endCondition — это условие, а не срок: «пока Сарек не ответит», «пока не доберётся до станции». Писать так, чтобы фраза читалась после слова «держится:». Номер главы в endsAtChapterOrder — порядковый, как их видит автор (первая глава — 1), а не внутренний.
- Не более 30 событий. Превышение отвергает ВЕСЬ ответ, вместе с фактами. Лучше меньше и точнее.

---

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

Возвращай: facts[] (с assertionMode и, где нужно, supersedesFactIds) + characterEvents[] (если есть) + notes (1-2 предложения о ключевых изменениях канона, либо null).`;

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
    "Выпиши атомарные факты канона по этой главе и события персонажей: что каждый герой узнал, от кого, что с ним стало. К каждому событию — дословную цитату из текста выше.",
  ];

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const canonFactExtractorContract: AgentStructuredContract<
  CanonFactExtractorInput,
  CanonFactExtraction
> = {
  agentName: "canon_fact_extractor",
  getOutputSchema: () => canonFactExtractionSchema,
  systemPrompt: CANON_FACT_EXTRACTOR_SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_canon_facts",
    toolDescription:
      "Submit atomic, time-scoped canon facts extracted from a chapter (entityType/entityName/predicate/objectText) together with per-character events (knowledge/state/relation_shift/commitment), each carrying a verbatim quote from the chapter.",
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
    maxTokens: 8192,
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

import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  characterEventExtractionSchema,
  type CharacterEventExtraction,
  type ModelChoice,
  type GenerationConfig,
} from "@book-forge/shared";

/**
 * События персонажей — свой вызов, а не хвост извлечения фактов.
 *
 * Живой прогон 2026-09-20: события терялись все до одного. Они ехали тем же
 * ответом, что и факты, и на схеме с двумя массивами объектов модель
 * сериализовала второй массив в JSON-строку — так устроена передача
 * аргументов инструменту MCP. Строка приходила с ломаным экранированием на
 * русских кавычках и переносах, развернуть её было нельзя. Факты в том же
 * ответе приходили настоящим массивом и были целы.
 *
 * Поэтому вызова два. У каждого один массив верхнего уровня, и ни один не
 * зависит от другого: события упали — факты всё равно ложатся.
 */

export interface CharacterEventExtractorInput {
  bookTitle: string;
  chapterTitle: string;
  chapterOrder: number;
  chapterText: string;
  /** Канонические имена: событие с несопоставимым именем не запишется. */
  knownCharacters: string[];
  model?: ModelChoice;
  config?: GenerationConfig;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export const CHARACTER_EVENT_EXTRACTOR_SYSTEM = `Ты — Character Archivist, хранитель личной памяти героев. Работаешь на русском.

Задача: прочитать главу и выписать СОБЫТИЯ ПЕРСОНАЖЕЙ — то, что стало известно или изменилось У КОНКРЕТНОГО ГЕРОЯ.

Событие персонажа — не факт книги. Факт книги — то, что произошло объективно (герой потерял ключ, переместился, мир имеет правило); этим занимается другой агент, и повторять его работу не нужно. Твоё — что герой узнал, почувствовал, пообещал, как изменилось его отношение к другому.

Как герой получил сведение:
- Услышанное и увиденное РАЗЛИЧАТЬ: acquisition = observed ТОЛЬКО если герой это видел сам; told — если ему сказали (или он подслушал); inferred — если он вывел из увиденного («на столе два прибора — значит, ждали гостя»); believed — если верит без подтверждения («она была уверена, что брат жив»).
- Поле acquisition ОБЯЗАТЕЛЬНО для knowledge и должно быть одним из четырёх выше. Событие без него отбрасывается целиком — герой так и останется не знающим этого. Значения "unknown" у тебя нет: оно оставлено для старых авторских записей. Если из текста не понять, откуда герой знает, событие лучше не записывать вовсе.
- ЛОЖЬ, УСЛЫШАННАЯ ГЕРОЕМ, — это событие знания с acquisition: "told". Герой может верить неправде; канон книги от его убеждений не меняется.

ИМЕНА ГЕРОЕВ: subjectName и addresseeName пиши в именительном падеже — «Ивану» → «Иван», «с Рин» → «Рин». Если герой есть в списке известного канона (ниже), бери имя оттуда дословно. Имя, которое не удастся сопоставить с героем книги, событие не запишет.

ДОКАЗАТЕЛЬСТВО
- Каждое событие несёт evidenceQuote — ДОСЛОВНЫЙ отрывок из текста главы, скопированный СИМВОЛ В СИМВОЛ, вместе со знаками препинания и тире. Не пересказывай, не сокращай, не исправляй опечатки.
- Позиции считать НЕ НАДО: сервер сам находит цитату в тексте.
- Цитата должна встречаться в главе РОВНО ОДИН РАЗ. Короткий обрывок вроде «— Да.» встречается много раз и будет отвергнут — бери отрывок подлиннее, вместе с окружающими словами.
- Событие, чью цитату не удалось найти, не записывается.

Виды событий и КАКИЕ ПОЛЯ у data:
- knowledge — герой узнал факт, умение, чувство другого. data: { fact: "что именно узнал", acquisition: "observed|told|inferred|believed", source: "от кого или откуда, если это видно из текста; иначе null" }
- state — усталость, раздражение, намерение, эмоция, если это видно из текста. data: { state: "что с героем", scope: "scene|chapter|until_resolved|unknown", endCondition: "чем это кончится, словами из текста; иначе null", endsAtChapterOrder: "номер главы, с которой это точно позади, если он назван; иначе null" }
- relation_shift — конкретное изменение отношения к другому герою. data: { quality: "доверие|уважение|привязанность|страх|обида|…", from: "как было", to: "как стало" }, addresseeName — к кому
- commitment — обещание, долг, взятое обязательство. data: { commitment: "что обещал", toWhom: "кому" }

Имена полей менять нельзя. Ключи не из этого списка отбрасываются молча, поэтому событие, где главное поле названо по-своему, оказывается пустым — и отбрасывается целиком.

- relation_shift — только конкретные изменения, НЕ ГИПОТЕЗЫ. Вывод о длительном отношении («теперь презирает всех») из одной реплики — НЕ событие. Такие события автор подтверждает вручную, поэтому лучше пропустить сомнительное, чем нагрузить его списком догадок.
- При состояниях (state): если из текста не видно, когда это кончится, оставлять scope: "unknown", а не придумывать срок. scope: "scene" и "chapter" означают, что состояние кончается вместе со сценой или главой.
- endCondition — это условие, а не срок: «пока Сарек не ответит». Писать так, чтобы фраза читалась после слова «держится:». Номер главы в endsAtChapterOrder — порядковый, как их видит автор (первая глава — 1).
- Не более 30 событий. Превышение отвергает ВЕСЬ ответ этого вызова — но только его: факты главы приходят отдельным вызовом и не пострадают. Лучше меньше и точнее.

Возвращай characterEvents[] — один массив, больше ничего.`;

function buildPrompt(input: CharacterEventExtractorInput): string {
  const parts: string[] = [`Книга: "${input.bookTitle}"`];
  if (input.knownCharacters.length > 0) {
    parts.push(`Известные герои книги:\n${input.knownCharacters.join(", ")}`);
  }
  parts.push(
    `Глава #${input.chapterOrder}: "${input.chapterTitle}"`,
    `Текст главы:\n\n${input.chapterText}`,
    "Выпиши события персонажей по этой главе: что каждый герой узнал, от кого, что с ним стало. К каждому событию — дословную цитату из текста выше.",
  );
  return parts.join("\n\n---\n\n");
}

const characterEventExtractorContract: AgentStructuredContract<
  CharacterEventExtractorInput,
  CharacterEventExtraction
> = {
  agentName: "character_event_extractor",
  getOutputSchema: () => characterEventExtractionSchema,
  systemPrompt: CHARACTER_EVENT_EXTRACTOR_SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_character_events",
    toolDescription:
      "Submit per-character events (knowledge/state/relation_shift/commitment) extracted from a chapter, each carrying a verbatim quote from the chapter.",
    // Столько же, сколько у извлекателя фактов: на исправимом ответе модель
    // тратит ход-другой, и трёх не хватало.
    maxTurns: 6,
  },
};

export function registerCharacterEventExtractorContract(): void {
  registerAgentContract(characterEventExtractorContract);
}

/** Свой предел ожидания: агент читает главу целиком, а общий рассчитан на
 *  короткий структурный ответ. */
const CHAPTER_AGENT_TIMEOUT_MS = 600_000;

export async function extractCharacterEvents(
  input: CharacterEventExtractorInput,
): Promise<CharacterEventExtraction> {
  const { raw, diagnostics } = await dispatchStructured<
    CharacterEventExtractorInput,
    CharacterEventExtraction
  >({
    agentName: "character_event_extractor",
    payload: input,
    model: input.model ?? input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
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
        "[character-event-extractor] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

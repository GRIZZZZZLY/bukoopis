import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  scenePlanWriteSchema,
  type ScenePlan,
  type ModelChoice,
} from "@book-forge/shared";
import { AUTHOR_FACING_LANGUAGE_RULES } from "./language-rules.js";

/**
 * План сцен главы для нашей дообученной модели-Писателя.
 *
 * Модель обучена на плотных планах: 6–8 коротких событий на сцену около 600
 * слов. На тонком плане она начинает выдумывать. Этот агент разворачивает
 * содержание главы в такой план; автор потом может его править. Прозы и
 * реплик он не пишет: результат — только вход для локальной модели.
 *
 * Бэкенд `subscription`: `maxTokens` и `temperature` до модели не доходят,
 * размер ответа держат схема и промпт.
 */

export interface ScenePlanAgentInput {
  bookTitle: string;
  chapterTitle: string;
  chapterContent: string | null;
  beats: string | null;
  closingNote: string | null;
  previousTail: string | null;
  previousSummary: string | null;
  characterContext: string | null;
  worldContext: string | null;
  sceneCount: number;
  /** Прошлая глава написана от первого лица. */
  firstPerson: boolean;
  model?: ModelChoice;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export const SCENE_PLAN_SYSTEM = `Ты — составитель плана сцен. Работаешь на русском.

Тебе дают содержание главы. Твоя задача — разбить её на сцены и расписать каждую списком событий. По этому списку другая модель потом напишет прозу.

Что ты возвращаешь:
- ровно столько сцен, сколько просят в задании;
- в каждой сцене 6–8 событий, по порядку.

Что такое событие. Это одно короткое конкретное предложение в настоящем времени: одно действие или одно наблюдение. Например: «Мира открывает почтовый ящик и находит пустой конверт.» Событие — один шаг; пересказ целой страницы или общее состояние событием не считаются.

Правила:
- Героев называй так, как они названы в карточках.
- Если повествование от первого лица, героя-рассказчика в событиях называй «Рассказчик» (в нужном падеже: «Рассказчик», «Рассказчика», «Рассказчику»…); ни имя, ни «я» для него не используй. Остальных героев называй по именам из карточек.
- Не пиши реплик и диалога, не пиши прозу: только события.
- Не добавляй ничего, что меняет сюжет сверх содержания главы. Пробелы между пунктами содержания заполняй конкретными шагами, переходами и наблюдениями.
- Последнее событие последней сцены — точка остановки главы. Если дана заметка о финале, это она.
- Прошлая глава, мир и карточки даны для согласованности; сюжета из них не бери.

Заполняй схему и больше ничего не возвращай.

${AUTHOR_FACING_LANGUAGE_RULES}`;

export function buildScenePlanPrompt(input: ScenePlanAgentInput): string {
  const parts: string[] = [
    `Книга: "${input.bookTitle}"\nГлава: "${input.chapterTitle}"`,
  ];
  if (input.firstPerson) parts.push("Повествование от первого лица.");
  if (input.worldContext) parts.push(input.worldContext);
  if (input.characterContext) parts.push(input.characterContext);
  if (input.previousSummary) {
    parts.push(`Что было раньше:\n${input.previousSummary}`);
  }
  if (input.previousTail) {
    parts.push(`Конец предыдущей главы:\n${input.previousTail}`);
  }
  if (input.chapterContent) {
    parts.push(`Содержание главы:\n${input.chapterContent}`);
  }
  if (input.beats) parts.push(`Беаты главы:\n${input.beats}`);
  if (input.closingNote) {
    parts.push(`Заметка о финале главы (на ней глава останавливается):\n${input.closingNote}`);
  }
  parts.push(
    `Составь план: ровно ${input.sceneCount} сцен, в каждой 6–8 событий.`,
  );
  return parts.join("\n\n---\n\n");
}

const scenePlanContract: AgentStructuredContract<
  ScenePlanAgentInput,
  ScenePlan
> = {
  agentName: "scene_plan",
  getOutputSchema: () => scenePlanWriteSchema,
  systemPrompt: SCENE_PLAN_SYSTEM,
  buildPrompt: buildScenePlanPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_scene_plan",
    toolDescription:
      "Submit the chapter's scene plan: scenes, each a list of short present-tense events.",
  },
};

export function registerScenePlanContract(): void {
  registerAgentContract(scenePlanContract);
}

const SCENE_PLAN_TIMEOUT_MS = 600_000;

export async function runScenePlan(
  input: ScenePlanAgentInput,
): Promise<ScenePlan> {
  const { raw, diagnostics } = await dispatchStructured<
    ScenePlanAgentInput,
    ScenePlan
  >({
    agentName: "scene_plan",
    payload: input,
    model: input.model ?? "sonnet",
    maxTokens: 8000,
    timeoutMs: SCENE_PLAN_TIMEOUT_MS,
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
        "[scene-plan] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

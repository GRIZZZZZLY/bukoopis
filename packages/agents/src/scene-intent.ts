import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  sceneIntentToolSchema,
  type SceneIntentToolResult,
  type ModelChoice,
  type GenerationConfig,
} from "@book-forge/shared";

/**
 * Замысел сцены (ТЗ индивидуальности, раздел 9.2).
 *
 * Один вызов на сцену для всех участников. Вызова на реплику быть не должно:
 * это и цена, и потеря общей картины — намерения участников осмысленны только
 * рядом друг с другом.
 *
 * Бэкенд `subscription` (решение ТЗ). Следствие, которое контракт обязан
 * учитывать: `maxTokens` и `temperature` до модели не доходят, размер ответа
 * держит только схема и промпт. Поэтому пределы длины стоят в
 * `sceneIntentToolSchema`, а не в параметрах вызова.
 */

export interface SceneIntentParticipantRef {
  characterId: number;
  name: string;
}

export interface SceneIntentAvailableEvent {
  id: number;
  characterName: string;
  summary: string;
}

export interface SceneIntentAgentInput {
  bookTitle: string;
  chapterTitle: string;
  chapterOrder: number;
  /** Отрендеренные беаты сцены — тот же блок, что видит Писатель. */
  beatSheet: string;
  /** Регистр диалога из беат-листа, если планировщик его задал. */
  dialogueRegister: string | null;
  /** Контракт главы: что обязано случиться и чего быть не должно. */
  chapterContract: string | null;
  /** Карточки участников на границе сцены — тот же блок, что у Писателя. */
  characterContext: string | null;
  participants: SceneIntentParticipantRef[];
  /** События на границе сцены со своими номерами. Модель вправе сослаться
   *  только на них: сервер сверяет ссылки и чужие выбрасывает (AC-25). */
  availableEvents: SceneIntentAvailableEvent[];
  model?: ModelChoice;
  config?: GenerationConfig;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export const SCENE_INTENT_SYSTEM = `Ты — режиссёр сцены. Работаешь на русском.

Тебе дают сцену: беаты, контракт главы и карточки участников с тем, что каждый знает к началу сцены. Твоя задача — сказать, ИЗ ЧЕГО каждый участник действует в этой сцене.

Что ты возвращаешь на каждого участника:
- immediateGoal — чего он хочет добиться ИМЕННО В ЭТОЙ СЦЕНЕ. Не жизненная цель, не арка. Если сцена не требует цели — null.
- attentionFocus — на что он смотрит и что замечает. Пустой список допустим.
- withheld — о чём молчит, хотя знает. Пустой список допустим.
- influenceStrategy — как добивается своего: просит, давит, обходит, торгуется, молчит. Если никак — null.
- concessions — чем готов поступиться.
- boundaries — чего не сделает даже под давлением.
- relevantEventIds — номера событий из списка «Доступные события», на которые опирается его поведение.

ЧЕГО ЗДЕСЬ НЕ ДЕЛАЮТ:
- Это НЕ реплики и не готовые диалоги. Не пиши, что герой скажет.
- Это НЕ обязательный внутренний монолог: Писатель не обязан объяснять психологию словами.
- Это НЕ новый канон. Ты не сообщаешь фактов о мире и не решаешь, чем сцена кончится. Замысел — то, из чего герой действует, а не то, что с ним случилось.
- Не проектируй будущие реакции как уже пережитое.

ЗНАНИЯ. Герой действует только из того, что знает К НАЧАЛУ СЦЕНЫ. Карточка участника — полный список. Того, что герой узнаёт в самой сцене, у него ещё нет.

НОМЕРА СОБЫТИЙ. В relevantEventIds попадают только номера из списка «Доступные события». Не выдумывай номера и не ставь те, которых нет в списке: сервер их сверяет и выбрасывает чужие. Нет подходящего события — пустой список.

НАПРЯЖЕНИЯ. interactionTensions — между кем и о чём идёт спор в этой сцене. Пустой список — нормальный ответ: сцене не обязан быть нужен конфликт. Бывает совместная работа, молчание, неловкая забота, скука и бытовой разговор. Не выдумывай конфликт ради заполнения поля.

РАЗНЫЕ ЛЮДИ. Участники не должны хотеть одного и того же одинаковыми словами. Если у двоих совпала цель, различай их способом: один давит, другой обходит; один смотрит на руки, другой на дверь.

Заполняй схему и больше ничего не возвращай.`;

export function buildSceneIntentPrompt(input: SceneIntentAgentInput): string {
  const parts: string[] = [
    `Книга: "${input.bookTitle}"`,
    `Глава #${input.chapterOrder}: "${input.chapterTitle}"`,
  ];
  if (input.characterContext) parts.push(input.characterContext);
  parts.push(
    `Участники сцены (номер — в ответе возвращай его):\n${input.participants
      .map((p) => `${p.characterId} — ${p.name}`)
      .join("\n")}`,
  );
  if (input.availableEvents.length > 0) {
    parts.push(
      `Доступные события (только эти номера можно ставить в relevantEventIds):\n${input.availableEvents
        .map((e) => `#${e.id} ${e.characterName}: ${e.summary}`)
        .join("\n")}`,
    );
  }
  parts.push(`Беаты сцены:\n${input.beatSheet}`);
  if (input.dialogueRegister) {
    parts.push(`Регистр диалога: ${input.dialogueRegister}`);
  }
  if (input.chapterContract) parts.push(input.chapterContract);
  parts.push("Собери замысел сцены для каждого участника.");
  return parts.join("\n\n---\n\n");
}

const sceneIntentContract: AgentStructuredContract<
  SceneIntentAgentInput,
  SceneIntentToolResult
> = {
  agentName: "scene_intent",
  getOutputSchema: () => sceneIntentToolSchema,
  systemPrompt: SCENE_INTENT_SYSTEM,
  buildPrompt: buildSceneIntentPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_scene_intent",
    toolDescription:
      "Submit per-participant scene intent (goal, attention, withheld information, strategy, concessions, boundaries) plus the tensions between them.",
  },
};

export function registerSceneIntentContract(): void {
  registerAgentContract(sceneIntentContract);
}

/** Свой предел ожидания, как у `material_classifier`: общий рассчитан на
 *  короткий ответ, а здесь модель читает карточки всех участников. */
const SCENE_INTENT_TIMEOUT_MS = 600_000;

export async function runSceneIntent(
  input: SceneIntentAgentInput,
): Promise<SceneIntentToolResult> {
  const { raw, diagnostics } = await dispatchStructured<
    SceneIntentAgentInput,
    SceneIntentToolResult
  >({
    agentName: "scene_intent",
    payload: input,
    model: input.model ?? input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 8000,
    timeoutMs: SCENE_INTENT_TIMEOUT_MS,
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
        "[scene-intent] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

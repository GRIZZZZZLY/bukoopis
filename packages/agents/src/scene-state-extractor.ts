import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  sceneStateToolSchema,
  type SceneStateToolResult,
  type ModelChoice,
} from "@book-forge/shared";

/**
 * Извлекатель состояния сцены — анкета непрерывности на конец главы
 * (`docs/superpowers/specs/2026-09-21-scene-state-design.md`).
 *
 * Один вызов на принятую версию главы. Отвечает на вопрос, которым не
 * занимается ни один другой извлекатель: где герои остались, что на них
 * надето, что у них в руках и что осталось незакрытым. Канон-факты держат
 * устойчивое, события — знания и обещания, а обстановка сцены не хранилась
 * нигде.
 *
 * Цитат-доказательств у пунктов нет намеренно: анкета не пополняет канон и
 * живёт одну главу, следующая версия заводит новую.
 */

export interface SceneStateExtractorInput {
  chapterTitle: string;
  /** Порядковый номер главы в книге — для промпта, не `order_index`. */
  chapterPosition: number;
  chapterText: string;
  /** Имена состава книги: анкета должна звать героев так же, как канон. */
  castNames: string[];
  /** Анкета предыдущей главы в отрендеренном виде — источник поля `changes`.
   *  `null` — предыдущей главы нет или её анкета не посчитана. */
  previousState: string | null;
  model?: ModelChoice;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export const SCENE_STATE_SYSTEM = `Ты — секретарь съёмочной площадки. Работаешь на русском.

Тебе дают текст главы. Ты записываешь ПОЛОЖЕНИЕ ВЕЩЕЙ НА КОНЕЦ ГЛАВЫ — то, из чего начнётся следующая сцена. Не пересказ событий: пересказом занимается другой инструмент.

Поля:
- place — где кончилась глава. Одно место, а не маршрут.
- timeMarker — время суток к концу главы и сколько прошло с прошлой сцены, если в тексте это сказано.
- present — кто на месте к концу главы и в каком положении («Нина — у двери, не села»). Ушедших не пиши.
- appearance — во что одет и как выглядит, по строке на героя. Только то, что важно узнать в следующей сцене: порванный рукав, чужое пальто, сбритая борода.
- carried — что у героя при себе к концу главы: ключ, пистолет, чужой телефон. Взятое и потерянное в этой главе — обязательно.
- condition — раны, усталость, опьянение, голод, боль. То, что не пройдёт к следующей сцене само.
- surroundings — погода, свет, шум, что сломано или открыто в этом месте.
- loose — что осталось незакрытым физически: дверь открыта, мотор не заглушён, тело не убрано, звонок не отвечен.
- changes — чем это отличается от анкеты прошлой главы. Если прошлой анкеты нет — пустой список.

ПРАВИЛА:
- Пиши только то, что есть в тексте главы. Не достраивай и не додумывай: пустое поле честнее выдуманного.
- Имена героев бери из состава книги, в именительном падеже. Героя, которого в составе нет, называй так, как назван в тексте.
- Ничего не толкуй: «устала» — состояние, «сломалась внутренне» — толкование, его не пиши.
- Коротко. Каждая строка — одна вещь, до одного предложения.
- Пустой список — нормальный ответ. Глава без единой физической детали существует.

Заполняй схему и больше ничего не возвращай.`;

export function buildSceneStatePrompt(input: SceneStateExtractorInput): string {
  const parts: string[] = [`Глава ${input.chapterPosition}: "${input.chapterTitle}"`];
  if (input.castNames.length > 0) {
    parts.push(`Состав книги (имена канона):\n${input.castNames.join(", ")}`);
  }
  if (input.previousState) {
    parts.push(`Анкета предыдущей главы:\n${input.previousState}`);
  }
  parts.push(`Текст главы:\n${input.chapterText}`);
  parts.push("Запиши положение вещей на конец этой главы.");
  return parts.join("\n\n---\n\n");
}

const sceneStateContract: AgentStructuredContract<
  SceneStateExtractorInput,
  SceneStateToolResult
> = {
  agentName: "scene_state_extractor",
  getOutputSchema: () => sceneStateToolSchema,
  systemPrompt: SCENE_STATE_SYSTEM,
  buildPrompt: buildSceneStatePrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_scene_state",
    toolDescription:
      "Submit the physical state of the scene at the end of a chapter: place, time, who is present, appearance, carried items, condition, surroundings, loose ends and what changed.",
  },
};

export function registerSceneStateExtractorContract(): void {
  registerAgentContract(sceneStateContract);
}

/** Свой предел ожидания, как у классификатора материала и замысла сцены:
 *  общий `LLM_TIMEOUT_MS` рассчитан на короткий ответ, а здесь модель читает
 *  главу целиком. */
const SCENE_STATE_TIMEOUT_MS = 600_000;

export async function runSceneStateExtractor(
  input: SceneStateExtractorInput,
): Promise<SceneStateToolResult> {
  const { raw, diagnostics } = await dispatchStructured<
    SceneStateExtractorInput,
    SceneStateToolResult
  >({
    agentName: "scene_state_extractor",
    payload: input,
    model: input.model ?? "sonnet",
    maxTokens: 8000,
    timeoutMs: SCENE_STATE_TIMEOUT_MS,
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
        "[scene-state] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

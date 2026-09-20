import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  castCheckToolSchema,
  type CastCheckToolResult,
  type ModelChoice,
  type GenerationConfig,
} from "@book-forge/shared";

/**
 * Проверка различий состава (ТЗ индивидуальности, раздел 9.1).
 *
 * Отвечает на один вопрос: есть ли в составе герои, которых можно поменять
 * местами. Ничего не меняет — каждое направление это предложение автору.
 *
 * Бэкенд `subscription`, как у остальных агентов этапа 5: `maxTokens` и
 * `temperature` до модели не доходят, размер держит схема ответа.
 */

export interface CastCheckAgentInput {
  bookTitle: string;
  /** Компактное описание принятого состава (`renderCastForCheck`). */
  castBlock: string;
  premise: string | null;
  model?: ModelChoice;
  config?: GenerationConfig;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

export const CAST_CHECK_SYSTEM = `Ты — редактор состава. Работаешь на русском.

Тебе дают принятых героев книги: цели, принципы, ценности, противоречия, голос. Твоя задача — найти пары, которых можно поменять местами, не заметив подмены.

КАК СУДИТЬ. Сравнивай не прилагательные («оба замкнутые»), а РЕАКЦИИ на одинаковые ситуации:
- value_conflict — его ценность сталкивается с чужой;
- request_for_help — у него просят помощи;
- mistake — он сам ошибся, и это видно;
- pressure_from_authority — на него давит тот, кто выше;
- talk_with_close — разговор с близким человеком.
Мысленно поставь каждого героя в эти положения и посмотри, чем отличается его первый ход. Совпадают ходы — это и есть взаимозаменяемость.

ЧТО НОРМА, А ЧТО НЕТ:
- Совпадение ОДНОЙ ценности — норма. Двое могут одинаково дорожить честностью и вести себя по-разному.
- Общая профессия, общий возраст, общий регистр речи книги — не основание.
- Проблема — систематически совпадающие мотивировки, реакции и речь: герой хочет того же, добивается так же и говорит так же.

НА КАЖДУЮ ПАРУ:
- characterIds — номера ДВУХ разных героев из списка. Других номеров нет.
- similarity — в чём именно они взаимозаменяемы.
- basis — конкретное основание: какие поля профилей совпадают и в чём.
- situations — в каких из пяти положений их ходы совпадают.
- directions — возможные направления различения. Это ПРЕДЛОЖЕНИЯ автору: что можно дать одному, чтобы разошлись. Минимум одно.
- keep — что в этой паре стоит сохранить: сходство бывает замыслом (брат и сестра, ученики одного мастера).

ЧЕГО НЕ ДЕЛАТЬ:
- Ты ничего не меняешь и не правишь героев. Отчёт — предложение автору, решает он.
- Не требуй сделать героев максимально противоположными. Цель — различимость, а не контраст.
- Не выдумывай сходства ради заполнения: если состав различим, верни пустой список пар и скажи это в notes.

В notes — одно-два предложения: чем состав в целом держится и что стоит посмотреть первым.`;

export function buildCastCheckPrompt(input: CastCheckAgentInput): string {
  const parts: string[] = [`Книга: "${input.bookTitle}"`];
  if (input.premise) parts.push(`Премиса: ${input.premise}`);
  parts.push(
    `Принятый состав (номер — в ответе возвращай его):\n${input.castBlock}`,
    "Найди пары, которых можно поменять местами. Если таких нет — пустой список пар.",
  );
  return parts.join("\n\n---\n\n");
}

const castCheckContract: AgentStructuredContract<CastCheckAgentInput, CastCheckToolResult> = {
  agentName: "cast_check",
  getOutputSchema: () => castCheckToolSchema,
  systemPrompt: CAST_CHECK_SYSTEM,
  buildPrompt: buildCastCheckPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_cast_check",
    toolDescription:
      "Submit pairs of characters that are interchangeable, with the basis, the situations where their first move coincides, suggested ways to tell them apart, and what to keep.",
  },
};

export function registerCastCheckContract(): void {
  registerAgentContract(castCheckContract);
}

/** Свой предел ожидания, как у остальных подписочных агентов этапа. */
const CAST_CHECK_TIMEOUT_MS = 600_000;

export async function runCastCheck(
  input: CastCheckAgentInput,
): Promise<CastCheckToolResult> {
  const { raw, diagnostics } = await dispatchStructured<
    CastCheckAgentInput,
    CastCheckToolResult
  >({
    agentName: "cast_check",
    payload: input,
    model: input.model ?? input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 8000,
    timeoutMs: CAST_CHECK_TIMEOUT_MS,
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
        "[cast-check] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

import { z } from "zod";
import type { ZodType, ZodError } from "zod";
import {
  query,
  tool,
  createSdkMcpServer,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  LLMAuthError,
  LLMError,
  LLMTimeoutError,
  LLMNoToolCallError,
  LLMMultipleToolCallsError,
  LLMValidationError,
} from "../errors.js";
import { resolveModelId } from "../models.js";
import { withRetry, isTransientLlmError, llmTimeoutMs } from "../retry.js";
import type { AgentStructuredContract } from "../types.js";
import type { ModelChoice } from "@book-forge/shared";

/** Наблюдаемые события одного вызова. Structured-режим не даёт токен-дельт,
 *  но SDK-поток даёт вехи: попытка началась, модель заговорила, инструмент
 *  вызван. Их достаточно, чтобы UI показывал живой прогресс, а не спиннер. */
export type McpProgressEvent =
  | { kind: "attempt"; attempt: number }
  | { kind: "model_started" }
  | { kind: "model_output"; chars: number }
  | { kind: "tool_call" };

export interface McpSubmitToolInput<I> {
  payload: I;
  model: ModelChoice;
  /** Override of contract.systemPrompt for this call only (string-form only;
   *  block-array system prompts are not supported in MCP mode). */
  systemPromptOverride?: string;
  /** Override of contract.mcp.maxTurns for this call. */
  maxTurnsOverride?: number;
  /** Свой предел ожидания вместо общего `LLM_TIMEOUT_MS`; 0 — без предела. */
  timeoutMs?: number;
  /** Предел длины ответа. У SDK нет такого поля в `Options`, но CLI, который
   *  он запускает, читает `CLAUDE_CODE_MAX_OUTPUT_TOKENS` из окружения —
   *  поэтому предел едет туда. Без этого `maxTokens` работал только на прямом
   *  API, а на подписке молча игнорировался: длинный ответ обрывался, и обрыв
   *  приходил как «инструмент не вызван», без `stop_reason` и без подсказки,
   *  что дело в длине. */
  maxTokens?: number;
  /** Прогресс-хук; синхронный, ошибки внутри не должны ломать вызов. */
  onProgress?: (event: McpProgressEvent) => void;
}

export interface McpSubmitToolDiagnostics {
  modelId: string;
  toolCallCount: number;
  resultSubtype?: string;
  isError?: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface McpSubmitToolResult<O> {
  raw: O;
  diagnostics: McpSubmitToolDiagnostics;
}

function forceToolPrompt(userPrompt: string, toolName: string): string {
  return `${userPrompt}\n\n---\n\nYou MUST call exactly one tool: \`${toolName}\`. Do not answer in prose. The tool input must satisfy the schema. If no issues are found, submit a payload that the schema accepts (e.g. an empty issues array).`;
}

function isAuthErrorCode(code: string): boolean {
  return (
    code === "authentication_failed" ||
    code === "oauth_org_not_allowed" ||
    code === "billing_error"
  );
}

/** Длина текстовых блоков ассистента — грубая мера «сколько уже написано».
 *  Форма сообщения задаётся SDK, поэтому доступ защитный. */
function assistantTextLength(msg: SDKMessage): number {
  const content = (msg as { message?: { content?: unknown } }).message?.content;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string") total += text.length;
  }
  return total;
}

function summariseAssistantError(
  msg: SDKMessage,
  modelId: string,
): LLMError | undefined {
  if (msg.type !== "assistant") return undefined;
  const code = (msg as { error?: string }).error;
  if (!code) return undefined;
  if (isAuthErrorCode(code)) {
    return new LLMAuthError(
      `[subscription/${modelId}] auth/billing failure: ${code}. Check 'claude login' state.`,
    );
  }
  return new LLMError(`[subscription/${modelId}] ${code}`);
}

/**
 * Схема для `tool()`: та же, но каждое поле верхнего уровня дополнительно
 * принимает строку.
 *
 * SDK проверяет аргументы САМ, до вызова обработчика, и на несовпадение
 * отвечает модели `MCP error -32602` — наш код об этом даже не узнаёт. А
 * модель на сложной схеме присылает вложенный массив JSON-строкой. Поэтому
 * строгую проверку делает обработчик (после `parseJsonStringFields`), а
 * сюда уходит ослабленная копия: она пропускает строку внутрь, где та
 * разворачивается и проверяется по-настоящему.
 */
function toolFacingSchema<O>(schema: ZodType<O>): ZodType<unknown> {
  const shape = (schema as unknown as { shape?: Record<string, ZodType> }).shape;
  if (!shape || typeof shape !== "object") return schema as ZodType<unknown>;
  const loosened: Record<string, ZodType> = {};
  for (const [key, field] of Object.entries(shape)) {
    loosened[key] = z.union([field, z.string()]).optional();
  }
  return z.object(loosened) as unknown as ZodType<unknown>;
}

/**
 * Поле, присланное JSON-строкой вместо массива или объекта, разворачивается
 * обратно (живой прогон 2026-09-20).
 *
 * На сложной схеме модель сериализует вложенную структуру в строку — так
 * устроена передача аргументов инструменту. Проверка же видела строку там,
 * где ждала массив, и отвечала разом «expected array, received string» и
 * «too_big: expected string to have <=30 characters»: предел длины массива
 * применялся к строке. Модель читала этот ответ, пыталась переформатировать
 * и упиралась в предел ходов — извлечение фактов не проходило ни на одной
 * главе.
 *
 * Строка, которая просто строка, остаётся строкой: поле, где ждали текст, не
 * должно превращаться в структуру.
 *
 * Строка, которая начинается как JSON-массив, но не разбирается, становится
 * ПУСТЫМ массивом. Так приходит `characterEvents`: сериализуя массив в
 * строку, модель ломает экранирование на русских кавычках и переносах, и
 * восстановить содержимое нельзя. Но факты в том же ответе приходят
 * настоящим массивом и целы — ронять их из-за соседнего поля значит терять
 * память всей главы каждый раз. Потеря видна вызывающему по числу записей;
 * это тот же приём, что у негодной строки внутри массива фактов.
 */
function parseJsonStringFields(args: unknown): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) out[key] = parsed;
    } catch {
      // Похоже на массив, но не разбирается — отдаём пустой, чтобы уцелело
      // всё остальное. Объект не подменяем: у него нет безопасного пустого
      // значения, и молча отдать `{}` значило бы выдумать содержимое.
      if (trimmed.startsWith("[")) out[key] = [];
    }
  }
  return out;
}

export async function callViaSdkMcpSubmitTool<I, O>(
  contract: AgentStructuredContract<I, O>,
  outputSchema: ZodType<O>,
  input: McpSubmitToolInput<I>,
): Promise<McpSubmitToolResult<O>> {
  if (!contract.mcp) {
    throw new LLMError(
      `[mcp-submit-tool] contract for "${contract.agentName}" has no mcp spec; cannot run in mcp_submit_tool mode`,
    );
  }
  const mcp = contract.mcp;
  const modelId = `subscription:${resolveModelId(input.model)}`;
  let attempt = 0;
  const emit = (event: McpProgressEvent): void => {
    try {
      input.onProgress?.(event);
    } catch {
      /* прогресс — best-effort, вызов не роняем */
    }
  };

  // One attempt. Per-attempt state lives inside so retries start clean.
  const runOnce = async (): Promise<McpSubmitToolResult<O>> => {
  attempt++;
  emit({ kind: "attempt", attempt });
  let capturedPayload: O | undefined;
  let capturedValidationError: ZodError | undefined;
  let toolCallCount = 0;

  // SDK 0.2.x `tool()` accepts the Zod schema directly and validates args
  // before invoking the handler. The cast satisfies TS without exposing
  // schema internals (`.shape` would be fragile vs the SDK contract).
  const toolInputSchema = toolFacingSchema(outputSchema) as unknown as Parameters<typeof tool>[2];
  const submitTool = tool(
    mcp.toolName,
    mcp.toolDescription,
    toolInputSchema,
    async (args: unknown) => {
      toolCallCount++;
      emit({ kind: "tool_call" });
      const parsed = outputSchema.safeParse(parseJsonStringFields(args));
      if (!parsed.success) {
        capturedValidationError = parsed.error;
        return {
          content: [
            {
              type: "text" as const,
              text: `Schema mismatch: ${parsed.error.message}`,
            },
          ],
          isError: true,
        };
      }
      capturedPayload = parsed.data;
      return {
        content: [{ type: "text" as const, text: "Accepted." }],
      };
    },
  );

  const serverName = `submit_${contract.agentName}`;
  const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });

  const userPrompt = contract.buildPrompt(input.payload);
  // Force SDK onto Claude Code CLI credentials by stripping
  // ANTHROPIC_API_KEY from the spawn env. Without this, the SDK prefers
  // the API key (intended for non-subscription auth) and fails with 401
  // when the key is invalid/empty/missing.
  const subscriptionEnv: Record<string, string | undefined> = {
    ...process.env,
  };
  delete subscriptionEnv.ANTHROPIC_API_KEY;
  if (input.maxTokens !== undefined) {
    subscriptionEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(input.maxTokens);
  }
  const options: Options = {
    model: resolveModelId(input.model),
    systemPrompt: input.systemPromptOverride ?? contract.systemPrompt,
    tools: [],
    mcpServers: { [serverName]: mcpServer },
    allowedTools: [`mcp__${serverName}__${mcp.toolName}`],
    maxTurns: input.maxTurnsOverride ?? mcp.maxTurns ?? 3,
    env: subscriptionEnv,
    // Расширенное размышление выключено (живой прогон 2026-09-20). Сессия
    // Claude Code включает его по умолчанию, и на сложном структурном
    // запросе — план книги, беат-лист главы — модель уходит думать дольше,
    // чем CLI готов ждать первый кусок потока. CLI молча шлёт запрос заново,
    // модель снова уходит думать: три круга по ~175 секунд и ни одного
    // вызова инструмента. Тот же запрос без размышления отдаёт валидный
    // ответ за 120 секунд. Агенту здесь думать и не нужно: он заполняет
    // схему, а не решает задачу в несколько ходов.
    thinking: { type: "disabled" },
    maxThinkingTokens: 0,
    // Пустой список = не читать ни пользовательские, ни проектные, ни
    // локальные настройки. Иначе на каждый вызов агента поднимается сессия
    // с чужими хуками, плагинами и MCP-серверами: 126 инструментов вместо
    // одного и 5.5 секунды старта вместо 0.7. Агенту нужен ровно один
    // инструмент — свой submit.
    settingSources: [],
  };

  // Per-call timeout: abort the query if it stalls past LLM_TIMEOUT_MS (or the
  // caller's own limit, for agents whose long answer is normal work).
  const timeoutMs = input.timeoutMs ?? llmTimeoutMs();
  const controller = new AbortController();
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          controller.abort(
            new LLMError(`[subscription/${modelId}] timed out after ${timeoutMs}ms`),
          );
        }, timeoutMs)
      : null;
  timer?.unref?.();
  options.abortController = controller;

  const q = query({
    prompt: forceToolPrompt(userPrompt, mcp.toolName),
    options,
  });

  let resultMsg: SDKMessage | undefined;
  let modelStarted = false;
  try {
    for await (const msg of q) {
      const authErr = summariseAssistantError(msg, modelId);
      if (authErr) throw authErr;
      if (msg.type === "system" && !modelStarted) {
        modelStarted = true;
        emit({ kind: "model_started" });
      }
      if (msg.type === "assistant") {
        if (!modelStarted) {
          modelStarted = true;
          emit({ kind: "model_started" });
        }
        emit({ kind: "model_output", chars: assistantTextLength(msg) });
      }
      if (msg.type === "result") resultMsg = msg;
    }
  } catch (e) {
    // Обрыв по нашему же таймеру SDK сообщает как «Claude Code process aborted
    // by user» — читатель ищет, кто нажал отмену, вместо того чтобы увидеть
    // предел ожидания. Называем вещь своим именем: это наш таймаут, и лечится
    // он не повтором, а бо́льшим пределом (или меньшим куском работы).
    if (controller.signal.aborted) {
      throw new LLMTimeoutError(
        `[subscription/${modelId}] не уложился в ${timeoutMs} мс — вызов прерван по таймауту (LLM_TIMEOUT_MS или свой предел агента)`,
      );
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (capturedValidationError) {
    throw new LLMValidationError(
      `[subscription/${modelId}] mcp tool payload failed schema validation: ${capturedValidationError.message}`,
      undefined,
    );
  }
  if (toolCallCount === 0) {
    // A timed-out run also arrives here with zero tool calls: aborting the
    // controller ends the SDK stream without throwing. Reporting that as "the
    // model refused to call the tool" sends the reader hunting for a prompt or
    // schema bug when the backend simply never answered, so name it for what
    // it is.
    if (controller.signal.aborted) {
      throw new LLMTimeoutError(
        `[subscription/${modelId}] no response within ${timeoutMs}ms — ${mcp.toolName} was never called (backend stalled or unreachable)`,
      );
    }
    throw new LLMNoToolCallError(
      `[subscription/${modelId}] model did not call ${mcp.toolName}`,
    );
  }
  if (toolCallCount > 1) {
    throw new LLMMultipleToolCallsError(
      `[subscription/${modelId}] expected exactly one tool call, got ${toolCallCount}`,
    );
  }
  if (capturedPayload === undefined) {
    throw new LLMValidationError(
      `[subscription/${modelId}] no payload captured from tool handler`,
      undefined,
    );
  }

  const r = resultMsg as
    | {
        subtype?: string;
        is_error?: boolean;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      }
    | undefined;

  return {
    raw: capturedPayload,
    diagnostics: {
      modelId,
      toolCallCount,
      resultSubtype: r?.subtype,
      isError: r?.is_error,
      inputTokens: r?.usage?.input_tokens ?? 0,
      outputTokens: r?.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: r?.usage?.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: r?.usage?.cache_read_input_tokens ?? 0,
    },
  };
  };

  // Retry transient failures (rate_limit, 5xx, network, timeout); auth and
  // schema/tool-call contract violations are terminal (isTransientLlmError).
  // This closes the gap where the subscription backend had no retry at all.
  return withRetry(runOnce, { isRetryable: isTransientLlmError });
}

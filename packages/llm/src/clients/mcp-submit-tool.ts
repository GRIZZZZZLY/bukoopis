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
  const toolInputSchema = outputSchema as unknown as Parameters<typeof tool>[2];
  const submitTool = tool(
    mcp.toolName,
    mcp.toolDescription,
    toolInputSchema,
    async (args: unknown) => {
      toolCallCount++;
      emit({ kind: "tool_call" });
      const parsed = outputSchema.safeParse(args);
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
  const options: Options = {
    model: resolveModelId(input.model),
    systemPrompt: input.systemPromptOverride ?? contract.systemPrompt,
    tools: [],
    mcpServers: { [serverName]: mcpServer },
    allowedTools: [`mcp__${serverName}__${mcp.toolName}`],
    maxTurns: input.maxTurnsOverride ?? mcp.maxTurns ?? 3,
    env: subscriptionEnv,
  };

  // Per-call timeout: abort the query if it stalls past LLM_TIMEOUT_MS.
  const timeoutMs = llmTimeoutMs();
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

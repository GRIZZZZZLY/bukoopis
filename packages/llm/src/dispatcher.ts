import type { ZodType } from "zod";
import { LLMError } from "./errors.js";
import { getAgentContract } from "./structured-registry.js";
import { resolveBackendForCall, resolveStructuredMode } from "./router.js";
import { callViaAnthropicApi, type StructuredUsage } from "./structured.js";
import { callViaSdkMcpSubmitTool } from "./clients/mcp-submit-tool.js";
import { resolveModelId } from "./models.js";
import type {
  AgentName,
  AgentStructuredContract,
  LLMBackend,
  StructuredMode,
} from "./types.js";
import type { ModelChoice } from "@book-forge/shared";
import type { SystemBlock } from "./stream.js";

export interface StructuredDiagnostics {
  modelId: string;
  backend: LLMBackend;
  mode?: StructuredMode;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  toolCallCount?: number;
  resultSubtype?: string;
  isError?: boolean;
  latencyMs: number;
}

export interface DispatchStructuredInput<I> {
  agentName: AgentName;
  payload: I;
  model: ModelChoice;
  /** Optional override of the contract's resolved mode for this call only. */
  mode?: StructuredMode;
  /** Override the system prompt — defaults to contract.systemPrompt. */
  systemBlocks?: SystemBlock[] | string;
  cacheableSystem?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Свой предел ожидания для этого вызова, мс; 0 — без предела. По умолчанию
   *  берётся общий `LLM_TIMEOUT_MS` (120 с). Нужен агентам, у которых длинный
   *  ответ — норма, а не признак зависшего бэкенда: material_classifier
   *  переносит текст автора дословно и на большом файле пишет минутами, и
   *  общий предел рубил его посреди работы. */
  timeoutMs?: number;
  /** Lightweight observability hook fired once after the call resolves. */
  onDiagnostics?: (d: StructuredDiagnostics) => void;
  /** Вехи выполнения для UI-прогресса. Best-effort, вызов не роняют. */
  onProgress?: (e: StructuredProgressEvent) => void;
}

/** Вехи структурного вызова. Токен-дельт у structured-режима нет, поэтому это
 *  события уровня «запрос ушёл / модель пишет / инструмент вызван». */
export type StructuredProgressEvent =
  | { kind: "dispatch"; backend: LLMBackend; modelId: string }
  | { kind: "attempt"; attempt: number }
  | { kind: "model_started" }
  | { kind: "model_output"; chars: number }
  | { kind: "tool_call" }
  | { kind: "validated" };

export interface DispatchStructuredResult<O> {
  raw: O;
  diagnostics: StructuredDiagnostics;
}

export async function dispatchStructured<I, O>(
  input: DispatchStructuredInput<I>,
): Promise<DispatchStructuredResult<O>> {
  const contract = getAgentContract(input.agentName) as AgentStructuredContract<I, O>;
  const outputSchema = contract.getOutputSchema(input.payload);
  const backend = resolveBackendForCall({
    agentName: input.agentName,
    provider: "anthropic",
    hasOutputSchema: true,
  });

  const start = performance.now();
  const emit = (e: StructuredProgressEvent): void => {
    try {
      input.onProgress?.(e);
    } catch {
      /* прогресс — best-effort */
    }
  };
  emit({ kind: "dispatch", backend, modelId: resolveModelId(input.model) });

  if (backend === "api") {
    let apiUsage: StructuredUsage | undefined;
    const raw = await callViaAnthropicApi(contract, outputSchema as ZodType<O>, {
      agentName: input.agentName,
      payload: input.payload,
      model: input.model,
      ...(input.systemBlocks !== undefined ? { systemBlocks: input.systemBlocks } : {}),
      ...(input.cacheableSystem !== undefined
        ? { cacheableSystem: input.cacheableSystem }
        : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      onUsage: (u) => {
        apiUsage = u;
      },
    });
    emit({ kind: "tool_call" });
    const validated = outputSchema.safeParse(raw);
    if (!validated.success) {
      throw new LLMError(
        `[dispatcher] post-validation failed for ${input.agentName}: ${validated.error.message}`,
      );
    }
    emit({ kind: "validated" });
    const diagnostics: StructuredDiagnostics = {
      modelId: apiUsage?.modelId ?? resolveModelId(input.model),
      backend: "api",
      inputTokens: apiUsage?.inputTokens ?? 0,
      outputTokens: apiUsage?.outputTokens ?? 0,
      cacheCreationInputTokens: apiUsage?.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: apiUsage?.cacheReadInputTokens ?? 0,
      latencyMs: performance.now() - start,
    };
    input.onDiagnostics?.(diagnostics);
    return { raw: validated.data, diagnostics };
  }

  // backend === "subscription"
  const mode = resolveStructuredMode({
    agentName: input.agentName,
    contractDefault: contract.defaultMode,
    ...(input.mode !== undefined ? { perCall: input.mode } : {}),
  });

  if (mode !== "mcp_submit_tool") {
    throw new LLMError(
      `[dispatcher] mode "${mode}" not implemented in Phase 1; set LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP={"${input.agentName}":"mcp_submit_tool"} or wait for Phase 2+`,
    );
  }

  const sub = await callViaSdkMcpSubmitTool(contract, outputSchema as ZodType<O>, {
    payload: input.payload,
    model: input.model,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    // Предел длины ответа доезжает и сюда: на подписке он раньше терялся, и
    // агент, у которого длинный ответ — нормальная работа, обрывался молча.
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.onProgress !== undefined ? { onProgress: emit } : {}),
  });
  const validated = outputSchema.safeParse(sub.raw);
  if (!validated.success) {
    throw new LLMError(
      `[dispatcher] post-validation failed for ${input.agentName}: ${validated.error.message}`,
    );
  }
  emit({ kind: "validated" });
  const diagnostics: StructuredDiagnostics = {
    modelId: sub.diagnostics.modelId,
    backend: "subscription",
    mode,
    inputTokens: sub.diagnostics.inputTokens,
    outputTokens: sub.diagnostics.outputTokens,
    cacheCreationInputTokens: sub.diagnostics.cacheCreationInputTokens,
    cacheReadInputTokens: sub.diagnostics.cacheReadInputTokens,
    toolCallCount: sub.diagnostics.toolCallCount,
    ...(sub.diagnostics.resultSubtype !== undefined
      ? { resultSubtype: sub.diagnostics.resultSubtype }
      : {}),
    ...(sub.diagnostics.isError !== undefined
      ? { isError: sub.diagnostics.isError }
      : {}),
    latencyMs: performance.now() - start,
  };
  input.onDiagnostics?.(diagnostics);
  return { raw: validated.data, diagnostics };
}

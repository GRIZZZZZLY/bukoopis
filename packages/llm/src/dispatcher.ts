import { z, type ZodType } from "zod";
import { LLMError } from "./errors.js";
import { chatStructuredOllama, ollamaModelKind, OllamaHttpError } from "./ollama.js";
import { getAgentContract } from "./structured-registry.js";
import { resolveBackendForCall, resolveStructuredMode } from "./router.js";
import { callViaAnthropicApi, type StructuredUsage } from "./structured.js";
import { callViaSdkMcpSubmitTool } from "./clients/mcp-submit-tool.js";
import { resolveModelId } from "./models.js";
import type {
  AgentName,
  AgentStructuredContract,
  LLMBackend,
  LocalModelRef,
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
  /** Локальная чат-модель Ollama: вызов идёт мимо Claude, `model` игнорируется. */
  local?: LocalModelRef;
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
  if (input.local) {
    return dispatchLocal(input, contract, outputSchema as ZodType<O>);
  }
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

function stripFence(text: string): string {
  const t = text.trim();
  const m = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(t);
  return (m ? m[1]! : t).trim();
}

async function dispatchLocal<I, O>(
  input: DispatchStructuredInput<I>,
  contract: AgentStructuredContract<I, O>,
  outputSchema: ZodType<O>,
): Promise<DispatchStructuredResult<O>> {
  const tag = input.local!.model;
  const modelId = `ollama:${tag}`;
  const start = performance.now();
  const emit = (e: StructuredProgressEvent): void => {
    try {
      input.onProgress?.(e);
    } catch {
      /* прогресс — best-effort */
    }
  };

  const kind = await ollamaModelKind(tag);
  if (kind === "raw") {
    throw new LLMError(
      `Модель ${tag} умеет только продолжать прозу; мастерской нужна обычная чат-модель Ollama.`,
    );
  }
  if (kind === "unavailable") {
    throw new LLMError(
      `Локальная модель ${tag} недоступна: запущена ли Ollama и есть ли такая модель?`,
    );
  }
  emit({ kind: "dispatch", backend: "api", modelId });

  const baseSystem =
    input.systemBlocks === undefined
      ? contract.systemPrompt
      : typeof input.systemBlocks === "string"
        ? input.systemBlocks
        : input.systemBlocks.map((b) => b.text).join("\n\n");
  const user = contract.buildPrompt(input.payload);
  const jsonSchema = z.toJSONSchema(outputSchema);
  const timeoutMs = Math.max(input.timeoutMs ?? 0, 600_000);

  let format: unknown = jsonSchema;
  let system = baseSystem;
  let promptTokens = 0;
  let outputTokens = 0;
  let userText = user;
  let lastError = "";
  let lastContent = "";

  // Не более 3 вызовов /api/chat: откат на format "json" (HTTP 400) не тратит
  // единственный повтор по разбору/валидации.
  for (let attempt = 0; attempt < 2; attempt++) {
    emit({ kind: "attempt", attempt: attempt + 1 });
    let res;
    const call = async () => {
      try {
        return await chatStructuredOllama({
          tag,
          system,
          user: userText,
          format,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
          timeoutMs,
        });
      } catch (err) {
        // Модель удалили уже после проверки вида: /api/chat отвечает 404.
        if (err instanceof OllamaHttpError && err.status === 404) {
          throw new LLMError(
            `Локальная модель ${tag} недоступна: запущена ли Ollama и есть ли такая модель?`,
          );
        }
        throw err;
      }
    };
    try {
      res = await call();
    } catch (err) {
      if (!(err instanceof OllamaHttpError) || err.status !== 400 || format === "json") {
        throw err;
      }
      format = "json";
      system = `${baseSystem}

Отвечай только JSON по этой схеме:
${JSON.stringify(jsonSchema)}`;
      res = await call();
    }
    promptTokens += res.promptTokens;
    outputTokens += res.outputTokens;
    lastContent = res.content;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(res.content));
    } catch (err) {
      lastError = `ответ не разобрался как JSON: ${err instanceof Error ? err.message : String(err)}`;
      userText = `${user}

Прошлый ответ не подошёл (${lastError}). Верни только корректный JSON по схеме.`;
      continue;
    }
    const validated = outputSchema.safeParse(parsed);
    if (!validated.success) {
      lastError = `ответ не подошёл под схему: ${validated.error.message}`;
      userText = `${user}

Прошлый ответ не подошёл (${lastError}). Верни только корректный JSON по схеме.`;
      continue;
    }
    emit({ kind: "tool_call" });
    emit({ kind: "validated" });
    const diagnostics: StructuredDiagnostics = {
      modelId,
      backend: "api",
      inputTokens: promptTokens,
      outputTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      latencyMs: performance.now() - start,
    };
    input.onDiagnostics?.(diagnostics);
    return { raw: validated.data, diagnostics };
  }
  throw new LLMError(
    `[dispatcher] локальная модель ${tag} не вернула валидный ответ для ${input.agentName}: ${lastError}. Ответ: ${lastContent.slice(0, 300)}`,
  );
}

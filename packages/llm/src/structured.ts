import type Anthropic from "@anthropic-ai/sdk";
import { z, type ZodType } from "zod";
import { getAnthropicClient } from "./client.js";
import { resolveModelId } from "./models.js";
import { withRetry, llmTimeoutMs } from "./retry.js";
import { buildSystemParam, type SystemBlock } from "./stream.js";
import { LLMValidationError } from "./errors.js";
import type { AgentName, AgentStructuredContract } from "./types.js";
import type { ModelChoice } from "@book-forge/shared";

export { LLMValidationError };

export interface StructuredUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface StructuredCallOptions<T> {
  agentName: AgentName;
  model: ModelChoice;
  system: string | SystemBlock[];
  prompt: string;
  schema: ZodType<T>;
  schemaName: string;
  schemaDescription: string;
  temperature?: number;
  maxTokens?: number;
  onUsage?: (usage: StructuredUsage) => void;
  /** Same semantics as in streamText. */
  cacheableSystem?: boolean;
}

export interface StructuredCallInternal<I> {
  agentName: AgentName;
  payload: I;
  /** Resolved at the call site by the public entry point. */
  systemBlocks?: SystemBlock[] | string;
  cacheableSystem?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Свой предел ожидания вместо общего `LLM_TIMEOUT_MS`; 0 — без предела. */
  timeoutMs?: number;
  onUsage?: (usage: StructuredUsage) => void;
  model: ModelChoice;
}

/**
 * Anthropic API tool_use path. Used both by the legacy `callStructured`
 * wrapper and the new dispatcher for `backend === "api"`.
 */
export async function callViaAnthropicApi<I, O>(
  contract: AgentStructuredContract<I, O>,
  outputSchema: ZodType<O>,
  input: StructuredCallInternal<I>,
): Promise<O> {
  const client = getAnthropicClient();
  const inputSchema = z.toJSONSchema(outputSchema);
  const toolName = contract.mcp?.toolName ?? `submit_${contract.agentName}`;
  const tool = {
    name: toolName,
    description:
      contract.mcp?.toolDescription ??
      `Submit structured output for ${contract.agentName}.`,
    input_schema: inputSchema as Anthropic.Tool["input_schema"],
  } satisfies Anthropic.Tool;
  const modelId = resolveModelId(input.model);
  const cacheable =
    input.cacheableSystem ?? process.env.LLM_PROMPT_CACHE !== "0";
  const systemParam = buildSystemParam(
    input.systemBlocks ?? contract.systemPrompt,
    cacheable,
  );
  const userPrompt = contract.buildPrompt(input.payload);

  const timeoutMs = input.timeoutMs ?? llmTimeoutMs();
  const res = await withRetry(() =>
    client.messages.create(
      {
        model: modelId,
        max_tokens: input.maxTokens ?? 8192,
        system: systemParam as Anthropic.MessageCreateParams["system"],
        tools: [tool],
        tool_choice: { type: "tool", name: toolName },
        messages: [{ role: "user", content: userPrompt }],
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      },
      // withRetry is the single retry layer — disable the SDK's own retries to
      // avoid multiplicative attempts; apply a per-request timeout.
      { maxRetries: 0, ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}) },
    ),
  );

  if (input.onUsage) {
    const usage = res.usage as typeof res.usage & {
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
    try {
      input.onUsage({
        modelId,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      });
    } catch (e) {
      console.warn(
        "[structured] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === toolName,
  );
  if (!block) {
    throw new LLMValidationError(
      "model did not call the required tool",
      res.content,
    );
  }
  const parsed = outputSchema.safeParse(block.input);
  if (!parsed.success) {
    throw new LLMValidationError(
      `tool input failed schema validation: ${parsed.error.message}`,
      block.input,
    );
  }
  return parsed.data;
}

/**
 * Legacy entry point. Always routes through the Anthropic API tool_use path,
 * regardless of LLM_AGENT_BACKEND_MAP. This guarantees no behavioural change
 * for unmigrated callers (plot, canon-extractor, critics/base, style-engine)
 * while migrated agents go through dispatchStructured separately.
 *
 * Phase 6 cleanup may remove this once every caller has migrated.
 */
export async function callStructured<T>(
  opts: StructuredCallOptions<T>,
): Promise<T> {
  const adHocContract: AgentStructuredContract<{ prompt: string }, T> = {
    agentName: opts.agentName,
    getOutputSchema: () => opts.schema,
    systemPrompt: typeof opts.system === "string" ? opts.system : "",
    buildPrompt: (i) => i.prompt,
    defaultMode: "mcp_submit_tool",
    mcp: {
      toolName: opts.schemaName,
      toolDescription: opts.schemaDescription,
    },
  };
  return callViaAnthropicApi(adHocContract, opts.schema, {
    agentName: opts.agentName,
    payload: { prompt: opts.prompt },
    systemBlocks: opts.system,
    model: opts.model,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.cacheableSystem !== undefined
      ? { cacheableSystem: opts.cacheableSystem }
      : {}),
    ...(opts.onUsage !== undefined ? { onUsage: opts.onUsage } : {}),
  });
}

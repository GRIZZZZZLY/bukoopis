import type Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getAnthropicClient } from "./client.js";
import { resolveModelId } from "./models.js";
import { withRetry } from "./retry.js";
import { buildSystemParam, type SystemBlock } from "./stream.js";
import { LLMError, LLMValidationError } from "./errors.js";
import { resolveBackendForCall } from "./router.js";
import type { AgentName } from "./types.js";
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

export async function callStructured<T>(
  opts: StructuredCallOptions<T>,
): Promise<T> {
  // Hard routing rule: any request carrying an outputSchema is forced to api.
  // Provider is fixed to "anthropic" here — structured output is anthropic-only.
  const backend = resolveBackendForCall({
    agentName: opts.agentName,
    provider: "anthropic",
    hasOutputSchema: true,
  });
  if (backend !== "api") {
    throw new LLMError(
      `[invariant] callStructured resolved to backend="${backend}" — outputSchema must force "api"`,
    );
  }

  const client = getAnthropicClient();
  const jsonSchema = zodToJsonSchema(opts.schema, opts.schemaName);
  const inputSchema =
    "definitions" in jsonSchema &&
    jsonSchema.definitions &&
    typeof jsonSchema.definitions === "object" &&
    opts.schemaName in jsonSchema.definitions
      ? (jsonSchema.definitions as Record<string, unknown>)[opts.schemaName]
      : jsonSchema;

  const tool = {
    name: opts.schemaName,
    description: opts.schemaDescription,
    input_schema: inputSchema as Anthropic.Tool["input_schema"],
  } satisfies Anthropic.Tool;

  // Newer Anthropic models (Opus 4.7+) deprecate `temperature`. Pass it only
  // when caller explicitly opts in.
  const modelId = resolveModelId(opts.model);
  const cacheable =
    opts.cacheableSystem ?? process.env.LLM_PROMPT_CACHE !== "0";
  const systemParam = buildSystemParam(opts.system, cacheable);
  const res = await withRetry(() =>
    client.messages.create({
      model: modelId,
      max_tokens: opts.maxTokens ?? 8192,
      system: systemParam as Anthropic.MessageCreateParams["system"],
      tools: [tool],
      tool_choice: { type: "tool", name: opts.schemaName },
      messages: [{ role: "user", content: opts.prompt }],
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    }),
  );

  if (opts.onUsage) {
    const usage = res.usage as typeof res.usage & {
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
    try {
      opts.onUsage({
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
      b.type === "tool_use" && b.name === opts.schemaName,
  );
  if (!block) {
    throw new LLMValidationError(
      "model did not call the required tool",
      res.content,
    );
  }
  const parsed = opts.schema.safeParse(block.input);
  if (!parsed.success) {
    throw new LLMValidationError(
      `tool input failed schema validation: ${parsed.error.message}`,
      block.input,
    );
  }
  return parsed.data;
}

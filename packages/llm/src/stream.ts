import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./client.js";
import { resolveModelId } from "./models.js";
import { withRetry } from "./retry.js";
import { resolveBackendForCall } from "./router.js";
import { getSubscriptionClient } from "./clients/subscription.js";
import type { AgentName } from "./types.js";
import type { ModelChoice } from "@book-forge/shared";

export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export interface StreamCallOptions {
  agentName: AgentName;
  model: ModelChoice;
  system: string | SystemBlock[];
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** When true and `system` is a string, wraps it as a single ephemeral
   * cache_control block. Defaults to env `LLM_PROMPT_CACHE !== "0"`. */
  cacheableSystem?: boolean;
}

export interface StreamCallResult {
  text: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

function cachingEnabled(): boolean {
  return process.env.LLM_PROMPT_CACHE !== "0";
}

export function buildSystemParam(
  system: string | SystemBlock[],
  cacheable: boolean,
): string | SystemBlock[] {
  if (Array.isArray(system)) return system;
  if (!cacheable) return system;
  return [
    { type: "text", text: system, cache_control: { type: "ephemeral" } },
  ];
}

export async function* streamText(
  opts: StreamCallOptions,
): AsyncGenerator<string, StreamCallResult, void> {
  // Anthropic-provider stream path. Ollama goes through streamTextOllama
  // and never reaches this dispatcher.
  const backend = resolveBackendForCall({
    agentName: opts.agentName,
    provider: "anthropic",
    hasOutputSchema: false,
  });

  if (backend === "subscription") {
    // Delegate to Claude Agent SDK adapter (etap 0.2.2).
    const sub = getSubscriptionClient().streamMessages({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
    });
    let final: StreamCallResult | undefined;
    while (true) {
      const next = await sub.next();
      if (next.done) {
        final = next.value;
        break;
      }
      yield next.value;
    }
    if (!final) {
      throw new Error("subscription adapter returned no final result");
    }
    return final;
  }

  const client = getAnthropicClient();
  const modelId = resolveModelId(opts.model);
  const cacheable = opts.cacheableSystem ?? cachingEnabled();
  const systemParam = buildSystemParam(opts.system, cacheable);
  // Opus 4.7+ deprecates the temperature parameter; only pass it when caller
  // explicitly sets it. Retry only applies to stream creation — once chunks
  // start flowing, mid-stream errors require client-side resumption logic
  // that we don't have yet.
  const stream = await withRetry(() =>
    Promise.resolve(
      client.messages.stream(
        {
          model: modelId,
          max_tokens: opts.maxTokens ?? 16384,
          system: systemParam as Anthropic.MessageCreateParams["system"],
          messages: [{ role: "user", content: opts.prompt }],
          ...(opts.temperature !== undefined
            ? { temperature: opts.temperature }
            : {}),
        },
        // withRetry owns retries — disable the SDK's internal ones.
        { maxRetries: 0 },
      ),
    ),
  );

  let full = "";
  for await (const ev of stream) {
    if (
      ev.type === "content_block_delta" &&
      ev.delta.type === "text_delta"
    ) {
      const chunk = ev.delta.text;
      full += chunk;
      yield chunk;
    }
  }

  const final = await stream.finalMessage();
  const usage = final.usage as typeof final.usage & {
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  return {
    text: full,
    modelId,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

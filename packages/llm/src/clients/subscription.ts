import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { LLMAuthError, LLMError, LLMValidationError } from "../errors.js";
import { resolveModelId } from "../models.js";
import type { SystemBlock, StreamCallResult } from "../stream.js";
import type { ModelChoice } from "@book-forge/shared";

// ─────────── Helpers ───────────

function flattenSystem(system: string | SystemBlock[]): string {
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

function isAuthErrorCode(code: string): boolean {
  return (
    code === "authentication_failed" ||
    code === "oauth_org_not_allowed" ||
    code === "billing_error"
  );
}

function mapAssistantError(code: string, modelId: string): LLMError {
  if (isAuthErrorCode(code)) {
    return new LLMAuthError(
      `[subscription/${modelId}] auth/billing failure: ${code}. Check 'claude login' state.`,
    );
  }
  if (code === "rate_limit") {
    return new LLMError(`[subscription/${modelId}] rate_limit`);
  }
  return new LLMError(`[subscription/${modelId}] ${code}`);
}

interface BuiltOptions {
  options: Options;
  modelId: string;
}

function buildOptions(
  model: ModelChoice,
  system: string | SystemBlock[],
  partial: boolean,
  signal?: AbortSignal,
): BuiltOptions {
  const modelId = resolveModelId(model);
  const sys = flattenSystem(system);
  const opts: Options = {
    model: modelId,
    systemPrompt: sys,
    // Disable all built-in Claude Code tools — we want pure text generation,
    // not file access / bash / etc. With tools=[], no permission prompts can
    // arise.
    tools: [],
    // includePartialMessages emits content_block_delta stream events so we
    // can yield text chunks in real time.
    includePartialMessages: partial,
    // Single-turn: caller provides full prompt as a string, we expect one
    // assistant turn back.
    maxTurns: 1,
  };
  if (signal) opts.abortController = abortControllerFromSignal(signal);
  return { options: opts, modelId };
}

function abortControllerFromSignal(signal: AbortSignal): AbortController {
  const c = new AbortController();
  if (signal.aborted) c.abort(signal.reason);
  else signal.addEventListener("abort", () => c.abort(signal.reason), { once: true });
  return c;
}

interface FinalUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
}

function extractUsage(msg: SDKMessage & { type: "result" }): FinalUsage {
  // SDK exposes BetaUsage on result.usage. Cache fields are optional and
  // only populated when prompt-cache hit/miss is reported by upstream.
  const u = (msg as { usage?: Record<string, unknown> }).usage ?? {};
  const num = (key: string): number => {
    const v = u[key];
    return typeof v === "number" ? v : 0;
  };
  return {
    inputTokens: num("input_tokens"),
    outputTokens: num("output_tokens"),
    cacheCreation: num("cache_creation_input_tokens"),
    cacheRead: num("cache_read_input_tokens"),
  };
}

// ─────────── Public types ───────────

export interface SubscriptionStreamInput {
  model: ModelChoice;
  system: string | SystemBlock[];
  prompt: string;
  signal?: AbortSignal;
}

export interface SubscriptionCreateInput {
  model: ModelChoice;
  system: string | SystemBlock[];
  prompt: string;
  signal?: AbortSignal;
}

export interface SubscriptionCreateResult {
  text: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface SubscriptionStructuredInput {
  model: ModelChoice;
  system: string | SystemBlock[];
  prompt: string;
  schemaName: string;
  schemaDescription: string;
  signal?: AbortSignal;
}

export interface SubscriptionStructuredResult {
  raw: unknown;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

// ─────────── Client ───────────

export class SubscriptionBackendClient {
  /**
   * Streaming text generation via Claude Agent SDK using the user's logged-in
   * Claude (Pro/Max) credentials. Yields text chunks; returns final usage.
   *
   * Throws LLMAuthError on auth/billing failure, LLMError on rate-limit /
   * server / unknown errors. No fallback to api — the caller decides.
   */
  async *streamMessages(
    input: SubscriptionStreamInput,
  ): AsyncGenerator<string, StreamCallResult, void> {
    const { options, modelId } = buildOptions(
      input.model,
      input.system,
      true,
      input.signal,
    );

    const q = query({ prompt: input.prompt, options });

    let full = "";
    let final: FinalUsage | null = null;

    for await (const msg of q) {
      if (msg.type === "stream_event") {
        const ev = (msg as { event?: { type?: string; delta?: { type?: string; text?: string } } }).event;
        if (
          ev?.type === "content_block_delta" &&
          ev.delta?.type === "text_delta" &&
          typeof ev.delta.text === "string"
        ) {
          full += ev.delta.text;
          yield ev.delta.text;
        }
        continue;
      }
      if (msg.type === "assistant") {
        const errCode = (msg as { error?: string }).error;
        if (errCode) throw mapAssistantError(errCode, modelId);
        // Otherwise: full assistant message — content already delivered via
        // stream_event chunks above. Skip.
        continue;
      }
      if (msg.type === "result") {
        const subtype = (msg as { subtype?: string }).subtype;
        if (subtype === "error") {
          const status = (msg as { api_error_status?: number | null })
            .api_error_status;
          throw new LLMError(
            `[subscription/${modelId}] result error${status != null ? ` (status ${status})` : ""}`,
          );
        }
        final = extractUsage(msg as SDKMessage & { type: "result" });
      }
    }

    if (!final) {
      throw new LLMError(
        `[subscription/${modelId}] stream closed without result message`,
      );
    }

    return {
      text: full,
      // Prefix `subscription:` so pricing module recognises this as
      // zero-cost (matches the same convention as `ollama:`/`local:`).
      modelId: `subscription:${modelId}`,
      inputTokens: final.inputTokens,
      outputTokens: final.outputTokens,
      cacheCreationInputTokens: final.cacheCreation,
      cacheReadInputTokens: final.cacheRead,
    };
  }

  /**
   * Non-streaming text generation. Equivalent to streamMessages collected to
   * a single string + usage. Same error semantics.
   */
  async createMessage(
    input: SubscriptionCreateInput,
  ): Promise<SubscriptionCreateResult> {
    const { options, modelId } = buildOptions(
      input.model,
      input.system,
      false,
      input.signal,
    );
    const q = query({ prompt: input.prompt, options });

    let text = "";
    let final: FinalUsage | null = null;

    for await (const msg of q) {
      if (msg.type === "assistant") {
        const errCode = (msg as { error?: string }).error;
        if (errCode) throw mapAssistantError(errCode, modelId);
        const content = (msg as { message?: { content?: Array<{ type?: string; text?: string }> } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === "text" && typeof block.text === "string") {
              text += block.text;
            }
          }
        }
        continue;
      }
      if (msg.type === "result") {
        const subtype = (msg as { subtype?: string }).subtype;
        if (subtype === "error") {
          const status = (msg as { api_error_status?: number | null })
            .api_error_status;
          throw new LLMError(
            `[subscription/${modelId}] result error${status != null ? ` (status ${status})` : ""}`,
          );
        }
        // SDKResultSuccess.result carries the final assistant text — prefer
        // it when present (matches what the SDK considers the canonical output).
        const result = (msg as { result?: string }).result;
        if (typeof result === "string" && result.length > 0) text = result;
        final = extractUsage(msg as SDKMessage & { type: "result" });
      }
    }

    if (!final) {
      throw new LLMError(
        `[subscription/${modelId}] stream closed without result message`,
      );
    }

    return {
      text,
      modelId: `subscription:${modelId}`,
      inputTokens: final.inputTokens,
      outputTokens: final.outputTokens,
      cacheCreationInputTokens: final.cacheCreation,
      cacheReadInputTokens: final.cacheRead,
    };
  }

  /**
   * Structured output via prompted JSON. The SDK does not expose a
   * tool_choice equivalent, so we instruct the model to respond with exactly
   * one JSON document matching the schema, then parse the assistant text.
   *
   * NOTE: the LLM router's hard rule routes any request carrying an
   * outputSchema to backend="api". This method exists for parity / direct
   * use; it is not reachable through the normal router flow today.
   */
  async callStructured(
    input: SubscriptionStructuredInput,
  ): Promise<SubscriptionStructuredResult> {
    const sys = flattenSystem(input.system);
    const reinforcedSystem = `${sys}\n\n---\n\nReturn EXACTLY one JSON object matching the schema "${input.schemaName}" (${input.schemaDescription}). No prose, no markdown fences, no commentary — only the JSON.`;
    const result = await this.createMessage({
      model: input.model,
      system: reinforcedSystem,
      prompt: input.prompt,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });

    const stripped = stripJsonFences(result.text).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (e) {
      throw new LLMValidationError(
        `[subscription/${result.modelId}] JSON.parse failed for ${input.schemaName}: ${e instanceof Error ? e.message : String(e)}`,
        result.text,
      );
    }
    return {
      raw: parsed,
      modelId: result.modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  }
}

function stripJsonFences(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced && typeof fenced[1] === "string") return fenced[1];
  return trimmed;
}

let cached: SubscriptionBackendClient | null = null;

export function getSubscriptionClient(): SubscriptionBackendClient {
  if (!cached) cached = new SubscriptionBackendClient();
  return cached;
}

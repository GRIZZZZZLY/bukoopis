import type {
  StreamCallOptions,
  StreamCallResult,
  SystemBlock,
} from "./stream.js";

/**
 * Ollama (or any OpenAI-compatible local LLM exposing /api/chat) provider.
 *
 * Usage parity with the Anthropic streamText:
 *   - Yields text chunks
 *   - Returns final message + usage at the end
 *
 * Cost is always reported as 0 — the caller decides what to log.
 */

export interface OllamaStreamOptions extends StreamCallOptions {
  /** Local model tag, e.g. "qwen2.5:14b-instruct", "gemma3:27b". Required. */
  modelTag: string;
  /** Defaults to env OLLAMA_BASE_URL or http://127.0.0.1:11434. */
  baseUrl?: string;
}

interface OllamaChatStreamEvent {
  model?: string;
  message?: { role: string; content: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

function flattenSystem(system: string | SystemBlock[]): string {
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

function resolveBaseUrl(opt?: string): string {
  return (
    opt ??
    process.env.OLLAMA_BASE_URL ??
    "http://127.0.0.1:11434"
  ).replace(/\/+$/, "");
}

export async function* streamTextOllama(
  opts: OllamaStreamOptions,
): AsyncGenerator<string, StreamCallResult, void> {
  const url = `${resolveBaseUrl(opts.baseUrl)}/api/chat`;
  const sys = flattenSystem(opts.system);

  const body = {
    model: opts.modelTag,
    stream: true,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: opts.prompt },
    ],
    options: {
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { num_predict: opts.maxTokens } : {}),
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `ollama unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`ollama HTTP ${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let ev: OllamaChatStreamEvent;
      try {
        ev = JSON.parse(line) as OllamaChatStreamEvent;
      } catch {
        continue;
      }
      const chunk = ev.message?.content;
      if (chunk) {
        full += chunk;
        yield chunk;
      }
      if (ev.done) {
        inputTokens = ev.prompt_eval_count ?? 0;
        outputTokens = ev.eval_count ?? 0;
      }
    }
  }

  return {
    text: full,
    modelId: `ollama:${opts.modelTag}`,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

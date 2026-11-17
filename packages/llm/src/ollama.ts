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
    // Ollama /api/chat причину остановки не отдаёт. Врать «end_turn» нельзя:
    // тогда обрубок по лимиту вывода стал бы «готовой главой».
    stopReason: null,
  };
}

export interface OllamaGenerateOptions {
  modelTag: string;
  prompt: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

interface OllamaGenerateEvent {
  response?: string;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Сырой /api/generate (raw: true) для нашей дообученной pretrain-модели:
 * промпт уходит как есть, без чат-обёртки. Сэмплинг живёт в Modelfile,
 * поэтому `options` не отправляем. Отмена (signal) бросает AbortError из fetch.
 */
export async function* streamGenerateOllama(
  opts: OllamaGenerateOptions,
): AsyncGenerator<string, StreamCallResult, void> {
  const url = `${resolveBaseUrl(opts.baseUrl)}/api/generate`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.modelTag,
        prompt: opts.prompt,
        raw: true,
        stream: true,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    throw new Error(
      `ollama unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
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
  let doneReason: string | undefined;

  // Возвращает чанк текста из строки NDJSON (или "").
  const handle = (raw: string): string => {
    const line = raw.trim();
    if (!line) return "";
    let ev: OllamaGenerateEvent;
    try {
      ev = JSON.parse(line) as OllamaGenerateEvent;
    } catch {
      return "";
    }
    if (ev.done) {
      inputTokens = ev.prompt_eval_count ?? 0;
      outputTokens = ev.eval_count ?? 0;
      doneReason = ev.done_reason;
    }
    return ev.response ?? "";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const chunk = handle(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (chunk) {
        full += chunk;
        yield chunk;
      }
    }
  }
  const last = handle(buffer);
  if (last) {
    full += last;
    yield last;
  }

  return {
    text: full,
    modelId: `ollama:${opts.modelTag}`,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    stopReason:
      doneReason === "stop" ? "end_turn" : doneReason === "length" ? "max_tokens" : null,
  };
}

const rawTemplateCache = new Map<string, boolean>();

export function resetRawTemplateCache(): void {
  rawTemplateCache.clear();
}

/**
 * Наша модель зарегистрирована с `TEMPLATE {{ .Prompt }}`. Узнаём это по
 * /api/show; сбой запроса — «не наша» и не кешируется.
 */
export async function isRawTemplateModel(tag: string, baseUrl?: string): Promise<boolean> {
  const base = resolveBaseUrl(baseUrl);
  const key = `${base}|${tag}`;
  const hit = rawTemplateCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const res = await fetch(`${base}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: tag }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { template?: unknown };
    const raw = typeof json.template === "string" && json.template.trim() === "{{ .Prompt }}";
    rawTemplateCache.set(key, raw);
    return raw;
  } catch {
    return false;
  }
}

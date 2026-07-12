import pRetry, { AbortError } from "p-retry";
import {
  LLMAuthError,
  LLMValidationError,
  LLMNoToolCallError,
  LLMMultipleToolCallsError,
  LLMSchemaRetryExhaustedError,
} from "./errors.js";

export interface RetryOptions {
  retries?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
  /** Override the default (status-based) retryability decision. */
  isRetryable?: (err: unknown) => boolean;
}

// Anthropic SDK error shape (we only need .status — rest is opaque).
interface MaybeStatusError {
  status?: number;
  message?: string;
}

function shouldRetry(err: unknown): boolean {
  const e = err as MaybeStatusError;
  if (typeof e?.status !== "number") {
    // Network errors with no status — assume transient, retry.
    return true;
  }
  if (e.status === 429) return true;
  if (e.status >= 500 && e.status < 600) return true;
  return false;
}

/** Terminal LLM failures a blind retry cannot fix (auth, schema/tool-call
 *  contract violations). Everything else — rate_limit, 5xx, timeouts, network
 *  — is transient. Used for the subscription backend, whose errors surface as
 *  LLM error classes without a numeric `.status`. */
export function isTransientLlmError(err: unknown): boolean {
  if (
    err instanceof LLMAuthError ||
    err instanceof LLMValidationError ||
    err instanceof LLMNoToolCallError ||
    err instanceof LLMMultipleToolCallsError ||
    err instanceof LLMSchemaRetryExhaustedError
  ) {
    return false;
  }
  return shouldRetry(err);
}

/** Per-call LLM timeout (ms) from LLM_TIMEOUT_MS; 0 disables. Default 120s. */
export function llmTimeoutMs(): number {
  const raw = process.env.LLM_TIMEOUT_MS;
  if (raw === undefined) return 120_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 120_000;
}

// Wrap an LLM call so it retries on 429/5xx/network errors with exponential
// backoff. 4xx (auth, validation) is surfaced immediately via AbortError.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const minTimeout = opts.minTimeoutMs ?? 500;
  const maxTimeout = opts.maxTimeoutMs ?? 5000;
  const retryable = opts.isRetryable ?? shouldRetry;

  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (err) {
        if (!retryable(err)) {
          // p-retry treats AbortError as terminal — stop retrying immediately.
          throw new AbortError(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
        throw err;
      }
    },
    {
      retries,
      minTimeout,
      maxTimeout,
      factor: 2,
      randomize: true,
    },
  );
}

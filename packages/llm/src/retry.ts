import pRetry, { AbortError } from "p-retry";

export interface RetryOptions {
  retries?: number;
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
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

// Wrap an LLM call so it retries on 429/5xx/network errors with exponential
// backoff. 4xx (auth, validation) is surfaced immediately via AbortError.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const minTimeout = opts.minTimeoutMs ?? 500;
  const maxTimeout = opts.maxTimeoutMs ?? 5000;

  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (err) {
        if (!shouldRetry(err)) {
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

import { describe, it, expect, afterEach } from "vitest";
import { withRetry, isTransientLlmError, llmTimeoutMs } from "../retry.js";
import {
  LLMError,
  LLMAuthError,
  LLMValidationError,
  LLMNoToolCallError,
  LLMMultipleToolCallsError,
  LLMTimeoutError,
} from "../errors.js";

describe("isTransientLlmError", () => {
  it("treats auth / schema / tool-call contract errors as terminal", () => {
    expect(isTransientLlmError(new LLMAuthError("nope"))).toBe(false);
    expect(isTransientLlmError(new LLMValidationError("bad", undefined))).toBe(false);
    expect(isTransientLlmError(new LLMNoToolCallError("none"))).toBe(false);
    expect(isTransientLlmError(new LLMMultipleToolCallsError("two"))).toBe(false);
  });

  /** Живой прогон 2026-09-20: таймаут считался временной ошибкой, и вызов
   *  повторялся четыре раза подряд. При пределе в 10 минут это 40 минут
   *  тишины — и ни строчки в логе, потому что об ошибке узнают только после
   *  последней попытки. Повтор того же запроса с тем же пределом даёт тот же
   *  результат: это не «временно», это «не влезает». */
  it("не повторяет вызов, оборванный по нашему же таймауту", () => {
    expect(isTransientLlmError(new LLMTimeoutError("не уложился в 120000 мс"))).toBe(false);
  });

  it("treats rate-limit / generic subscription errors and network errors as transient", () => {
    expect(isTransientLlmError(new LLMError("rate_limit"))).toBe(true);
    expect(isTransientLlmError(new Error("socket hang up"))).toBe(true); // no status
  });

  it("honors numeric HTTP status: retry 429/5xx, not other 4xx", () => {
    expect(isTransientLlmError({ status: 429 })).toBe(true);
    expect(isTransientLlmError({ status: 503 })).toBe(true);
    expect(isTransientLlmError({ status: 400 })).toBe(false);
    expect(isTransientLlmError({ status: 401 })).toBe(false);
  });
});

describe("llmTimeoutMs", () => {
  const orig = process.env.LLM_TIMEOUT_MS;
  afterEach(() => {
    if (orig === undefined) delete process.env.LLM_TIMEOUT_MS;
    else process.env.LLM_TIMEOUT_MS = orig;
  });
  it("defaults to 120s and parses env, 0 disables", () => {
    delete process.env.LLM_TIMEOUT_MS;
    expect(llmTimeoutMs()).toBe(120_000);
    process.env.LLM_TIMEOUT_MS = "5000";
    expect(llmTimeoutMs()).toBe(5000);
    process.env.LLM_TIMEOUT_MS = "0";
    expect(llmTimeoutMs()).toBe(0);
    process.env.LLM_TIMEOUT_MS = "garbage";
    expect(llmTimeoutMs()).toBe(120_000);
  });
});

describe("withRetry", () => {
  const fast = { minTimeoutMs: 1, maxTimeoutMs: 5 } as const;

  it("does NOT retry a terminal subscription error (the closed gap)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new LLMAuthError("auth/billing failure");
        },
        { ...fast, retries: 3, isRetryable: isTransientLlmError },
      ),
    ).rejects.toBeInstanceOf(LLMAuthError);
    expect(calls).toBe(1);
  });

  it("retries a transient error then succeeds", async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new LLMError("rate_limit");
        return "ok";
      },
      { ...fast, retries: 5, isRetryable: isTransientLlmError },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("default (status-based) predicate still retries network errors", async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("ECONNRESET");
        return 42;
      },
      { ...fast, retries: 3 },
    );
    expect(out).toBe(42);
    expect(calls).toBe(2);
  });
});

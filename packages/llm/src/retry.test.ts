import { describe, it, expect } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns value on first success", async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls === 1) {
          const e: Error & { status?: number } = new Error("rate limit");
          e.status = 429;
          throw e;
        }
        return "ok";
      },
      { minTimeoutMs: 1, maxTimeoutMs: 5 },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries on 500 up to 3 times then surfaces error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          const e: Error & { status?: number } = new Error("server");
          e.status = 503;
          throw e;
        },
        { retries: 3, minTimeoutMs: 1, maxTimeoutMs: 5 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(4); // initial + 3 retries
  });

  it("does NOT retry on 400", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          const e: Error & { status?: number } = new Error("bad");
          e.status = 400;
          throw e;
        },
        { minTimeoutMs: 1, maxTimeoutMs: 5 },
      ),
    ).rejects.toThrow("bad");
    expect(calls).toBe(1);
  });

  it("does NOT retry on 401", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          const e: Error & { status?: number } = new Error("auth");
          e.status = 401;
          throw e;
        },
        { minTimeoutMs: 1, maxTimeoutMs: 5 },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("retries on errors without status (network)", async () => {
    let calls = 0;
    const r = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error("ECONNRESET");
        return "ok";
      },
      { minTimeoutMs: 1, maxTimeoutMs: 5 },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(2);
  });
});

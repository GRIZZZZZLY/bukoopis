import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level queue: each test pushes one factory that returns the
// AsyncIterable<SDKMessage> the mocked `query()` will surface.
const queryQueue: Array<() => AsyncIterable<unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    const factory = queryQueue.shift();
    if (!factory) throw new Error("test: no fake response queued");
    return factory();
  }),
}));

import { SubscriptionBackendClient } from "../clients/subscription.js";
import { LLMAuthError, LLMError, LLMValidationError } from "../errors.js";

function asyncGen<T>(items: T[]): AsyncIterable<T> {
  return (async function* () {
    for (const it of items) yield it;
  })();
}

beforeEach(() => {
  queryQueue.length = 0;
});

describe("SubscriptionBackendClient.streamMessages", () => {
  it("yields text deltas from stream_event and returns final usage", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Hello " },
          },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "world" },
          },
        },
        {
          type: "result",
          subtype: "success",
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_creation_input_tokens: 4,
            cache_read_input_tokens: 1,
          },
          result: "Hello world",
        },
      ]),
    );

    const c = new SubscriptionBackendClient();
    const gen = c.streamMessages({ model: "sonnet", system: "S", prompt: "P" });
    const out: string[] = [];
    let final: Awaited<ReturnType<typeof c.streamMessages>> extends AsyncGenerator<
      unknown,
      infer R
    >
      ? R
      : never;
    while (true) {
      const n = await gen.next();
      if (n.done) {
        final = n.value as typeof final;
        break;
      }
      out.push(n.value);
    }
    expect(out).toEqual(["Hello ", "world"]);
    expect(final.text).toBe("Hello world");
    expect(final.modelId).toBe("subscription:claude-sonnet-4-6");
    expect(final.inputTokens).toBe(10);
    expect(final.outputTokens).toBe(2);
    expect(final.cacheCreationInputTokens).toBe(4);
    expect(final.cacheReadInputTokens).toBe(1);
  });

  it("throws LLMAuthError on assistant error=authentication_failed", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          error: "authentication_failed",
          message: { content: [] },
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    const gen = c.streamMessages({ model: "sonnet", system: "S", prompt: "P" });
    let caught: unknown = null;
    try {
      await gen.next();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LLMAuthError);
    expect((caught as Error).message).toContain("authentication_failed");
  });

  it("throws LLMAuthError on assistant error=billing_error", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          error: "billing_error",
          message: { content: [] },
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    const gen = c.streamMessages({ model: "sonnet", system: "S", prompt: "P" });
    let caught: unknown = null;
    try {
      await gen.next();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LLMAuthError);
  });

  it("throws plain LLMError on assistant error=rate_limit", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          error: "rate_limit",
          message: { content: [] },
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    const gen = c.streamMessages({ model: "sonnet", system: "S", prompt: "P" });
    let caught: unknown = null;
    try {
      await gen.next();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LLMError);
    expect(caught).not.toBeInstanceOf(LLMAuthError);
  });

  it("throws LLMError on result subtype=error", async () => {
    queryQueue.push(() =>
      asyncGen([{ type: "result", subtype: "error", api_error_status: 503 }]),
    );
    const c = new SubscriptionBackendClient();
    const gen = c.streamMessages({ model: "sonnet", system: "S", prompt: "P" });
    let caught: unknown = null;
    try {
      while (true) {
        const n = await gen.next();
        if (n.done) break;
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LLMError);
    expect((caught as Error).message).toContain("503");
  });

  it("throws LLMError when stream closes without result", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "fragment" },
          },
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    const gen = c.streamMessages({ model: "sonnet", system: "S", prompt: "P" });
    let caught: unknown = null;
    try {
      while (true) {
        const n = await gen.next();
        if (n.done) break;
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LLMError);
    expect((caught as Error).message).toContain("without result");
  });
});

describe("SubscriptionBackendClient.createMessage", () => {
  it("collects assistant text and maps usage", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "answer" }] },
        },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 5, output_tokens: 3 },
          result: "answer",
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    const out = await c.createMessage({
      model: "opus",
      system: "S",
      prompt: "P",
    });
    expect(out.text).toBe("answer");
    expect(out.modelId).toBe("subscription:claude-opus-4-7");
    expect(out.inputTokens).toBe(5);
    expect(out.outputTokens).toBe(3);
  });

  it("throws LLMAuthError on billing_error", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          error: "billing_error",
          message: { content: [] },
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    await expect(
      c.createMessage({ model: "sonnet", system: "S", prompt: "P" }),
    ).rejects.toBeInstanceOf(LLMAuthError);
  });
});

describe("SubscriptionBackendClient.callStructured", () => {
  it("parses bare JSON response", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: '{"a":1}' }] },
        },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 6, output_tokens: 4 },
          result: '{"a":1}',
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    const out = await c.callStructured({
      model: "sonnet",
      system: "S",
      prompt: "P",
      schemaName: "x",
      schemaDescription: "test",
    });
    expect(out.raw).toEqual({ a: 1 });
    expect(out.modelId).toBe("subscription:claude-sonnet-4-6");
  });

  it("strips ```json fences before parsing", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          message: {
            content: [{ type: "text", text: '```json\n{"k":2}\n```' }],
          },
        },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 1, output_tokens: 1 },
          result: '```json\n{"k":2}\n```',
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    const out = await c.callStructured({
      model: "sonnet",
      system: "S",
      prompt: "P",
      schemaName: "x",
      schemaDescription: "",
    });
    expect(out.raw).toEqual({ k: 2 });
  });

  it("throws LLMValidationError on unparseable text", async () => {
    queryQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          message: { content: [{ type: "text", text: "not json" }] },
        },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 1, output_tokens: 1 },
          result: "not json",
        },
      ]),
    );
    const c = new SubscriptionBackendClient();
    await expect(
      c.callStructured({
        model: "sonnet",
        system: "S",
        prompt: "P",
        schemaName: "x",
        schemaDescription: "",
      }),
    ).rejects.toBeInstanceOf(LLMValidationError);
  });
});

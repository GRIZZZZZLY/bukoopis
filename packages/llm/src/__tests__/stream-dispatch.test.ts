import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Module-level queue: each subscription-routed test pushes one factory.
const subscriptionQueue: Array<() => AsyncIterable<unknown>> = [];

// Mock Claude Agent SDK BEFORE importing stream.ts.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    const factory = subscriptionQueue.shift();
    if (!factory) throw new Error("test: no subscription response queued");
    return factory();
  }),
}));

// Mock the Anthropic API client BEFORE importing stream.ts.
vi.mock("../client.js", () => {
  const streamMock = vi.fn(() => {
    async function* events() {
      // No content events — verifies dispatch reached this path.
    }
    const it = events();
    return Object.assign(it, {
      finalMessage: vi.fn(async () => ({
        usage: { input_tokens: 0, output_tokens: 0 },
      })),
    });
  });
  return {
    getAnthropicClient: vi.fn(() => ({
      messages: { stream: streamMock },
    })),
    __streamMock: streamMock,
  };
});

import { streamText } from "../stream.js";
import * as clientMod from "../client.js";

function asyncGen<T>(items: T[]): AsyncIterable<T> {
  return (async function* () {
    for (const it of items) yield it;
  })();
}

function getApiClientCallCount(): number {
  return (
    clientMod as unknown as {
      getAnthropicClient: { mock: { calls: unknown[] } };
    }
  ).getAnthropicClient.mock.calls.length;
}

describe("streamText backend dispatch", () => {
  beforeEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
    vi.clearAllMocks();
    subscriptionQueue.length = 0;
  });
  afterEach(() => {
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });

  it("agentName='writer' (subscription default) routes to Claude Agent SDK adapter and yields chunks", async () => {
    subscriptionQueue.push(() =>
      asyncGen([
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "subscription-chunk" },
          },
        },
        {
          type: "result",
          subtype: "success",
          usage: { input_tokens: 7, output_tokens: 2 },
          result: "subscription-chunk",
        },
      ]),
    );

    const gen = streamText({
      agentName: "writer",
      model: "sonnet",
      system: "x",
      prompt: "y",
    });
    const chunks: string[] = [];
    let final: { text: string; modelId: string } | undefined;
    while (true) {
      const n = await gen.next();
      if (n.done) {
        final = n.value as typeof final;
        break;
      }
      chunks.push(n.value);
    }
    expect(chunks).toEqual(["subscription-chunk"]);
    expect(final?.text).toBe("subscription-chunk");
    expect(final?.modelId).toBe("subscription:claude-sonnet-4-6");
    // Anthropic API client must NOT be touched on subscription path.
    expect(getApiClientCallCount()).toBe(0);
  });

  it("agentName='plot' (api default) routes to ApiBackendClient", async () => {
    const gen = streamText({
      agentName: "plot_outline",
      model: "sonnet",
      system: "x",
      prompt: "y",
    });
    const step = await gen.next();
    expect(step.done).toBe(true);
    expect(step.value).toEqual(
      expect.objectContaining({
        text: "",
        modelId: expect.any(String),
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
    expect(getApiClientCallCount()).toBeGreaterThan(0);
  });

  it("env override LLM_AGENT_BACKEND_MAP={writer:'api'} flips writer to api", async () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "api" });
    const gen = streamText({
      agentName: "writer",
      model: "sonnet",
      system: "x",
      prompt: "y",
    });
    const step = await gen.next();
    expect(step.done).toBe(true);
    expect(step.value).toBeDefined();
    expect(getApiClientCallCount()).toBeGreaterThan(0);
  });

  it("subscription auth error surfaces as LLMAuthError through streamText", async () => {
    subscriptionQueue.push(() =>
      asyncGen([
        {
          type: "assistant",
          error: "authentication_failed",
          message: { content: [] },
        },
      ]),
    );

    const gen = streamText({
      agentName: "writer",
      model: "sonnet",
      system: "x",
      prompt: "y",
    });
    let caught: unknown = null;
    try {
      while (true) {
        const n = await gen.next();
        if (n.done) break;
      }
    } catch (e) {
      caught = e;
    }
    const { LLMAuthError } = await import("../errors.js");
    expect(caught).toBeInstanceOf(LLMAuthError);
  });
});

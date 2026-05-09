import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock subscription client at module boundary.
const subscriptionStreamMock = vi.fn();
vi.mock("../clients/subscription.js", () => ({
  getSubscriptionClient: () => ({
    streamMessages: subscriptionStreamMock,
  }),
}));

// Mock callStructured at module boundary so hybrid's extract pass returns
// whatever the test queues.
const callStructuredMock = vi.fn();
vi.mock("../structured.js", () => ({
  callStructured: (...args: unknown[]) => callStructuredMock(...args),
}));

import { generateThenStructure } from "../hybrid.js";

function asyncStream<T, R>(items: T[], finalValue: R): AsyncGenerator<T, R, void> {
  return (async function* () {
    for (const it of items) yield it;
    return finalValue;
  })();
}

beforeEach(() => {
  subscriptionStreamMock.mockReset();
  callStructuredMock.mockReset();
});

const schema = z.object({ kind: z.string(), n: z.number() });

describe("generateThenStructure", () => {
  it("pipes subscription prose into api extraction and returns parsed object", async () => {
    subscriptionStreamMock.mockReturnValueOnce(
      asyncStream(["alpha ", "beta"], {
        text: "alpha beta",
        modelId: "subscription:claude-opus-4-7",
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    );
    callStructuredMock.mockResolvedValueOnce({ kind: "ok", n: 7 });

    const out = await generateThenStructure({
      agentName: "plot",
      textModel: "opus",
      textSystem: "S1",
      textPrompt: "P1",
      extractSystem: "S2",
      extractPrompt: (prose) => `Текст: ${prose}`,
      extractSchema: schema,
      extractSchemaName: "submit_x",
      extractSchemaDescription: "test",
    });

    expect(out).toEqual({ kind: "ok", n: 7 });

    // Verify subscription was called with text-pass options
    expect(subscriptionStreamMock).toHaveBeenCalledOnce();
    expect(subscriptionStreamMock.mock.calls[0]?.[0]).toMatchObject({
      model: "opus",
      system: "S1",
      prompt: "P1",
    });

    // Verify extract pass got the prose
    expect(callStructuredMock).toHaveBeenCalledOnce();
    const extractArgs = callStructuredMock.mock.calls[0]?.[0] as {
      agentName: string;
      model: string;
      prompt: string;
      schemaName: string;
    };
    expect(extractArgs.agentName).toBe("plot");
    expect(extractArgs.model).toBe("sonnet");
    expect(extractArgs.prompt).toBe("Текст: alpha beta");
    expect(extractArgs.schemaName).toBe("submit_x");
  });

  it("emits two onUsage events: generate (subscription) + extract (api)", async () => {
    subscriptionStreamMock.mockReturnValueOnce(
      asyncStream([], {
        text: "",
        modelId: "subscription:claude-opus-4-7",
        inputTokens: 200,
        outputTokens: 80,
        cacheCreationInputTokens: 5,
        cacheReadInputTokens: 1,
      }),
    );
    callStructuredMock.mockImplementationOnce(async (opts: { onUsage?: (u: unknown) => void }) => {
      opts.onUsage?.({
        modelId: "claude-sonnet-4-6",
        inputTokens: 30,
        outputTokens: 12,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      });
      return { kind: "ok", n: 1 };
    });

    const events: Array<{ stage: string; modelId: string; inputTokens: number; outputTokens: number }> = [];
    await generateThenStructure({
      agentName: "plot",
      textModel: "opus",
      textSystem: "s",
      textPrompt: "p",
      extractSystem: "es",
      extractPrompt: () => "ep",
      extractSchema: schema,
      extractSchemaName: "x",
      extractSchemaDescription: "y",
      onUsage: (e) => events.push(e),
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      stage: "generate",
      modelId: "subscription:claude-opus-4-7",
      inputTokens: 200,
      outputTokens: 80,
    });
    expect(events[1]).toMatchObject({
      stage: "extract",
      modelId: "claude-sonnet-4-6",
      inputTokens: 30,
      outputTokens: 12,
    });
  });

  it("propagates subscription error without invoking extract pass", async () => {
    subscriptionStreamMock.mockReturnValueOnce(
      (async function* () {
        throw new Error("subscription auth failed");
        // eslint-disable-next-line no-unreachable
        yield "x";
      })(),
    );

    await expect(
      generateThenStructure({
        agentName: "plot",
        textModel: "opus",
        textSystem: "s",
        textPrompt: "p",
        extractSystem: "es",
        extractPrompt: () => "ep",
        extractSchema: schema,
        extractSchemaName: "x",
        extractSchemaDescription: "y",
      }),
    ).rejects.toThrow("subscription auth failed");

    expect(callStructuredMock).not.toHaveBeenCalled();
  });

  it("uses default extract model 'sonnet' when not specified", async () => {
    subscriptionStreamMock.mockReturnValueOnce(
      asyncStream([], {
        text: "",
        modelId: "subscription:claude-opus-4-7",
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    );
    callStructuredMock.mockResolvedValueOnce({ kind: "x", n: 0 });

    await generateThenStructure({
      agentName: "plot",
      textModel: "opus",
      textSystem: "s",
      textPrompt: "p",
      extractSystem: "es",
      extractPrompt: () => "ep",
      extractSchema: schema,
      extractSchemaName: "x",
      extractSchemaDescription: "y",
    });

    const extractArgs = callStructuredMock.mock.calls[0]?.[0] as { model: string };
    expect(extractArgs.model).toBe("sonnet");
  });
});

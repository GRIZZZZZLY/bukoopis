import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

vi.mock("../clients/mcp-submit-tool.js", () => ({
  callViaSdkMcpSubmitTool: vi.fn(),
}));

vi.mock("../structured.js", async () => {
  const actual = await vi.importActual<typeof import("../structured.js")>(
    "../structured.js",
  );
  return {
    ...actual,
    callViaAnthropicApi: vi.fn(),
  };
});

import { dispatchStructured } from "../dispatcher.js";
import {
  clearStructuredRegistry,
  registerAgentContract,
} from "../structured-registry.js";
import { callViaSdkMcpSubmitTool } from "../clients/mcp-submit-tool.js";
import { callViaAnthropicApi } from "../structured.js";
import type { AgentStructuredContract } from "../types.js";

const sampleSchema = z.object({ value: z.number() });

const sampleContract: AgentStructuredContract<{ q: string }, z.infer<typeof sampleSchema>> = {
  agentName: "critic_canon",
  getOutputSchema: () => sampleSchema,
  systemPrompt: "system",
  buildPrompt: (i) => i.q,
  defaultMode: "mcp_submit_tool",
  mcp: { toolName: "submit_test", toolDescription: "test" },
};

beforeEach(() => {
  clearStructuredRegistry();
  registerAgentContract(sampleContract);
  vi.clearAllMocks();
  delete process.env.LLM_AGENT_BACKEND_MAP;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP;
});

afterEach(() => {
  delete process.env.LLM_AGENT_BACKEND_MAP;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP;
});

describe("dispatchStructured", () => {
  it("subscription default routes to callViaSdkMcpSubmitTool", async () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_canon: "subscription" });
    vi.mocked(callViaSdkMcpSubmitTool).mockResolvedValue({
      raw: { value: 7 },
      diagnostics: {
        modelId: "subscription:opaque",
        toolCallCount: 1,
        resultSubtype: "success",
        isError: false,
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 30000,
        cacheReadInputTokens: 30000,
      },
    });
    const r = await dispatchStructured<{ q: string }, z.infer<typeof sampleSchema>>({
      agentName: "critic_canon",
      payload: { q: "x" },
      model: "sonnet",
    });
    expect(r.raw).toEqual({ value: 7 });
    expect(r.diagnostics.backend).toBe("subscription");
    expect(r.diagnostics.mode).toBe("mcp_submit_tool");
    expect(r.diagnostics.modelId).toMatch(/^subscription:/);
    expect(callViaSdkMcpSubmitTool).toHaveBeenCalledOnce();
    expect(callViaAnthropicApi).not.toHaveBeenCalled();
  });

  it("api default backend routes to callViaAnthropicApi", async () => {
    // critic_canon defaults to api in DEFAULT_AGENT_BACKEND.
    vi.mocked(callViaAnthropicApi).mockResolvedValue({ value: 42 });
    const r = await dispatchStructured<{ q: string }, z.infer<typeof sampleSchema>>({
      agentName: "critic_canon",
      payload: { q: "x" },
      model: "sonnet",
    });
    expect(r.raw).toEqual({ value: 42 });
    expect(r.diagnostics.backend).toBe("api");
    expect(callViaAnthropicApi).toHaveBeenCalledOnce();
    expect(callViaSdkMcpSubmitTool).not.toHaveBeenCalled();
  });

  it("per-call mode override is honoured for native (raises clear error)", async () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_canon: "subscription" });
    await expect(
      dispatchStructured({
        agentName: "critic_canon",
        payload: { q: "x" },
        model: "sonnet",
        mode: "native_output_format",
      }),
    ).rejects.toThrow(/mode "native_output_format" not implemented/);
  });

  it("env LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP per-agent forces a specific mode", async () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_canon: "subscription" });
    process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP = JSON.stringify({
      critic_canon: "hybrid_generate_extract",
    });
    await expect(
      dispatchStructured({
        agentName: "critic_canon",
        payload: { q: "x" },
        model: "sonnet",
      }),
    ).rejects.toThrow(/mode "hybrid_generate_extract" not implemented/);
  });

  it("post-validates raw output", async () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_canon: "subscription" });
    vi.mocked(callViaSdkMcpSubmitTool).mockResolvedValue({
      raw: { value: "not a number" } as unknown as z.infer<typeof sampleSchema>,
      diagnostics: {
        modelId: "subscription:opaque",
        toolCallCount: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
    await expect(
      dispatchStructured({
        agentName: "critic_canon",
        payload: { q: "x" },
        model: "sonnet",
      }),
    ).rejects.toThrow(/post-validation failed/);
  });

  it("emits onDiagnostics on success", async () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_canon: "subscription" });
    vi.mocked(callViaSdkMcpSubmitTool).mockResolvedValue({
      raw: { value: 1 },
      diagnostics: {
        modelId: "subscription:opaque",
        toolCallCount: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
    const seen: unknown[] = [];
    await dispatchStructured({
      agentName: "critic_canon",
      payload: { q: "x" },
      model: "sonnet",
      onDiagnostics: (d) => seen.push(d),
    });
    expect(seen).toHaveLength(1);
  });
});

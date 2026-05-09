import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  clearStructuredRegistry,
  getAgentContract,
  listRegisteredAgents,
  registerAgentContract,
  assertAllStructuredAgentsHaveContracts,
  assertUniqueMcpToolNames,
  STRUCTURED_AGENT_NAMES,
  type AgentName,
  type AgentStructuredContract,
} from "../index.js";
import { LLMError } from "../errors.js";

const sampleSchema = z.object({ kind: z.string(), n: z.number() });

function makeContract(
  agentName: AgentName,
  toolName: string,
): AgentStructuredContract<{ s: string }, { kind: string; n: number }> {
  return {
    agentName,
    getOutputSchema: () => sampleSchema,
    systemPrompt: "system",
    buildPrompt: (i) => i.s,
    defaultMode: "mcp_submit_tool",
    mcp: { toolName, toolDescription: "test" },
  };
}

beforeEach(() => {
  clearStructuredRegistry();
});

describe("structured-registry", () => {
  it("registerAgentContract + getAgentContract round-trip", () => {
    const c = makeContract("critic_canon", "submit_critique_canon");
    registerAgentContract(c);
    expect(getAgentContract("critic_canon")).toBe(c);
  });

  it("re-register overwrites without error", () => {
    const c1 = makeContract("critic_canon", "submit_critique_canon");
    const c2 = makeContract("critic_canon", "submit_critique_canon_v2");
    registerAgentContract(c1);
    registerAgentContract(c2);
    expect(getAgentContract("critic_canon")).toBe(c2);
  });

  it("clearStructuredRegistry empties", () => {
    registerAgentContract(makeContract("critic_canon", "submit_critique_canon"));
    clearStructuredRegistry();
    expect(listRegisteredAgents()).toEqual([]);
  });

  it("getAgentContract on unknown agent throws LLMError", () => {
    expect(() => getAgentContract("critic_canon")).toThrow(LLMError);
  });

  it("assertAllStructuredAgentsHaveContracts raises with missing list", () => {
    expect(() => assertAllStructuredAgentsHaveContracts()).toThrow(
      /missing contracts for: critic_canon/,
    );
  });

  it("assertAllStructuredAgentsHaveContracts passes when all registered", () => {
    registerAgentContract(makeContract("critic_canon", "submit_critique_canon"));
    expect(() => assertAllStructuredAgentsHaveContracts()).not.toThrow();
  });

  it("assertUniqueMcpToolNames raises on duplicate toolName", () => {
    registerAgentContract(makeContract("critic_canon", "duplicate_tool"));
    registerAgentContract(makeContract("critic_style", "duplicate_tool"));
    expect(() => assertUniqueMcpToolNames()).toThrow(/duplicate mcp\.toolName/);
  });

  it("STRUCTURED_AGENT_NAMES contains critic_canon for Phase 1", () => {
    expect(STRUCTURED_AGENT_NAMES.has("critic_canon")).toBe(true);
  });
});

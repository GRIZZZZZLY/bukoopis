import { LLMError } from "./errors.js";
import { STRUCTURED_AGENT_NAMES } from "./types.js";
import type { AgentName, AgentStructuredContract } from "./types.js";

const REGISTRY = new Map<AgentName, AgentStructuredContract<unknown, unknown>>();

export function registerAgentContract<I, O>(
  contract: AgentStructuredContract<I, O>,
): void {
  REGISTRY.set(
    contract.agentName,
    contract as unknown as AgentStructuredContract<unknown, unknown>,
  );
}

export function getAgentContract(
  agentName: AgentName,
): AgentStructuredContract<unknown, unknown> {
  const c = REGISTRY.get(agentName);
  if (!c) {
    throw new LLMError(
      `[structured-registry] no contract registered for agent "${agentName}"`,
    );
  }
  return c;
}

export function clearStructuredRegistry(): void {
  REGISTRY.clear();
}

export function listRegisteredAgents(): AgentName[] {
  return [...REGISTRY.keys()];
}

/** Verifies every agent in STRUCTURED_AGENT_NAMES has a contract registered. */
export function assertAllStructuredAgentsHaveContracts(): void {
  const missing: AgentName[] = [];
  for (const name of STRUCTURED_AGENT_NAMES) {
    if (!REGISTRY.has(name)) missing.push(name);
  }
  if (missing.length > 0) {
    throw new LLMError(
      `[structured-registry] missing contracts for: ${missing.join(", ")}. Did you call registerAllAgentContracts() at startup?`,
    );
  }
  assertUniqueMcpToolNames();
}

/** Verifies no two contracts declare the same mcp.toolName. */
export function assertUniqueMcpToolNames(): void {
  const seen = new Map<string, AgentName>();
  for (const [agent, contract] of REGISTRY.entries()) {
    if (!contract.mcp) continue;
    const existing = seen.get(contract.mcp.toolName);
    if (existing) {
      throw new LLMError(
        `[structured-registry] duplicate mcp.toolName "${contract.mcp.toolName}" between agents "${existing}" and "${agent}"`,
      );
    }
    seen.set(contract.mcp.toolName, agent);
  }
}

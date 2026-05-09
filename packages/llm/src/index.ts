export { resolveModelId, MODEL_IDS } from "./models.js";
export { callStructured, LLMValidationError } from "./structured.js";
export type { StructuredCallOptions, StructuredUsage } from "./structured.js";
export { streamText, buildSystemParam } from "./stream.js";
export type { StreamCallOptions, StreamCallResult, SystemBlock } from "./stream.js";
export { streamTextOllama } from "./ollama.js";
export type { OllamaStreamOptions } from "./ollama.js";

// Backend abstraction (etap 0.2.1)
export type { LLMBackend, AgentName } from "./types.js";
export { AGENT_NAMES, effectiveBackend } from "./types.js";

// Structured-output contract types (etap 0.2.4 — Phase 1)
export type {
  StructuredMode,
  AgentMcpSpec,
  AgentStructuredContract,
} from "./types.js";
export { STRUCTURED_AGENT_NAMES } from "./types.js";
export {
  LLMError,
  BackendNotImplementedError,
  LLMAuthError,
  LLMNoToolCallError,
  LLMMultipleToolCallsError,
  LLMSchemaRetryExhaustedError,
} from "./errors.js";
export {
  resolveBackend,
  resolveBackendForCall,
  resolveStructuredMode,
} from "./router.js";
export type {
  ResolveBackendForCallInput,
  ResolveStructuredModeInput,
} from "./router.js";

// Hybrid pipeline: subscription text + api structured extraction (etap 0.2.3)
export { generateThenStructure } from "./hybrid.js";
export type {
  GenerateThenStructureInput,
  HybridUsageEvent,
} from "./hybrid.js";

// Structured-output registry (etap 0.2.4 — Phase 1)
export {
  registerAgentContract,
  getAgentContract,
  clearStructuredRegistry,
  listRegisteredAgents,
  assertAllStructuredAgentsHaveContracts,
  assertUniqueMcpToolNames,
} from "./structured-registry.js";

import type { WriterProvider } from "@book-forge/shared";
import {
  AGENT_NAMES,
  effectiveBackend,
  type AgentName,
  type LLMBackend,
} from "./types.js";

const DEFAULT_AGENT_BACKEND: Record<AgentName, LLMBackend> = {
  plot: "api",
  lore: "api",
  character: "api",
  writer: "subscription",
  editor: "subscription",
  inline: "api",
  summarizer: "subscription",
  canon_guard: "api",
  critic_canon: "api",
  critic_style: "api",
  critic_editor: "api",
  critic_reader: "api",
  style_extractor: "api",
};

const VALID_BACKENDS: ReadonlySet<LLMBackend> = new Set(["api", "subscription"]);
const VALID_AGENTS: ReadonlySet<string> = new Set(AGENT_NAMES);

function parseEnvOverrides(): Partial<Record<AgentName, LLMBackend>> {
  const raw = process.env.LLM_AGENT_BACKEND_MAP;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[llm/router] LLM_AGENT_BACKEND_MAP is not valid JSON — ignored",
    );
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out: Partial<Record<AgentName, LLMBackend>> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!VALID_AGENTS.has(k)) continue;
    if (typeof v !== "string" || !VALID_BACKENDS.has(v as LLMBackend)) continue;
    out[k as AgentName] = v as LLMBackend;
  }
  return out;
}

export function resolveBackend(agentName: AgentName): LLMBackend {
  const overrides = parseEnvOverrides();
  return overrides[agentName] ?? DEFAULT_AGENT_BACKEND[agentName];
}

export interface ResolveBackendForCallInput {
  agentName: AgentName;
  provider: WriterProvider;
  hasOutputSchema: boolean;
}

export function resolveBackendForCall(
  input: ResolveBackendForCallInput,
): LLMBackend {
  if (input.hasOutputSchema) return "api";
  const requested = resolveBackend(input.agentName);
  return effectiveBackend(input.provider, requested);
}

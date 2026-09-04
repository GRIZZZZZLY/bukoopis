import type { WriterProvider } from "@book-forge/shared";
import {
  AGENT_NAMES,
  effectiveBackend,
  type AgentName,
  type LLMBackend,
} from "./types.js";

const DEFAULT_AGENT_BACKEND: Record<AgentName, LLMBackend> = {
  plot_outline: "api",
  plot_chapter_plan: "api",
  lore: "api",
  character: "api",
  writer: "subscription",
  editor: "subscription",
  inline: "subscription",
  summarizer: "subscription",
  canon_guard: "api",
  critic_canon: "api",
  critic_style: "api",
  critic_editor: "api",
  critic_reader: "api",
  style_extractor: "api",
  style_blender: "api",
  concept_refiner: "subscription",
  pitch_generator: "subscription",
  pitch_blender: "subscription",
  aspect_playbook: "subscription",
  aspect_variants: "subscription",
  aspect_refine: "subscription",
  aspect_entity_variants: "subscription",
  canon_fact_extractor: "subscription",
  episodic_note_extractor: "subscription",
  reranker: "subscription",
  material_classifier: "subscription",
};

// One-time deprecation warnings for compat aliases (etap 0.2.4 / Phase 4).
const warnedKeys = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

/** Mutates `map` in place: if a deprecated "plot" key is present, copies its
 *  value onto plot_outline + plot_chapter_plan (without overwriting explicit
 *  entries) and removes the legacy key. Emits a one-shot deprecation warning. */
function applyPlotCompatAlias(
  map: Record<string, unknown>,
  mapEnvName: string,
): void {
  if ("plot" in map) {
    const v = map.plot;
    if (map.plot_outline === undefined) {
      map.plot_outline = v;
    }
    if (map.plot_chapter_plan === undefined) {
      map.plot_chapter_plan = v;
    }
    warnOnce(
      `${mapEnvName}.plot`,
      `[llm/router] ${mapEnvName}: "plot" key is deprecated, use plot_outline and plot_chapter_plan`,
    );
    delete map.plot;
  }
}

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
  const obj = parsed as Record<string, unknown>;
  // Apply legacy "plot" compat BEFORE the VALID_AGENTS filter strips it.
  applyPlotCompatAlias(obj, "LLM_AGENT_BACKEND_MAP");
  const out: Partial<Record<AgentName, LLMBackend>> = {};
  for (const [k, v] of Object.entries(obj)) {
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
  // hasOutputSchema no longer forces api: as of etap 0.2.4 / Phase 1, the
  // dispatcher can route structured calls through subscription via the
  // mcp_submit_tool mode. The flag is retained on the input shape for
  // future telemetry and to keep callers backward-compatible.
  void input.hasOutputSchema;
  const requested = resolveBackend(input.agentName);
  return effectiveBackend(input.provider, requested);
}

// ─── Structured mode resolution (etap 0.2.4 — Phase 1) ───

import type { StructuredMode } from "./types.js";

const VALID_MODES: ReadonlySet<StructuredMode> = new Set([
  "native_output_format",
  "mcp_submit_tool",
  "hybrid_generate_extract",
]);

function parseEnvMode(raw: string | undefined): StructuredMode | undefined {
  if (!raw) return undefined;
  return VALID_MODES.has(raw as StructuredMode)
    ? (raw as StructuredMode)
    : undefined;
}

function parseEnvModeMap(): Partial<Record<AgentName, StructuredMode>> {
  const raw = process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[llm/router] LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP is not valid JSON — ignored",
    );
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;
  applyPlotCompatAlias(obj, "LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP");
  const out: Partial<Record<AgentName, StructuredMode>> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!VALID_AGENTS.has(k)) continue;
    if (typeof v !== "string" || !VALID_MODES.has(v as StructuredMode)) continue;
    out[k as AgentName] = v as StructuredMode;
  }
  return out;
}

export interface ResolveStructuredModeInput {
  agentName: AgentName;
  contractDefault: StructuredMode;
  perCall?: StructuredMode;
}

export function resolveStructuredMode(
  input: ResolveStructuredModeInput,
): StructuredMode {
  if (input.perCall) return input.perCall;
  const map = parseEnvModeMap();
  const perAgent = map[input.agentName];
  if (perAgent) return perAgent;
  const global = parseEnvMode(process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE);
  if (global) return global;
  return input.contractDefault;
}

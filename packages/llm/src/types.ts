import type { ZodType } from "zod";
import type { WriterProvider } from "@book-forge/shared";

export type LLMBackend = "api" | "subscription";

export type StructuredMode =
  | "native_output_format"
  | "mcp_submit_tool"
  | "hybrid_generate_extract";

export interface AgentMcpSpec {
  toolName: string;
  toolDescription: string;
  maxTurns?: number;
}

export interface AgentStructuredContract<I, O> {
  agentName: AgentName;
  getOutputSchema: (input: I) => ZodType<O>;
  systemPrompt: string;
  buildPrompt: (input: I) => string;
  defaultMode: StructuredMode;
  mcp?: AgentMcpSpec;
}

export const AGENT_NAMES = [
  "plot_outline",
  "plot_chapter_plan",
  "lore",
  "character",
  "writer",
  "editor",
  "inline",
  "summarizer",
  "canon_guard",
  "critic_canon",
  "critic_style",
  "critic_editor",
  "critic_reader",
  "style_extractor",
  "style_blender",
  "concept_refiner",
  "pitch_generator",
  "pitch_blender",
  "aspect_playbook",
  "aspect_variants",
  "aspect_refine",
  "aspect_entity_variants",
  "canon_fact_extractor",
  "character_event_extractor",
  "episodic_note_extractor",
  "reranker",
  "material_classifier",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export function effectiveBackend(
  provider: WriterProvider,
  requested: LLMBackend,
): LLMBackend {
  if (provider === "ollama") return "api";
  return requested;
}

/** Whitelist of agents that produce structured output and therefore MUST
 *  have a contract registered at startup. Free-text agents
 *  (writer/editor/summarizer/inline) and non-LLM placeholders
 *  (lore/character) are excluded. Phase 1 starts with critic_canon only;
 *  subsequent phases add the rest. The drift-guard test in
 *  __tests__/structured-agents-parity.test.ts enforces deliberate growth. */
export const STRUCTURED_AGENT_NAMES: ReadonlySet<AgentName> = new Set<AgentName>([
  "critic_canon",
  "critic_style",
  "critic_editor",
  "critic_reader",
  "canon_guard",
  "plot_outline",
  "plot_chapter_plan",
  "style_extractor",
  "style_blender",
  "concept_refiner",
  "pitch_generator",
  "pitch_blender",
  "aspect_playbook",
  "aspect_variants",
  "aspect_refine",
  "aspect_entity_variants",
  "canon_fact_extractor",
  "character_event_extractor",
  "episodic_note_extractor",
  "reranker",
  "material_classifier",
]);

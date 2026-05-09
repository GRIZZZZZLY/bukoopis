import type { WriterProvider } from "@book-forge/shared";

export type LLMBackend = "api" | "subscription";

export const AGENT_NAMES = [
  "plot",
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
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export function effectiveBackend(
  provider: WriterProvider,
  requested: LLMBackend,
): LLMBackend {
  if (provider === "ollama") return "api";
  return requested;
}

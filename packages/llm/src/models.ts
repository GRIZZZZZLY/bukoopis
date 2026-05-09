import type { ModelChoice } from "@book-forge/shared";

export const MODEL_IDS = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
} as const;

export function resolveModelId(choice: ModelChoice): string {
  return MODEL_IDS[choice];
}

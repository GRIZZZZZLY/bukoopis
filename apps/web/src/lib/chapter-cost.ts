import {
  calculateCost,
  MODEL_IDS,
  type ModelChoice,
} from "@book-forge/shared";

/** Re-exported under the old name; the mapping itself lives in shared now. */
export const MODEL_API_ID: Record<ModelChoice, string> = MODEL_IDS;

// Empirical per-chapter token averages (4k-word RU chapter).
// Writer = ~4500 in / 11000 out; Plot = ~2500 in / 1500 out;
// Critic batch (4 critics) = ~12000 in / 3000 out total.
export const PER_CHAPTER_TOKENS = {
  writer: { input: 4500, output: 11000 },
  plot: { input: 2500, output: 1500 },
  critic: { input: 12000, output: 3000 },
};

export function estimatePerChapterUsd(
  writer: ModelChoice,
  plot: ModelChoice,
  critic: ModelChoice,
): number {
  const w = calculateCost({
    model: MODEL_API_ID[writer],
    inputTokens: PER_CHAPTER_TOKENS.writer.input,
    outputTokens: PER_CHAPTER_TOKENS.writer.output,
  }).totalUsd;
  const p = calculateCost({
    model: MODEL_API_ID[plot],
    inputTokens: PER_CHAPTER_TOKENS.plot.input,
    outputTokens: PER_CHAPTER_TOKENS.plot.output,
  }).totalUsd;
  const cr = calculateCost({
    model: MODEL_API_ID[critic],
    inputTokens: PER_CHAPTER_TOKENS.critic.input,
    outputTokens: PER_CHAPTER_TOKENS.critic.output,
  }).totalUsd;
  return w + p + cr;
}

import {
  ALL_CRITIC_TYPES,
  calculateCost,
  MODEL_IDS,
  type ModelChoice,
} from "@book-forge/shared";

/** Re-exported under the old name; the mapping itself lives in shared now. */
export const MODEL_API_ID: Record<ModelChoice, string> = MODEL_IDS;

// Empirical per-chapter token averages (4k-word RU chapter).
// Writer = ~4500 in / 11000 out; Plot = ~2500 in / 1500 out;
// один критик ≈ 3000 in / 750 out — замер делался на пачке из четырёх
// (12000 / 3000 на всех). Пачка теперь считается по числу критиков, а не
// константой: критиков стало пять, а прогноз этого не знал (F11 ревью
// 2026-09-22).
//
// Чего прогноз НЕ включает: подготовку сцены, извлекатели памяти и анкету
// сцены, правку, генерацию по беатам и чат. Подписочные вызовы оцениваются
// нулём — это условность приложения, а не доказательство бесплатности.
const PER_CRITIC_TOKENS = { input: 3000, output: 750 };
export const PER_CHAPTER_TOKENS = {
  writer: { input: 4500, output: 11000 },
  plot: { input: 2500, output: 1500 },
  critic: {
    input: PER_CRITIC_TOKENS.input * ALL_CRITIC_TYPES.length,
    output: PER_CRITIC_TOKENS.output * ALL_CRITIC_TYPES.length,
  },
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

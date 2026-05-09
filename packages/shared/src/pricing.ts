// Anthropic pricing as of May 2026. Source: https://www.anthropic.com/pricing
// All values in USD per million tokens. Cache write = 1.25x base, cache read =
// 0.1x base (90% discount). Update when Anthropic changes pricing.

export interface ModelRates {
  inputPerMtok: number;
  outputPerMtok: number;
}

export const MODEL_RATES: Record<string, ModelRates> = {
  // Latest Claude 4.x family
  "claude-opus-4-7": { inputPerMtok: 15, outputPerMtok: 75 },
  "claude-opus-4-6": { inputPerMtok: 15, outputPerMtok: 75 },
  "claude-opus-4-5-20251101": { inputPerMtok: 15, outputPerMtok: 75 },
  "claude-opus-4-1-20250805": { inputPerMtok: 15, outputPerMtok: 75 },
  "claude-opus-4-20250514": { inputPerMtok: 15, outputPerMtok: 75 },
  "claude-sonnet-4-6": { inputPerMtok: 3, outputPerMtok: 15 },
  "claude-sonnet-4-5-20250929": { inputPerMtok: 3, outputPerMtok: 15 },
  "claude-sonnet-4-20250514": { inputPerMtok: 3, outputPerMtok: 15 },
  "claude-haiku-4-5-20251001": { inputPerMtok: 1, outputPerMtok: 5 },
};

const FALLBACK_RATES: ModelRates = { inputPerMtok: 3, outputPerMtok: 15 };
const ZERO_RATES: ModelRates = { inputPerMtok: 0, outputPerMtok: 0 };

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export interface CostInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheCreationUsd: number;
  cacheReadUsd: number;
  totalUsd: number;
}

export function getModelRates(model: string): ModelRates {
  if (
    model.startsWith("ollama:") ||
    model.startsWith("local:") ||
    model.startsWith("subscription:")
  ) {
    return ZERO_RATES;
  }
  return MODEL_RATES[model] ?? FALLBACK_RATES;
}

export function calculateCost(input: CostInput): CostBreakdown {
  const rates = getModelRates(input.model);
  const inputUsd = (input.inputTokens / 1_000_000) * rates.inputPerMtok;
  const outputUsd = (input.outputTokens / 1_000_000) * rates.outputPerMtok;
  const cacheCreationUsd =
    ((input.cacheCreationInputTokens ?? 0) / 1_000_000) *
    rates.inputPerMtok *
    CACHE_WRITE_MULTIPLIER;
  const cacheReadUsd =
    ((input.cacheReadInputTokens ?? 0) / 1_000_000) *
    rates.inputPerMtok *
    CACHE_READ_MULTIPLIER;
  const totalUsd = inputUsd + outputUsd + cacheCreationUsd + cacheReadUsd;
  return { inputUsd, outputUsd, cacheCreationUsd, cacheReadUsd, totalUsd };
}

// Usage record schema shared between server + web.
import { z } from "zod";

export const llmUsageRecordSchema = z.object({
  id: z.number().int().positive(),
  route: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  bookId: z.number().int().positive().nullable(),
  chapterId: z.number().int().positive().nullable(),
  versionId: z.number().int().positive().nullable(),
  createdAt: z.string(),
});
export type LlmUsageRecord = z.infer<typeof llmUsageRecordSchema>;

export const usageSummarySchema = z.object({
  totalUsd: z.number().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalCacheReadTokens: z.number().int().nonnegative(),
  totalCacheCreationTokens: z.number().int().nonnegative(),
  perRoute: z.array(
    z.object({
      route: z.string(),
      calls: z.number().int(),
      costUsd: z.number(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
    }),
  ),
  perDay: z.array(
    z.object({
      date: z.string(),
      costUsd: z.number(),
      calls: z.number().int(),
    }),
  ),
  recent: z.array(llmUsageRecordSchema),
});
export type UsageSummary = z.infer<typeof usageSummarySchema>;

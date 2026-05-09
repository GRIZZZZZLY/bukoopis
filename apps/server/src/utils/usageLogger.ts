import type { Database as DatabaseType } from "better-sqlite3";
import { calculateCost } from "@book-forge/shared";

export interface UsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface LogUsageInput {
  route: string;
  model: string;
  usage: UsageMetrics;
  bookId?: number | null;
  chapterId?: number | null;
  versionId?: number | null;
}

// Best-effort: never throw. A failed usage log must not abort an otherwise
// successful generation. We log the error to console and move on.
export function logUsage(
  sqlite: DatabaseType,
  input: LogUsageInput,
): void {
  try {
    const breakdown = calculateCost({
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheCreationInputTokens: input.usage.cacheCreationInputTokens,
      cacheReadInputTokens: input.usage.cacheReadInputTokens,
    });
    sqlite
      .prepare(
        `INSERT INTO llm_usage
         (route, model, input_tokens, output_tokens,
          cache_creation_input_tokens, cache_read_input_tokens,
          cost_usd, book_id, chapter_id, version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.route,
        input.model,
        input.usage.inputTokens,
        input.usage.outputTokens,
        input.usage.cacheCreationInputTokens ?? 0,
        input.usage.cacheReadInputTokens ?? 0,
        breakdown.totalUsd,
        input.bookId ?? null,
        input.chapterId ?? null,
        input.versionId ?? null,
        new Date().toISOString(),
      );
  } catch (e) {
    console.warn(
      "[usageLogger] failed to persist usage row:",
      e instanceof Error ? e.message : e,
    );
  }
}

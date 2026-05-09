import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import type { LlmUsageRecord, UsageSummary } from "@book-forge/shared";

interface UsageRow {
  id: number;
  route: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
  book_id: number | null;
  chapter_id: number | null;
  version_id: number | null;
  created_at: string;
}

function toRecord(r: UsageRow): LlmUsageRecord {
  return {
    id: r.id,
    route: r.route,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheCreationInputTokens: r.cache_creation_input_tokens,
    cacheReadInputTokens: r.cache_read_input_tokens,
    costUsd: r.cost_usd,
    bookId: r.book_id,
    chapterId: r.chapter_id,
    versionId: r.version_id,
    createdAt: r.created_at,
  };
}

interface AggRoute {
  route: string;
  calls: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}
interface AggDay {
  date: string;
  cost: number;
  calls: number;
}

export function createUsageRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();

  r.get("/usage", (c) => {
    const bookIdRaw = c.req.query("bookId");
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");

    const conds: string[] = [];
    const params: Array<string | number> = [];
    if (bookIdRaw) {
      conds.push("book_id = ?");
      params.push(Number(bookIdRaw));
    }
    if (fromRaw) {
      conds.push("created_at >= ?");
      params.push(fromRaw);
    }
    if (toRaw) {
      conds.push("created_at <= ?");
      params.push(toRaw);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";

    const totalsRow = sqlite
      .prepare(
        `SELECT
           COUNT(*) AS calls,
           COALESCE(SUM(cost_usd), 0) AS cost,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens,
           COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read,
           COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation
         FROM llm_usage ${where}`,
      )
      .get(...params) as {
      calls: number;
      cost: number;
      input_tokens: number;
      output_tokens: number;
      cache_read: number;
      cache_creation: number;
    };

    const perRouteRows = sqlite
      .prepare(
        `SELECT
           route,
           COUNT(*) AS calls,
           COALESCE(SUM(cost_usd), 0) AS cost,
           COALESCE(SUM(input_tokens), 0) AS input_tokens,
           COALESCE(SUM(output_tokens), 0) AS output_tokens
         FROM llm_usage ${where}
         GROUP BY route
         ORDER BY cost DESC`,
      )
      .all(...params) as Array<AggRoute & { input_tokens: number; output_tokens: number }>;

    const perDayRows = sqlite
      .prepare(
        `SELECT
           substr(created_at, 1, 10) AS date,
           COUNT(*) AS calls,
           COALESCE(SUM(cost_usd), 0) AS cost
         FROM llm_usage ${where}
         GROUP BY substr(created_at, 1, 10)
         ORDER BY date DESC
         LIMIT 60`,
      )
      .all(...params) as AggDay[];

    const recentRows = sqlite
      .prepare(
        `SELECT * FROM llm_usage ${where}
         ORDER BY created_at DESC LIMIT 50`,
      )
      .all(...params) as UsageRow[];

    const summary: UsageSummary = {
      totalUsd: totalsRow.cost,
      totalCalls: totalsRow.calls,
      totalInputTokens: totalsRow.input_tokens,
      totalOutputTokens: totalsRow.output_tokens,
      totalCacheReadTokens: totalsRow.cache_read,
      totalCacheCreationTokens: totalsRow.cache_creation,
      perRoute: perRouteRows.map((row) => ({
        route: row.route,
        calls: row.calls,
        costUsd: row.cost,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
      })),
      perDay: perDayRows.map((row) => ({
        date: row.date,
        costUsd: row.cost,
        calls: row.calls,
      })),
      recent: recentRows.map(toRecord),
    };
    return c.json(summary);
  });

  return r;
}

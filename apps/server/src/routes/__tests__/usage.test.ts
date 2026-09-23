import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTestApp,
  send,
  sendJson,
  type TestApp,
} from "./_helpers.js";

interface UsageSummaryJson {
  totalUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  perRoute: Array<{
    route: string;
    calls: number;
    costUsd: number;
  }>;
  perDay: Array<{ date: string; costUsd: number; calls: number }>;
  recent: Array<{ id: number; route: string }>;
}

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => t.cleanup());

function seedUsage(
  helper: TestApp,
  rows: Array<{
    route: string;
    model: string;
    input: number;
    output: number;
    cost: number;
    bookId?: number | null;
    chapterId?: number | null;
    createdAt?: string;
  }>,
) {
  // Reach into the DB directly via SQL — same file used by app.
  // Dynamic import to avoid type-juggling with default vs named export.
  // better-sqlite3's CommonJS module.exports is the constructor itself.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DatabaseCtor = require("better-sqlite3") as new (
    path: string,
  ) => import("better-sqlite3").Database;
  const path = `${(helper as unknown as { dbDir: string }).dbDir}/test.sqlite`;
  const db = new DatabaseCtor(path);
  const stmt = db.prepare(
    `INSERT INTO llm_usage
     (route, model, input_tokens, output_tokens,
      cache_creation_input_tokens, cache_read_input_tokens,
      cost_usd, book_id, chapter_id, version_id, created_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, NULL, ?)`,
  );
  const now = new Date().toISOString();
  for (const r of rows) {
    stmt.run(
      r.route,
      r.model,
      r.input,
      r.output,
      r.cost,
      r.bookId ?? null,
      r.chapterId ?? null,
      r.createdAt ?? now,
    );
  }
  db.close();
}

describe("/api/usage", () => {
  it("chapterId оставляет расход одной главы", async () => {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Глава с ценой" });
    const ch1 = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/chapters`, "POST", { title: "Раз" });
    const ch2 = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/chapters`, "POST", { title: "Два" });
    seedUsage(t, [
      { route: "writer.chapter", model: "claude-opus-4-7", input: 1, output: 1, cost: 0.4, bookId: b.id, chapterId: ch1.id },
      { route: "critic.canon", model: "claude-sonnet-4-6", input: 1, output: 1, cost: 0.1, bookId: b.id, chapterId: ch1.id },
      { route: "writer.chapter", model: "claude-opus-4-7", input: 1, output: 1, cost: 0.7, bookId: b.id, chapterId: ch2.id },
    ]);
    const summary = await sendJson<UsageSummaryJson>(t.app, `/api/usage?chapterId=${ch1.id}`, "GET");
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalUsd).toBeCloseTo(0.5, 5);
  });

  it("empty DB returns zeros", async () => {
    const summary = await sendJson<UsageSummaryJson>(
      t.app,
      "/api/usage",
      "GET",
    );
    expect(summary.totalCalls).toBe(0);
    expect(summary.totalUsd).toBe(0);
    expect(summary.perRoute).toEqual([]);
  });

  it("aggregates total + per-route", async () => {
    seedUsage(t, [
      { route: "writer.chapter", model: "claude-opus-4-7", input: 500, output: 1000, cost: 0.5 },
      { route: "writer.chapter", model: "claude-opus-4-7", input: 600, output: 1100, cost: 0.6 },
      { route: "critic.canon", model: "claude-sonnet-4-6", input: 200, output: 100, cost: 0.05 },
    ]);
    const summary = await sendJson<UsageSummaryJson>(
      t.app,
      "/api/usage",
      "GET",
    );
    expect(summary.totalCalls).toBe(3);
    expect(summary.totalUsd).toBeCloseTo(1.15, 5);
    expect(summary.totalInputTokens).toBe(1300);
    expect(summary.totalOutputTokens).toBe(2200);
    expect(summary.perRoute.length).toBe(2);
    const writer = summary.perRoute.find((r) => r.route === "writer.chapter");
    expect(writer?.calls).toBe(2);
    expect(writer?.costUsd).toBeCloseTo(1.1, 5);
  });

  it("filters by bookId", async () => {
    // Create real books so FK constraint passes
    const b1 = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
      title: "B1",
    });
    const b2 = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
      title: "B2",
    });
    seedUsage(t, [
      {
        route: "writer.chapter",
        model: "claude-opus-4-7",
        input: 100,
        output: 200,
        cost: 0.1,
        bookId: b1.id,
      },
      {
        route: "writer.chapter",
        model: "claude-opus-4-7",
        input: 100,
        output: 200,
        cost: 0.1,
        bookId: b2.id,
      },
    ]);
    const summary = await sendJson<UsageSummaryJson>(
      t.app,
      `/api/usage?bookId=${b1.id}`,
      "GET",
    );
    expect(summary.totalCalls).toBe(1);
    expect(summary.totalUsd).toBeCloseTo(0.1, 5);
  });

  it("filters by from/to date", async () => {
    seedUsage(t, [
      {
        route: "writer.chapter",
        model: "claude-opus-4-7",
        input: 100,
        output: 200,
        cost: 0.1,
        createdAt: "2026-04-01T00:00:00.000Z",
      },
      {
        route: "writer.chapter",
        model: "claude-opus-4-7",
        input: 100,
        output: 200,
        cost: 0.1,
        createdAt: "2026-05-15T00:00:00.000Z",
      },
    ]);
    const summary = await sendJson<UsageSummaryJson>(
      t.app,
      "/api/usage?from=2026-05-01T00:00:00.000Z",
      "GET",
    );
    expect(summary.totalCalls).toBe(1);
  });

  it("recent list capped at 50, sorted DESC", async () => {
    seedUsage(
      t,
      Array.from({ length: 60 }, (_, i) => ({
        route: "writer.chapter",
        model: "claude-opus-4-7",
        input: 100,
        output: 200,
        cost: 0.1,
        createdAt: new Date(2026, 0, 1 + i).toISOString(),
      })),
    );
    const summary = await sendJson<UsageSummaryJson>(
      t.app,
      "/api/usage",
      "GET",
    );
    expect(summary.recent.length).toBe(50);
  });

  it("returns valid response shape even with zero rows", async () => {
    const res = await send(t.app, "/api/usage", "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as UsageSummaryJson;
    expect(Array.isArray(body.perRoute)).toBe(true);
    expect(Array.isArray(body.perDay)).toBe(true);
    expect(Array.isArray(body.recent)).toBe(true);
  });
});

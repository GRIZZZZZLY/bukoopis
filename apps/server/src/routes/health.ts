import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";

export interface HealthOptions {
  sqlite: DatabaseType;
  hasVec: boolean;
}

export function createHealthRoute(opts: HealthOptions): Hono {
  const r = new Hono();
  r.get("/", (c) => {
    let dbStatus: "ok" | "missing" = "missing";
    try {
      const row = opts.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='_health'",
        )
        .get();
      if (row) {
        opts.sqlite.prepare("SELECT 1 FROM _health LIMIT 1").get();
        dbStatus = "ok";
      }
    } catch {
      dbStatus = "missing";
    }

    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      db: dbStatus,
      vec: opts.hasVec,
    });
  });
  return r;
}

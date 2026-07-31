import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sqliteVec from "sqlite-vec";
import { bootstrapVirtualTables } from "../../db/virtual.js";
import { runMemoryEval } from "../memory-eval.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

let dbDir: string;
let sqlite: DatabaseType;
let hasVec = false;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "eval-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  hasVec = false;
  try {
    sqliteVec.load(sqlite);
    hasVec = true;
  } catch {
    /* FTS-only fallback */
  }
  migrate(drizzle(sqlite), { migrationsFolder });
  bootstrapVirtualTables(sqlite, hasVec);
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("memory eval harness (ADR 0003 slice 5)", () => {
  it("every memory-quality trap case passes", async () => {
    const report = await runMemoryEval(sqlite, hasVec);
    const failures = report.checks.filter((c) => !c.pass);
    // Surface the failing check names + details in the assertion message.
    expect(
      failures.map((f) => `${f.name}: ${f.detail}`),
      failures.map((f) => f.name).join("; "),
    ).toEqual([]);
    expect(report.passed).toBe(report.total);
    expect(report.total).toBeGreaterThanOrEqual(9);
  });
});

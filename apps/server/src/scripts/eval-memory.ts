import "dotenv/config";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sqliteVec from "sqlite-vec";
import { bootstrapVirtualTables } from "../db/virtual.js";
import { configureEmbeddingProvider } from "../utils/embedding-setup.js";
import { runMemoryEval } from "../eval/memory-eval.js";

/**
 * ADR 0003 slice 5 — run the literary memory eval against a throwaway DB with
 * the configured embedding provider. Set EMBEDDING_PROVIDER=onnx for real
 * semantic recall; defaults to the deterministic stub. Exits non-zero on any
 * failed check so it can gate CI / model changes.
 *
 *   pnpm --filter @book-forge/server eval:memory
 */
async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(__dirname, "../../drizzle");
  const dbDir = mkdtempSync(join(tmpdir(), "eval-memory-"));
  const sqlite = new Database(join(dbDir, "eval.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  let hasVec = false;
  try {
    sqliteVec.load(sqlite);
    hasVec = true;
  } catch {
    /* FTS-only */
  }
  migrate(drizzle(sqlite), { migrationsFolder });
  bootstrapVirtualTables(sqlite, hasVec);

  const provider = configureEmbeddingProvider();
  console.log(`embedding provider: ${provider} | vec: ${hasVec ? "on" : "off"}`);

  const report = await runMemoryEval(sqlite, hasVec);
  for (const c of report.checks) {
    console.log(`${c.pass ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`\n${report.passed}/${report.total} checks passed`);

  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
  if (report.passed !== report.total) process.exit(1);
}

void main();

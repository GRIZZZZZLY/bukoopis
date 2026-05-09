import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";

export type AppSchema = typeof schema;
export type AppDatabase = BetterSQLite3Database<AppSchema>;

export function resolveDbPath(): string {
  const raw = process.env.DB_PATH ?? "../../data/db.sqlite";
  return resolve(process.cwd(), raw);
}

export interface DbHandle {
  sqlite: DatabaseType;
  db: AppDatabase;
  hasVec: boolean;
}

export function createDb(dbPath: string = resolveDbPath()): DbHandle {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  let hasVec = false;
  try {
    sqliteVec.load(sqlite);
    hasVec = true;
  } catch (e) {
    // sqlite-vec may fail to load on some platforms; degrade gracefully —
    // FTS5 search still works, vector search is disabled.
    console.warn(
      "[db] sqlite-vec failed to load — vector search disabled. Reason:",
      e instanceof Error ? e.message : e,
    );
  }

  return { sqlite, db: drizzle(sqlite, { schema }), hasVec };
}

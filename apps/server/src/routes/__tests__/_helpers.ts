import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sqliteVec from "sqlite-vec";
import { createApp, type AppHandle } from "../../app.js";
import { bootstrapVirtualTables } from "../../db/virtual.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

export interface TestApp extends AppHandle {
  dbDir: string;
  sqlite: DatabaseType;
  cleanup: () => void;
}

export function makeTestApp(): TestApp {
  const dbDir = mkdtempSync(join(tmpdir(), "bookforge-test-"));
  const dbPath = join(dbDir, "test.sqlite");

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  let hasVec = false;
  try {
    sqliteVec.load(sqlite);
    hasVec = true;
  } catch {
    /* vec disabled — tests still work via FTS5 */
  }
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
  bootstrapVirtualTables(sqlite, hasVec);
  sqlite.close();

  const handle = createApp(dbPath);
  const reopenedSqlite = new Database(dbPath);

  return {
    ...handle,
    dbDir,
    sqlite: reopenedSqlite,
    cleanup: () => {
      handle.close();
      reopenedSqlite.close();
      try {
        rmSync(dbDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export function jsonReq(
  url: string,
  method: string,
  body?: unknown,
): Request {
  return new Request(`http://test${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

import type { Hono } from "hono";

export async function send(
  app: Hono,
  url: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return await app.request(jsonReq(url, method, body));
}

export async function sendJson<T = unknown>(
  app: Hono,
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const r = await send(app, url, method, body);
  return (await r.json()) as T;
}

export const SAMPLE_DOC = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Привет мир, это тест." }],
    },
  ],
};

import "dotenv/config";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDb, resolveDbPath } from "./client.js";
import { bootstrapVirtualTables } from "./virtual.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const dbPath = resolveDbPath();
  const { sqlite, db, hasVec } = createDb(dbPath);

  const migrationsFolder = resolve(__dirname, "../../drizzle");
  migrate(db, { migrationsFolder });

  bootstrapVirtualTables(sqlite, hasVec);

  const row = sqlite.prepare("SELECT COUNT(*) as c FROM _health").get() as {
    c: number;
  };
  if (row.c === 0) {
    sqlite
      .prepare("INSERT INTO _health (created_at) VALUES (?)")
      .run(new Date().toISOString());
  }

  sqlite.close();
  console.log(
    `✅ migrated: ${dbPath} (vec: ${hasVec ? "enabled" : "disabled"})`,
  );
}

main();

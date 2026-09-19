import "dotenv/config";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDb, resolveDbPath } from "./client.js";
import { bootstrapVirtualTables } from "./virtual.js";
import { backupDatabase } from "./backup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Применяет миграции к базе по пути `dbPath`. Зовётся и скриптом
 * `pnpm migrate`, и сервером при старте (С12 ревью 2026-09-19): раньше
 * `index.ts` миграций не звал, и после обновления кода автор получал 500
 * «no such column» на случайном маршруте — без единой подсказки, что надо
 * выполнить отдельную команду.
 */
/** Есть ли в журнале миграции, которых нет в таблице применённых.
 *  Таблицы может не быть вовсе — это свежая база, применять есть что. */
function hasPendingMigrations(
  sqlite: ReturnType<typeof createDb>["sqlite"],
  migrationsFolder: string,
): boolean {
  let journalCount = 0;
  try {
    const journal = JSON.parse(
      readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as { entries?: unknown[] };
    journalCount = journal.entries?.length ?? 0;
  } catch {
    return true; // журнал не прочитался — пусть решает сам мигратор
  }
  try {
    const row = sqlite
      .prepare("SELECT COUNT(*) AS c FROM __drizzle_migrations")
      .get() as { c: number };
    return row.c < journalCount;
  } catch {
    return true; // таблицы нет — база свежая
  }
}

export function runMigrations(dbPath: string = resolveDbPath()): void {
  const { sqlite, db, hasVec } = createDb(dbPath);
  const migrationsFolder = resolve(__dirname, "../../drizzle");

  // Копия делается, только если применять действительно есть что.
  // Сервер зовёт миграции на каждый старт, а в разработке он стартует на
  // каждое сохранение файла: безусловный `VACUUM INTO` за десяток правок
  // вытеснял из `data/backups/` все копии, сделанные перед настоящей
  // миграцией, — то есть ровно те, ради которых всё и заводилось.
  if (hasPendingMigrations(sqlite, migrationsFolder)) {
    // Single-file SQLite with hand-written SQL migrations: a bad migration or
    // a corrupt write is unrecoverable without a copy.
    const backupPath = backupDatabase(dbPath);
    if (backupPath) console.log(`🛟 backup: ${backupPath}`);
  }
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
  console.log(`✅ migrated: ${dbPath} (vec: ${hasVec ? "enabled" : "disabled"})`);
}

// Запуск как скрипт (`pnpm migrate`). При импорте из сервера ничего не
// происходит: иначе миграции шли бы дважды — на импорт и на вызов.
const runAsScript =
  process.argv[1] !== undefined && /migrate\.(ts|js)$/.test(process.argv[1]);
if (runAsScript) runMigrations(resolveDbPath());

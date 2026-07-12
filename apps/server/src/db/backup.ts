import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const KEEP_BACKUPS = 10;

/**
 * Create a consistent snapshot of the SQLite database before a risky operation
 * (migrations, hand-written SQL). Uses `VACUUM INTO`, which produces a compact,
 * WAL-consistent copy in a single transaction — safe even while the source has
 * a live WAL. No-op when the DB file does not exist yet (fresh install).
 *
 * Backups land in `<db-dir>/backups/<db-name>-<timestamp>.sqlite`. The oldest
 * are pruned so at most KEEP_BACKUPS remain.
 *
 * Returns the backup path, or null when there was nothing to back up.
 */
export function backupDatabase(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;

  const dir = dirname(dbPath);
  const backupDir = resolve(dir, "backups");
  mkdirSync(backupDir, { recursive: true });

  const name = basename(dbPath).replace(/\.sqlite$/i, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(backupDir, `${name}-${stamp}.sqlite`);

  const src = new Database(dbPath, { readonly: true });
  try {
    // Single-quote escaping for the SQL string literal path.
    src.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  pruneOldBackups(backupDir, name);
  return backupPath;
}

function pruneOldBackups(backupDir: string, name: string): void {
  const prefix = `${name}-`;
  const files = readdirSync(backupDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".sqlite"))
    .sort(); // ISO timestamps sort chronologically
  const excess = files.length - KEEP_BACKUPS;
  for (let i = 0; i < excess; i++) {
    try {
      rmSync(resolve(backupDir, files[i]!));
    } catch {
      // best-effort cleanup; a locked/removed file must not fail the backup
    }
  }
}

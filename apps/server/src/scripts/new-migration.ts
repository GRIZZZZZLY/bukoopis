/**
 * Scaffold a new hand-written SQL migration.
 *
 * Since 0008 the drizzle-kit snapshots are out of sync, so migrations are
 * plain SQL applied via the runtime migrator, which reads `meta/_journal.json`
 * (not the snapshots). This script is the sanctioned way to add one: it
 * computes the next index/tag, creates an empty `.sql` file, and appends the
 * journal entry — so the two never drift by hand.
 *
 *   pnpm --filter @book-forge/server drizzle:new add_widgets_table
 *
 * Then edit the created `drizzle/NNNN_<name>.sql` and run `pnpm migrate`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = resolve(__dirname, "../../drizzle");
const journalPath = resolve(drizzleDir, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function main(): void {
  const rawName = process.argv[2];
  if (!rawName) {
    console.error(
      "Usage: drizzle:new <snake_case_name>  (e.g. drizzle:new add_widgets_table)",
    );
    process.exit(1);
  }
  const name = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) {
    console.error("Migration name resolved to empty after normalization.");
    process.exit(1);
  }

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const last = journal.entries[journal.entries.length - 1];
  const nextIdx = last ? last.idx + 1 : 0;
  // Keep `when` strictly increasing even if the clock is behind the last entry.
  const when = Math.max(Date.now(), (last?.when ?? 0) + 1);
  const tag = `${String(nextIdx).padStart(4, "0")}_${name}`;
  const sqlPath = resolve(drizzleDir, `${tag}.sql`);

  if (existsSync(sqlPath)) {
    console.error(`Refusing to overwrite existing migration: ${sqlPath}`);
    process.exit(1);
  }

  // IMPORTANT: the template comment must NOT contain the literal breakpoint
  // marker — the migrator splits the file on that exact string, even inside
  // comments, which turns the header into an empty "statement" and fails with
  // "The supplied SQL string contains no statements".
  writeFileSync(
    sqlPath,
    `-- Migration ${tag}\n-- Hand-written SQL. Separate statements with the breakpoint marker\n-- (see prior migrations); never put that marker inside a comment.\n\n`,
    "utf8",
  );

  journal.entries.push({
    idx: nextIdx,
    version: last?.version ?? "6",
    when,
    tag,
    breakpoints: true,
  });
  writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", "utf8");

  console.log(`✅ created migration ${tag}`);
  console.log(`   SQL:     drizzle/${tag}.sql   (edit this)`);
  console.log(`   journal: meta/_journal.json   (entry appended)`);
  console.log(`Then run: pnpm migrate`);
}

main();

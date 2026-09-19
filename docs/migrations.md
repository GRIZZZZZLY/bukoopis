# Database migrations

`book-forge` uses **hand-written plain-SQL migrations**, applied at runtime by
the drizzle migrator. This is the sanctioned process — not a temporary
workaround.

## Why plain SQL (not `drizzle-kit generate`)

The drizzle-kit snapshots under `apps/server/drizzle/meta/` have been out of
sync since `0008`. `drizzle-kit generate` therefore emits an **incorrect diff**
and must not be trusted as the source of truth.

Crucially, the runtime migrator does **not** read the snapshots. It reads
`meta/_journal.json` (the ordered list of tags) plus each `NNNN_<tag>.sql`
file. So plain-SQL migrations are fully supported at runtime; only the
dev-time `generate` command is broken, and we don't rely on it.

`schema.ts` is still maintained as documentation of the current shape and for
drizzle-orm's TypeScript types, but it is **not** what creates migrations.

## Adding a migration

```bash
pnpm --filter @book-forge/server drizzle:new add_widgets_table
```

This computes the next index, creates `drizzle/NNNN_add_widgets_table.sql`,
and appends the matching entry to `meta/_journal.json` so the two never drift.
Then:

1. Edit the generated `.sql`. Separate statements with `--> statement-breakpoint`.
2. Update `schema.ts` to match (documentation + types).
3. Run `pnpm migrate`.

## Safety

- `pnpm migrate` snapshots the DB via `VACUUM INTO` before applying anything
  (see [`db/backup.ts`](../apps/server/src/db/backup.ts)). Backups land in
  `data/backups/` (last 10 kept). To recover: stop the server and copy a
  backup over `data/db.sqlite`.
- Drizzle wraps the whole `migrate()` call in ONE transaction, not one per
  migration file (`dialect.js`). A failing statement therefore rolls back the
  entire batch, including migrations that had already applied in this run —
  which is safer than it sounds, but it is not what «each migration runs in
  its own transaction» would mean. Write idempotent-friendly SQL
  (`IF NOT EXISTS`) where practical.
- Migrations run on server start as well as via `pnpm migrate`
  (`runMigrations` in [`db/migrate.ts`](../apps/server/src/db/migrate.ts)).
  Before that, an update without the manual command surfaced as a 500
  «no such column» on a random route.
- Virtual tables (`chunk_fts`, `chunk_vec`, `book_notes_vec`) are created by
  `bootstrapVirtualTables`, not migrations, because they depend on whether
  `sqlite-vec` loaded on this platform.

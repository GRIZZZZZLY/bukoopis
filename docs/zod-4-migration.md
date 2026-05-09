# Zod 4 migration (etap 0.2.4 — Phase 0.1)

**Date:** 2026-05-09

The monorepo upgraded from `zod@3.25` to `zod@^4.0.0` (resolved as `4.4.3`).
This was the prerequisite for etap 0.2.4 work on the Claude Agent SDK
structured-output integration — that work uses `z.toJSONSchema()`, which is
only available in Zod v4.

## Breaking changes encountered and fixed

- `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` in
  `packages/shared/src/chapter-version.ts:11`. Zod 4 requires an explicit key
  schema; existing data uses string keys (ProseMirror node attributes), so
  `z.string()` is the correct migration.
- `zod-to-json-schema` package removed from `packages/llm/`. Replaced with
  native `z.toJSONSchema(schema)` in `packages/llm/src/structured.ts`. The
  legacy `definitions`-unwrap branch is no longer needed because Zod 4's
  emitter returns the schema directly for non-recursive shapes — exactly what
  Anthropic's `tool.input_schema` expects.

No other Zod 4 categories surfaced during the migration (verified via
pre-migration grep + per-package typecheck after the bump):
- No `.passthrough()` callsites.
- No `z.string().{email,url,uuid,datetime,...}` deprecated forms.
- No `error.errors` references (`.issues` is the Zod 4 standard).
- No chained `.default(x).optional()` ordering issues.

## Verified parity

- `pnpm -r typecheck` green across 7 packages.
- `pnpm -r test` green: 157 tests pass (shared 9, llm 43, web 14, server 91)
  — same count as pre-migration baseline.
- Single `zod@4.4.3` resolved in every workspace package (`pnpm list zod -r`).
- `zod-to-json-schema` removed from `packages/llm/package.json`. It is
  retained as a transitive peer of `@langchain/langgraph` in the lockfile;
  this is unrelated to our direct usage and out of scope to remove.

## Out of scope

- Adopting Zod 4 idioms (e.g. simplified `.discriminatedUnion`,
  `z.iso.datetime()`, top-level `z.email()`/`z.url()`/`z.uuid()`) is left
  for future incremental refactors.
- Auditing whether existing schemas can be expressed more strictly under
  Zod 4 (e.g. tightening `.passthrough()`-equivalents) is also deferred.

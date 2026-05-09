# Phase 0.1 — Zod 4 Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atomically upgrade the BOOKOPIS monorepo from `zod@3.25.76` to `zod@^4.0.0` so subsequent etap-0.2.4 work (SDK structured-output integration) can use Zod 4 native APIs (`z.toJSONSchema`) without juggling two versions. All existing tests must remain green at parity (no test added or removed for migration purposes).

**Architecture:** Bump `zod` in every workspace `package.json` and `pnpm install` once. Drop the `zod-to-json-schema` dependency from `packages/llm/`. Then iterate per-package: typecheck → fix breakages by category → run tests → commit. Final pass replaces the lone `zodToJsonSchema()` call in `packages/llm/src/structured.ts` with `z.toJSONSchema()`. Single migration commit per package keeps the diff reviewable.

**Tech Stack:** TypeScript 5.7, pnpm 10.33, Vitest 2.1, Zod (3.25 → 4.x), zod-to-json-schema (removed).

---

## Pre-migration baseline (must hold after migration)

- `pnpm -r typecheck` passes across 7 packages (shared, llm, agents, style-engine, retrieval, server, web). Note `retrieval` has zero zod usage.
- `pnpm -r test` passes — **157 tests** across 22 test files (`*.test.ts` + `*.test.tsx`): 43 llm (router 15 + hybrid 4 + subscription-adapter 11 + stream-dispatch 4 + retry 6 + cache 3), 9 shared (pricing), 14 web (3 `.test.tsx` files), 91 server (12 route test files). `packages/retrieval`, `packages/agents`, `packages/style-engine` have zero test files (pass with `--passWithNoTests`).
- One known stale dependency: `zod-to-json-schema@^3.24.1` in `packages/llm/package.json` — removed by this migration.

## Files to modify

| File | Reason |
|---|---|
| `package.json` (root) | Workspace pnpm-lockfile dirty after deps change — re-install |
| `packages/shared/package.json` | Bump `zod` 3 → 4 |
| `packages/llm/package.json` | Bump `zod` 3 → 4; remove `zod-to-json-schema` |
| `packages/agents/package.json` | Bump `zod` 3 → 4 |
| `packages/style-engine/package.json` | Bump `zod` 3 → 4 |
| `apps/server/package.json` | Bump `zod` 3 → 4 |
| `apps/web/package.json` | Bump `zod` 3 → 4 (transitive from shared, but pin explicitly to avoid drift) |
| `packages/shared/src/chapter-version.ts:11` | `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` (arity-2 required in Zod 4) |
| `packages/llm/src/structured.ts:3,45` | Replace `import { zodToJsonSchema } from "zod-to-json-schema"` with native `z.toJSONSchema(...)` |
| `pnpm-lock.yaml` | Auto-updated by `pnpm install` |
| `docs/CHANGELOG.md` (or new `docs/zod-4-migration.md`) | One-line migration note |

Files **likely** to need additional fixes (revealed by typecheck after the bump — exact list cannot be enumerated until the build runs, but the categories below cover them):
- Any callsite using `error.errors` on a `ZodError` → rename to `error.issues` (Zod 4 standardised).
- Any chained `.default(x).optional()` → reorder to `.optional().default(x)`.
- Any `.passthrough()` (none found in baseline grep, but verify).
- Any deprecated top-level string validators (`z.string().email()` → `z.email()`). None found in baseline.

---

## Task 1: Capture pre-migration baseline

**Files:**
- Modify: none (read-only inventory)

- [ ] **Step 1: Run baseline typecheck**

Run: `pnpm -r typecheck`
Expected: all 7 packages green, exit 0.

- [ ] **Step 2: Run baseline tests**

Run: `pnpm -r test`
Expected: 157 tests pass across 22 test files (43 llm, 9 shared, 14 web, 91 server).

- [ ] **Step 3: Snapshot zod-touching files**

Run from repo root:

```bash
grep -rln "from [\"']zod[\"']" --include="*.ts" --include="*.tsx" packages apps 2>/dev/null | grep -v node_modules > .planning/zod-3-baseline-files.txt
wc -l .planning/zod-3-baseline-files.txt
```

Expected: 16 files listed.

- [ ] **Step 4: Snapshot known-suspicious patterns**

Run from repo root:

```bash
{
  echo "=== z.record arity ==="
  grep -rnE "z\.record\([^,)]+\)" --include="*.ts" packages apps 2>/dev/null | grep -v node_modules
  echo "=== .passthrough() ==="
  grep -rn "\.passthrough()" --include="*.ts" packages apps 2>/dev/null | grep -v node_modules
  echo "=== z.string().email/url/uuid/datetime/cuid/ulid/ip/emoji ==="
  grep -rnE "z\.string\(\)\.(email|url|uuid|datetime|cuid|ulid|ip|emoji)\(" --include="*.ts" packages apps 2>/dev/null | grep -v node_modules
  echo "=== ZodError.errors ==="
  grep -rnE "\.errors\b" --include="*.ts" packages apps 2>/dev/null | grep -v node_modules | grep -iE "ZodError|safeParse|error\.errors"
  echo "=== chained .default().optional() ==="
  grep -rnE "\.default\(.+\)\.optional\(\)" --include="*.ts" packages apps 2>/dev/null | grep -v node_modules
} > .planning/zod-3-baseline-patterns.txt
```

Expected output: `chapter-version.ts:11` for z.record arity, all other categories empty (matches inventory done in spec).

- [ ] **Step 5: No commit yet**

Baseline files in `.planning/` are read-only diagnostics — kept locally for the duration of the migration.

---

## Task 2: Bump zod in every workspace package and remove zod-to-json-schema

**Files:**
- Modify: `packages/shared/package.json`
- Modify: `packages/llm/package.json`
- Modify: `packages/agents/package.json`
- Modify: `packages/style-engine/package.json`
- Modify: `apps/server/package.json`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml` (auto)

- [ ] **Step 1: Update `packages/shared/package.json`**

Find:
```json
"dependencies": {
    "zod": "^3.24.1"
  },
```

Replace with:
```json
"dependencies": {
    "zod": "^4.0.0"
  },
```

- [ ] **Step 2: Update `packages/llm/package.json`**

Find:
```json
"dependencies": {
    "@anthropic-ai/sdk": "^0.65.0",
    "@anthropic-ai/claude-agent-sdk": "^0.2.136",
    "@book-forge/shared": "workspace:*",
    "p-retry": "^6.2.1",
    "zod": "^3.24.1",
    "zod-to-json-schema": "^3.24.1"
  },
```

Replace with:
```json
"dependencies": {
    "@anthropic-ai/sdk": "^0.65.0",
    "@anthropic-ai/claude-agent-sdk": "^0.2.136",
    "@book-forge/shared": "workspace:*",
    "p-retry": "^6.2.1",
    "zod": "^4.0.0"
  },
```

(Note: `zod-to-json-schema` line is fully removed.)

- [ ] **Step 3: Update `packages/agents/package.json`**

Find:
```json
"zod": "^3.24.1"
```

Replace with:
```json
"zod": "^4.0.0"
```

- [ ] **Step 4: Update `packages/style-engine/package.json`**

If `zod` is listed as a dep (it transitively depends via `@book-forge/shared`; explicit dep may or may not exist), bump or add:

```json
"zod": "^4.0.0"
```

If absent, leave alone — workspace resolution will pick up shared's pinned version.

- [ ] **Step 5: Update `apps/server/package.json`**

Find:
```json
"zod": "^3.24.1"
```

Replace with:
```json
"zod": "^4.0.0"
```

- [ ] **Step 6: Update `apps/web/package.json`**

If `zod` is listed, bump to `^4.0.0`. If absent (web pulls from shared), leave alone.

- [ ] **Step 7: Run install**

Run: `pnpm install --no-frozen-lockfile`
Expected: lockfile rewrite, zod resolved as v4.x, zod-to-json-schema gone from llm node_modules.

- [ ] **Step 8: Verify resolution**

Run: `pnpm list zod -r --depth=0 2>&1 | head -30`
Expected: every package showing `zod 4.x.x` (single resolved version).

- [ ] **Step 9: Verify zod-to-json-schema fully gone**

Run: `grep -rn "zod-to-json-schema" --include="*.ts" --include="*.json" packages apps 2>/dev/null | grep -v node_modules | grep -v pnpm-lock`
Expected: only `packages/llm/src/structured.ts` shows the import — this is fixed in Task 4.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/package.json packages/llm/package.json packages/agents/package.json packages/style-engine/package.json apps/server/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "chore(deps): bump zod to v4 across workspace; drop zod-to-json-schema from @book-forge/llm"
```

(Note: project is currently NOT a git repo per environment info. If git is initialised by the time this plan runs, use the commit. Otherwise skip the commit step but keep the staged-files comment as a checkpoint marker.)

---

## Task 3: Fix `packages/shared` Zod 4 breakages

**Files:**
- Modify: `packages/shared/src/chapter-version.ts:11`
- Possibly modify: any other file flagged by typecheck — categories listed below

- [ ] **Step 1: Run shared typecheck**

Run: `pnpm --filter @book-forge/shared typecheck`
Expected: errors. Capture the full error log.

- [ ] **Step 2: Fix `z.record` arity in chapter-version.ts**

Read `packages/shared/src/chapter-version.ts`. Locate line 11:

```ts
attrs: z.record(z.unknown()).optional(),
```

Replace with:

```ts
attrs: z.record(z.string(), z.unknown()).optional(),
```

(Zod 4 requires explicit key schema. Existing data has string keys — `z.string()` is the correct migration.)

- [ ] **Step 3: Categorise remaining errors**

Re-run: `pnpm --filter @book-forge/shared typecheck`

For each new error, identify its category and apply the matching fix:

| Error pattern | Fix |
|---|---|
| `Property 'errors' does not exist on type 'ZodError'` | Rename to `.issues` (Zod 4 unified field) |
| `.default()` ordering / type inference broken | Reorder so `.optional()` precedes `.default()` |
| `Argument of type 'X' is not assignable to parameter of type 'ZodTypeAny'` (refine signature) | Update `superRefine` callback shape if changed (Zod 4 narrowed the second arg) |
| `Module ... has no exported member 'ZodIssueCode'` | Replace with `z.ZodIssueCode` (still exported from `zod`, namespace import) |
| Other | Read Zod 4 changelog, apply the documented migration |

If new errors are not in this table, stop and document the unexpected breakage in `.planning/zod-3-baseline-patterns.txt` before proceeding.

- [ ] **Step 4: Re-run typecheck until green**

Run: `pnpm --filter @book-forge/shared typecheck`
Expected: zero errors.

- [ ] **Step 5: Run shared tests**

Run: `pnpm --filter @book-forge/shared test`
Expected: 9 tests pass (pricing.test.ts).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/
git commit -m "fix(shared): migrate to Zod 4 (z.record arity, ZodError.issues)"
```

---

## Task 4: Fix `packages/llm` — replace zodToJsonSchema with z.toJSONSchema

**Files:**
- Modify: `packages/llm/src/structured.ts:3-4, 45-52`

- [ ] **Step 1: Run llm typecheck**

Run: `pnpm --filter @book-forge/llm typecheck`
Expected: at minimum, error on the missing `zod-to-json-schema` import. Possibly other Zod 4 errors.

- [ ] **Step 2: Replace the import in structured.ts**

Read `packages/llm/src/structured.ts`. Find line 3:

```ts
import { zodToJsonSchema } from "zod-to-json-schema";
```

Delete it entirely.

- [ ] **Step 3: Replace the call site**

Find lines 45-52 (current shape):

```ts
const jsonSchema = zodToJsonSchema(opts.schema, opts.schemaName);
const inputSchema =
  "definitions" in jsonSchema &&
  jsonSchema.definitions &&
  typeof jsonSchema.definitions === "object" &&
  opts.schemaName in jsonSchema.definitions
    ? (jsonSchema.definitions as Record<string, unknown>)[opts.schemaName]
    : jsonSchema;
```

Replace with:

```ts
import { z } from "zod";  // ensure already imported at top of file
// ... later in the function:
const inputSchema = z.toJSONSchema(opts.schema);
```

The Zod 4 `z.toJSONSchema(schema)` returns the schema object directly without the `definitions` wrapper for non-recursive schemas — the unwrap branch is no longer needed. (Verify by inspecting one existing call's runtime output during testing.)

- [ ] **Step 4: Verify `z` import is present**

Read the top of `packages/llm/src/structured.ts`. Ensure there is an `import { z } from "zod"` (or add `import * as z from "zod"`). If a `ZodType` import already pulls from zod, add `z` to the same line:

```ts
import { z, type ZodType } from "zod";
```

- [ ] **Step 5: Re-run typecheck**

Run: `pnpm --filter @book-forge/llm typecheck`

For any remaining errors, apply the same category map as Task 3 step 3.

- [ ] **Step 6: Re-run typecheck until green**

Expected: zero errors.

- [ ] **Step 7: Run llm tests**

Run: `pnpm --filter @book-forge/llm test`
Expected: **43 tests pass** across 6 test files (router 15, hybrid 4, subscription-adapter 11, stream-dispatch 4, retry 6, cache 3).

If any test fails because the JSON schema shape changed (e.g. `submit_canon_extraction` tool description in tests), update the assertion to match the v4 output (it should be a flatter, more standard JSON Schema). Do not stub or skip the failing test — fix the assertion.

- [ ] **Step 8: Commit**

```bash
git add packages/llm/
git commit -m "fix(llm): migrate to Zod 4; use z.toJSONSchema in callStructured"
```

---

## Task 5: Fix `packages/agents` Zod 4 breakages

**Files:**
- Possibly modify: `packages/agents/src/canon-extractor.ts`
- Possibly modify: `packages/agents/src/critics/base.ts`
- Possibly modify: `packages/agents/src/plot.ts`

- [ ] **Step 1: Run agents typecheck**

Run: `pnpm --filter @book-forge/agents typecheck`

- [ ] **Step 2: Apply category-based fixes**

For each error, apply the same map as Task 3 step 3. Common to expect in this package:

- `z.object().shape` access patterns may need `.shape` (still supported in v4).
- `z.enum()` argument list still works the same.
- `z.array().min(1).max(5)` works identically.

Most agent files only consume schemas built in `@book-forge/shared`, so this package may compile clean with no fixes.

- [ ] **Step 3: Re-run typecheck until green**

Run: `pnpm --filter @book-forge/agents typecheck`
Expected: zero errors.

- [ ] **Step 4: Run agents tests**

Run: `pnpm --filter @book-forge/agents test`
Expected: zero test files (passes with `--passWithNoTests`).

- [ ] **Step 5: Commit (only if changes were needed)**

If Step 2 made any code changes:

```bash
git add packages/agents/
git commit -m "fix(agents): migrate to Zod 4"
```

If no changes were needed, skip the commit. Document this as "agents required no fixes" in the migration log.

---

## Task 6: Fix `packages/style-engine` Zod 4 breakages

**Files:**
- Possibly modify: `packages/style-engine/src/extractor.ts`

- [ ] **Step 1: Run typecheck**

Run: `pnpm --filter @book-forge/style-engine typecheck`

- [ ] **Step 2: Apply fixes by category (see Task 3 step 3)**

style-engine consumes schemas from shared. Likely compiles clean.

- [ ] **Step 3: Re-run typecheck**

Run: `pnpm --filter @book-forge/style-engine typecheck`
Expected: zero errors.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @book-forge/style-engine test`
Expected: zero test files (passes with `--passWithNoTests`).

- [ ] **Step 5: Commit (only if changes were needed)**

```bash
git add packages/style-engine/
git commit -m "fix(style-engine): migrate to Zod 4"
```

---

## Task 7: Fix `apps/server` Zod 4 breakages

**Files:**
- Possibly modify: any of `apps/server/src/routes/*.ts` using zod
- Possibly modify: `apps/server/src/db/schema.ts` if drizzle-zod integration broke

- [ ] **Step 1: Run server typecheck**

Run: `pnpm --filter @book-forge/server typecheck`

- [ ] **Step 2: Apply fixes by category**

Server uses zod for route input validation. Likely zero direct breakages because shared schemas absorb most of it. Watch for:

- Hono validator integration — if `@hono/zod-validator` or similar wrapper exists, it may need its own version bump (separate dependency, not in this etap's scope).
- `safeParseAsync` shape unchanged.

- [ ] **Step 3: Re-run typecheck**

Run: `pnpm --filter @book-forge/server typecheck`
Expected: zero errors.

- [ ] **Step 4: Run server tests**

Run: `pnpm --filter @book-forge/server test`
Expected: 91 tests across 12 route test files.

- [ ] **Step 5: Commit (only if changes were needed)**

```bash
git add apps/server/
git commit -m "fix(server): migrate to Zod 4"
```

---

## Task 8: Fix `apps/web` Zod 4 breakages

**Files:**
- Possibly modify: any web file consuming shared schemas

- [ ] **Step 1: Run web typecheck**

Run: `pnpm --filter @book-forge/web typecheck`

- [ ] **Step 2: Apply fixes by category**

Per inventory the web app has zero `from "zod"` imports — all type access goes through shared's exported types. Likely compiles clean.

- [ ] **Step 3: Re-run typecheck**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: zero errors.

- [ ] **Step 4: Run web tests**

Run: `pnpm --filter @book-forge/web test`
Expected: 14 tests pass.

- [ ] **Step 5: Commit (only if changes were needed)**

```bash
git add apps/web/
git commit -m "fix(web): migrate to Zod 4"
```

---

## Task 9: Workspace-wide verification

**Files:** none (read-only)

- [ ] **Step 1: Full workspace typecheck**

Run: `pnpm -r typecheck`
Expected: every package green, exit 0.

If any package fails, return to the relevant Task (3-8) and resolve the missed error. Do not skip.

- [ ] **Step 2: Full workspace test**

Run: `pnpm -r test`
Expected: 157 tests pass across 22 test files. Match the baseline counts:
- packages/shared: 9 tests (pricing.test.ts)
- packages/llm: 43 tests (6 files: router 15, hybrid 4, subscription-adapter 11, stream-dispatch 4, retry 6, cache 3)
- apps/web: 14 tests (3 `.test.tsx` files: useDebouncedSave, useHotkeys, UsagePage)
- apps/server: 91 tests (12 route test files)
- packages/retrieval, packages/agents, packages/style-engine: 0 test files (pass with `--passWithNoTests`)

- [ ] **Step 3: Verify single Zod version resolved**

Run: `pnpm list zod -r --depth=0 2>&1 | head -30`
Expected: every line shows `zod 4.x.x` (no v3 leakage from a missed package).

If a v3 `zod` is still resolved by some transitive dep, add `pnpm.overrides` in root `package.json`:

```json
{
  "pnpm": {
    "overrides": {
      "zod": "^4.0.0"
    }
  }
}
```

Re-run install and the resolution check.

- [ ] **Step 4: Verify zod-to-json-schema is fully gone**

Run: `grep -rn "zod-to-json-schema" --include="*.ts" --include="*.json" --include="*.yaml" packages apps 2>/dev/null | grep -v node_modules`
Expected: zero matches.

If matches exist, locate and remove (likely a missed import in a non-tested file path).

- [ ] **Step 5: Commit (if pnpm overrides were added)**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): pin zod 4 via pnpm.overrides to prevent v3 leakage"
```

---

## Task 10: Documentation note

**Files:**
- Create: `docs/zod-4-migration.md` (or append to existing `docs/CHANGELOG.md`)

- [ ] **Step 1: Write migration note**

Create `docs/zod-4-migration.md`:

```markdown
# Zod 4 migration (etap 0.2.4 — Phase 0.1)

**Date:** 2026-05-09

The monorepo upgraded from `zod@3.25` to `zod@^4.0.0`. This was the prerequisite
for etap 0.2.4 work on the Claude Agent SDK structured-output integration —
that work uses `z.toJSONSchema()` which is only available in v4.

## Breaking changes encountered and fixed

- `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` in
  `packages/shared/src/chapter-version.ts:11` (Zod 4 requires explicit key
  schema).
- `zod-to-json-schema` package removed from `packages/llm/`. Replaced with
  native `z.toJSONSchema()` in `packages/llm/src/structured.ts`.

(Add other categories here if any were encountered during Tasks 3–8.)

## Verified parity

- `pnpm -r typecheck` green.
- `pnpm -r test` green: 157 tests pass at parity with pre-migration baseline.

## Out of scope

- Adopting Zod 4 idioms (e.g. `.discriminatedUnion` simplifications,
  `z.iso.datetime()`, top-level `z.email()`/`z.url()`/`z.uuid()`) is left
  for future incremental refactors.
```

- [ ] **Step 2: Commit**

```bash
git add docs/zod-4-migration.md
git commit -m "docs: note Zod 4 migration outcome and changes"
```

---

## Done criteria (per spec §6 Phase 0.1)

- [ ] `zod` resolves to `4.x.x` in every workspace package.
- [ ] `zod-to-json-schema` is no longer a dependency anywhere in the workspace.
- [ ] `packages/llm/src/structured.ts` uses `z.toJSONSchema()` instead of `zodToJsonSchema()`.
- [ ] `pnpm -r typecheck` is green across all 7 packages.
- [ ] `pnpm -r test` passes 157 tests across 22 test files (parity with baseline).
- [ ] Migration note exists at `docs/zod-4-migration.md`.
- [ ] No SDK / structured-layer / etap-0.2.4 architecture code touched in this PR. That work belongs to Phase 0.2 and beyond — keep this PR focused.

# Studio Phase F — Plot Sees Concept + World + Lore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plot agents (`runBookPlanning`, `runChapterPlan`, `runChapterWriter`) and critic/inline agents see studio context: `BookConcept` + accepted markdown aspects from `studio_state.stages.world` + `lore`. Adds new util `loadStudioContext` + `studioContextToPrompt` and extends 3 plot agent inputs with optional `studioContext` field.

**Architecture:** New server util `apps/server/src/utils/studio-context.ts` reads concept JSON + studio_state JSON from `books` table, extracts accepted aspects from `world`/`lore` stages, and formats them as a Russian-language prompt blob. Plot/writer agent contracts get optional `studioContext: string | null` input that's injected into `buildPrompt`. Server route handlers call the util alongside existing `gatherCharacterContext`/`gatherLoreContext` and pass everything down.

**Tech Stack:** TypeScript 5.7, vitest, existing dispatchStructured pipeline.

---

## Pre-conditions

- Phases A–E merged on `main` (HEAD `7382ade`).
- 293 tests green at start.
- `BookConcept` Zod schema in shared (Phase A).
- `StudioState` Zod schema with stages.world/lore aspects (Phase A).

## Files to create

| File | Purpose |
|---|---|
| `apps/server/src/utils/studio-context.ts` | `loadStudioContext`, `studioContextToPrompt`. |
| `apps/server/src/utils/__tests__/studio-context.test.ts` | Unit tests using in-memory sqlite. |

## Files to modify

| File | Reason |
|---|---|
| `packages/agents/src/plot.ts` | Add `studioContext?: string \| null` to `GenerateBookOutlineInput` + `GenerateChapterPlanInput`; inject into prompts. |
| `packages/agents/src/writer.ts` | Add `studioContext?` to writer input + inject. |
| `apps/server/src/routes/plot.ts` | Call `loadStudioContext` and pass to outline/chapter-plan/writer. |
| `apps/server/src/routes/critique.ts` | Pass `studioContext` to critic invocations (optional). |
| `apps/server/src/routes/inline.ts` | Pass `studioContext` (optional). |

## Conventions

- `studioContext` is a single Russian-language prompt blob (or null when no concept and no accepted world/lore aspects).
- Format: `## Концепт ... ## Мир ... ## Лор ...` sections, each with subsections per aspect.
- Util is sync (reads from sqlite directly, no async).
- Tests use `makeTestApp` pattern.

---

## Task 1: `loadStudioContext` util + tests

**Files:**
- Create: `apps/server/src/utils/studio-context.ts`
- Create: `apps/server/src/utils/__tests__/studio-context.test.ts`

- [ ] **Step 1: Write failing test**

`apps/server/src/utils/__tests__/studio-context.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  loadStudioContext,
  studioContextToPrompt,
} from "../studio-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

let dbDir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "bookforge-stx-"));
  sqlite = new Database(join(dbDir, "test.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite
    .prepare(
      `INSERT INTO books (title, created_at, updated_at) VALUES ('T', ?, ?)`,
    )
    .run(new Date().toISOString(), new Date().toISOString());
});

afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("loadStudioContext", () => {
  it("returns empty when book has no concept and no studio_state", () => {
    const ctx = loadStudioContext(sqlite, 1);
    expect(ctx.concept).toBeNull();
    expect(ctx.worldAspects).toEqual([]);
    expect(ctx.loreAspects).toEqual([]);
  });

  it("loads concept from books.concept JSON", () => {
    sqlite
      .prepare("UPDATE books SET concept = ? WHERE id = ?")
      .run(
        JSON.stringify({
          schemaVersion: 1,
          genres: ["fantasy"],
          tones: ["dark"],
          audience: "adult",
          premise: { logline: "Герой ищет правду" },
        }),
        1,
      );
    const ctx = loadStudioContext(sqlite, 1);
    expect(ctx.concept?.genres).toEqual(["fantasy"]);
    expect(ctx.concept?.premise.logline).toBe("Герой ищет правду");
  });

  it("loads accepted world+lore aspects, ignoring pending/skipped/non-markdown", () => {
    const studioState = {
      schemaVersion: 1,
      revision: 5,
      stages: {
        world: {
          status: "in_progress",
          playbookGenerated: true,
          aspects: [
            {
              id: "a1",
              name: "география",
              status: "accepted",
              order: 0,
              required: true,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
              finalPayload: "Архипелаг северных островов.",
            },
            {
              id: "a2",
              name: "магия",
              status: "pending",
              order: 1,
              required: true,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
            },
          ],
        },
        lore: {
          status: "in_progress",
          playbookGenerated: true,
          aspects: [
            {
              id: "b1",
              name: "фракции",
              status: "accepted",
              order: 0,
              required: true,
              source: "llm",
              payloadKind: "markdown",
              variants: [],
              finalPayload: "Три гильдии — морская, кузнечная, певчая.",
            },
            {
              id: "b2",
              name: "артефакты_категория",
              status: "accepted",
              order: 1,
              required: false,
              source: "llm",
              payloadKind: "entity_set",
              variants: [],
              finalPayload: { candidates: [] },
            },
          ],
        },
      },
    };
    sqlite
      .prepare("UPDATE books SET studio_state = ? WHERE id = ?")
      .run(JSON.stringify(studioState), 1);
    const ctx = loadStudioContext(sqlite, 1);
    expect(ctx.worldAspects).toEqual([
      { name: "география", payload: "Архипелаг северных островов." },
    ]);
    expect(ctx.loreAspects).toEqual([
      { name: "фракции", payload: "Три гильдии — морская, кузнечная, певчая." },
    ]);
  });

  it("returns empty for unknown book id", () => {
    const ctx = loadStudioContext(sqlite, 9999);
    expect(ctx.concept).toBeNull();
    expect(ctx.worldAspects).toEqual([]);
    expect(ctx.loreAspects).toEqual([]);
  });
});

describe("studioContextToPrompt", () => {
  it("returns null when nothing to render", () => {
    const out = studioContextToPrompt({
      concept: null,
      worldAspects: [],
      loreAspects: [],
    });
    expect(out).toBeNull();
  });

  it("renders concept + world + lore in sections", () => {
    const out = studioContextToPrompt({
      concept: {
        schemaVersion: 1,
        genres: ["fantasy"],
        tones: ["dark"],
        audience: "adult",
        premise: { logline: "Герой ищет правду" },
      },
      worldAspects: [{ name: "география", payload: "Острова." }],
      loreAspects: [{ name: "фракции", payload: "Гильдии." }],
    });
    expect(out).not.toBeNull();
    expect(out!).toContain("## Концепт");
    expect(out!).toContain("fantasy");
    expect(out!).toContain("Герой ищет правду");
    expect(out!).toContain("## Мир");
    expect(out!).toContain("география");
    expect(out!).toContain("Острова.");
    expect(out!).toContain("## Лор");
    expect(out!).toContain("фракции");
  });

  it("renders only concept when no aspects", () => {
    const out = studioContextToPrompt({
      concept: {
        schemaVersion: 1,
        genres: ["thriller"],
        tones: ["tense"],
        audience: "ya",
        premise: {},
      },
      worldAspects: [],
      loreAspects: [],
    });
    expect(out).not.toBeNull();
    expect(out!).toContain("## Концепт");
    expect(out!).not.toContain("## Мир");
    expect(out!).not.toContain("## Лор");
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/server test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement util**

`apps/server/src/utils/studio-context.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookConceptSchema,
  studioStateSchema,
  type BookConcept,
} from "@book-forge/shared";

export interface StudioContextAspect {
  name: string;
  payload: string;
}

export interface StudioContext {
  concept: BookConcept | null;
  worldAspects: StudioContextAspect[];
  loreAspects: StudioContextAspect[];
}

export function loadStudioContext(
  sqlite: DatabaseType,
  bookId: number,
): StudioContext {
  const row = sqlite
    .prepare("SELECT concept, studio_state FROM books WHERE id = ?")
    .get(bookId) as
    | { concept: string | null; studio_state: string | null }
    | undefined;
  if (!row) {
    return { concept: null, worldAspects: [], loreAspects: [] };
  }
  let concept: BookConcept | null = null;
  if (row.concept) {
    try {
      concept = bookConceptSchema.parse(JSON.parse(row.concept));
    } catch {
      concept = null;
    }
  }
  let worldAspects: StudioContextAspect[] = [];
  let loreAspects: StudioContextAspect[] = [];
  if (row.studio_state) {
    try {
      const state = studioStateSchema.parse(JSON.parse(row.studio_state));
      worldAspects = extractMarkdownAspects(state.stages.world?.aspects ?? []);
      loreAspects = extractMarkdownAspects(state.stages.lore?.aspects ?? []);
    } catch {
      // ignore corrupt studio_state
    }
  }
  return { concept, worldAspects, loreAspects };
}

function extractMarkdownAspects(
  aspects: ReadonlyArray<{
    name: string;
    status: string;
    payloadKind: string;
    finalPayload?: unknown;
    order: number;
  }>,
): StudioContextAspect[] {
  return aspects
    .filter(
      (a) =>
        a.status === "accepted" &&
        a.payloadKind === "markdown" &&
        typeof a.finalPayload === "string",
    )
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((a) => ({ name: a.name, payload: a.finalPayload as string }));
}

export function studioContextToPrompt(ctx: StudioContext): string | null {
  const parts: string[] = [];

  if (ctx.concept) {
    const c = ctx.concept;
    const conceptLines: string[] = [];
    const allGenres = [...c.genres, ...(c.customGenres ?? [])];
    if (allGenres.length > 0) {
      conceptLines.push(`Жанры: ${allGenres.join(", ")}`);
    }
    const allTones = [...c.tones, ...(c.customTones ?? [])];
    if (allTones.length > 0) {
      conceptLines.push(`Тон: ${allTones.join(", ")}`);
    }
    conceptLines.push(`Аудитория: ${c.audience}`);
    if (c.premise.protagonist) {
      conceptLines.push(`Протагонист: ${c.premise.protagonist}`);
    }
    if (c.premise.conflict) {
      conceptLines.push(`Конфликт: ${c.premise.conflict}`);
    }
    if (c.premise.stakes) {
      conceptLines.push(`Ставки: ${c.premise.stakes}`);
    }
    if (c.premise.logline) {
      conceptLines.push(`Логлайн: ${c.premise.logline}`);
    }
    if (conceptLines.length > 0) {
      parts.push(`## Концепт\n${conceptLines.join("\n")}`);
    }
  }

  if (ctx.worldAspects.length > 0) {
    const blocks = ctx.worldAspects
      .map((a) => `### ${a.name}\n${a.payload}`)
      .join("\n\n");
    parts.push(`## Мир\n${blocks}`);
  }

  if (ctx.loreAspects.length > 0) {
    const blocks = ctx.loreAspects
      .map((a) => `### ${a.name}\n${a.payload}`)
      .join("\n\n");
    parts.push(`## Лор\n${blocks}`);
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @book-forge/server test
pnpm --filter @book-forge/server typecheck
git add apps/server/src/utils/studio-context.ts apps/server/src/utils/__tests__/studio-context.test.ts
git commit -m "feat(server): loadStudioContext + studioContextToPrompt — concept + world/lore for plot"
```

Expected: 7 new tests + 130 existing = 137.

---

## Task 2: Extend plot agents (outline + chapter plan)

**Files:**
- Modify: `packages/agents/src/plot.ts`

- [ ] **Step 1: Add `studioContext?: string | null` to inputs**

In `packages/agents/src/plot.ts`:

1. Update `GenerateBookOutlineInput`:

```ts
export interface GenerateBookOutlineInput {
  bookTitle: string;
  premise: string;
  language: string;
  studioContext?: string | null;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
}
```

2. Update `buildBookOutlinePrompt`. Replace existing function with:

```ts
function buildBookOutlinePrompt(input: GenerateBookOutlineInput): string {
  const variants = input.config?.variants ?? 2;
  const parts: string[] = [
    `Книга: "${input.bookTitle}"`,
    `Язык: ${input.language}`,
    `Премиса автора:\n${input.premise}`,
  ];
  if (input.studioContext) {
    parts.push(`Контекст studio:\n${input.studioContext}`);
  }
  parts.push(
    `\nСгенерируй ровно ${variants} существенно различных вариантов outline.`,
  );
  return parts.join("\n\n---\n\n");
}
```

3. Update `GenerateChapterPlanInput`:

```ts
export interface GenerateChapterPlanInput {
  bookTitle: string;
  bookPremise: string;
  bookOutline: string | null;
  studioContext?: string | null;
  chapterTitle: string;
  intent: string;
  previousChaptersSummary: string | null;
  config?: GenerationConfig;
  onUsage?: UsageHandler;
}
```

4. Update `buildChapterPlanPrompt`. Replace with:

```ts
function buildChapterPlanPrompt(input: GenerateChapterPlanInput): string {
  const variants = input.config?.variants ?? 2;
  const stableParts: string[] = [
    `Книга: "${input.bookTitle}"`,
    `Премиса: ${input.bookPremise}`,
  ];
  if (input.studioContext) {
    stableParts.push(`Контекст studio:\n${input.studioContext}`);
  }
  if (input.bookOutline) {
    stableParts.push(`Outline книги:\n${input.bookOutline}`);
  }
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Что было в предыдущих главах:\n${input.previousChaptersSummary}`,
    );
  }
  const volatileParts: string[] = [
    `Текущая глава: "${input.chapterTitle}"`,
    `Намерение автора:\n${input.intent}`,
    `Сгенерируй ровно ${variants} существенно различных beat-sheet вариантов.`,
  ];
  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @book-forge/agents typecheck
pnpm -r typecheck
git add packages/agents/src/plot.ts
git commit -m "feat(agents): plot outline + chapter plan accept studioContext input"
```

---

## Task 3: Extend writer agent

**Files:**
- Modify: `packages/agents/src/writer.ts`

- [ ] **Step 1: Find writer input type + buildPrompt**

Read `packages/agents/src/writer.ts`. Identify the writer input interface (likely `runChapterWriter` input or similar).

- [ ] **Step 2: Add `studioContext?: string | null`**

Add `studioContext?: string | null` field to the writer input interface. In its `buildPrompt`-equivalent function (or wherever the system/user prompt is assembled), inject:

```ts
  if (input.studioContext) {
    // place studioContext alongside characterContext / loreContext blocks
    parts.push(`Контекст studio:\n${input.studioContext}`);
  }
```

Place it BEFORE characterContext / loreContext sections so prompt reads: studioContext (high-level world/lore) → characterContext (specific characters) → loreContext (specific locations/items/hooks).

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @book-forge/agents typecheck
pnpm -r typecheck
git add packages/agents/src/writer.ts
git commit -m "feat(agents): writer accepts studioContext input"
```

---

## Task 4: Wire `loadStudioContext` into plot route

**Files:**
- Modify: `apps/server/src/routes/plot.ts`

- [ ] **Step 1: Add import**

In `apps/server/src/routes/plot.ts`, add near other utils imports:

```ts
import {
  loadStudioContext,
  studioContextToPrompt,
} from "../utils/studio-context.js";
```

- [ ] **Step 2: Pass studioContext in 3 places**

Find the 3 spots in this file where plot/writer agents are called: outline endpoint, chapter-plan endpoint, writer endpoint.

For each, before the agent call, add:

```ts
    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, /* bookId */));
```

(Substitute the actual `bookId` variable in scope: `id` for outline endpoint, `ch.book_id` for chapter-plan and writer endpoints.)

Then pass `studioContext: studioCtx` to the agent input. Use spread-conditional to preserve `exactOptionalPropertyTypes`:

```ts
    const variants = await runBookPlanning({
      bookTitle: ctx.title,
      premise: ctx.premise,
      language: ctx.language,
      ...(studioCtx !== null ? { studioContext: studioCtx } : {}),
      config: { ... },
      onUsage: ...,
    });
```

Same pattern for `runChapterPlan` and `runChapterWriter` calls.

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @book-forge/server typecheck
pnpm --filter @book-forge/server test
git add apps/server/src/routes/plot.ts
git commit -m "feat(server): plot route loads studioContext for outline/plan/writer"
```

---

## Task 5: (Optional) Wire studioContext into critique + inline routes

**Files:**
- Modify: `apps/server/src/routes/critique.ts`
- Modify: `apps/server/src/routes/inline.ts`

Same pattern as Task 4: import `loadStudioContext` + `studioContextToPrompt`, build studioCtx before agent invocations, pass via spread-conditional.

For critics: pass to each critic call (they likely take `bookContext` or similar — append `studioContext` text).

If critics don't currently accept a `studioContext` field — add it the same way as plot agents (Task 2 pattern). If critic prompt currently inlines `bookContext` only, append studioContext to that string.

Choose the simplest path: append studioCtx to bookContext string, no agent contract changes.

- [ ] **Step 1: Critique route**

In `apps/server/src/routes/critique.ts`, find where critic agents are invoked. Append studioContext to the bookContext string passed to critics:

```ts
    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, book.id));
    const fullBookContext = studioCtx
      ? `${book.premise ?? ""}\n\n${studioCtx}`
      : book.premise ?? "";
```

Pass `fullBookContext` where `bookContext` is currently passed.

- [ ] **Step 2: Inline route**

Same pattern.

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @book-forge/server typecheck
pnpm --filter @book-forge/server test
git add apps/server/src/routes/critique.ts apps/server/src/routes/inline.ts
git commit -m "feat(server): critique + inline routes include studioContext in bookContext"
```

---

## Task 6: Workspace verification + push

- [ ] **Step 1: Full typecheck**

Run: `pnpm -r typecheck`
Expected: 7 packages green.

- [ ] **Step 2: Full test**

Run: `pnpm -r test`
Expected: shared 50, llm 65, agents 0, server 137 (130+7), web 48 = 300 tests.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Done criteria

- [ ] `loadStudioContext(sqlite, bookId)` returns `{concept, worldAspects, loreAspects}` with markdown payloads filtered.
- [ ] `studioContextToPrompt` returns Russian-language sections or null.
- [ ] Plot agents (`outline`, `chapter_plan`, writer) accept optional `studioContext`.
- [ ] Plot route passes studioContext to all 3 agent calls.
- [ ] Critique + inline routes include studioContext in bookContext.
- [ ] `pnpm -r typecheck` and `pnpm -r test` green; total 300.
- [ ] Commits pushed to origin/main.

## Out of scope F

- Materialized characters/items context: already gathered via existing `gatherCharacterContext` (Phase E created characters in canon table — those flow naturally).
- New tests for plot/writer/critic prompts containing studioContext — covered by Task 1 unit tests + manual smoke.
- studio_events audit on plot generation — out of scope.

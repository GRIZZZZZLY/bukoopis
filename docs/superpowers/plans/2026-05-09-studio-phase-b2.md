# Studio Phase B2 — Concept Premise Puzzle (LLM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `concept_refiner` LLM agent + per-field premise puzzle UI. Each premise field (`protagonist` / `conflict` / `stakes` / `logline`) gets a "✨ Помочь сформулировать" button that calls the LLM with current concept + already-accepted earlier fields, returns 2–3 variants, lets user pick / edit / regenerate. Accepted value lands in `books.concept.premise.<field>` via existing PATCH.

**Architecture:** New agent contract in `@book-forge/agents` registered through Phase 1 dispatchStructured machinery (same pattern as `critic_canon`). New thin Hono route `POST /api/books/:id/concept/refine` calls the agent, validates input via Zod, returns variants. Web client wraps each premise textarea with a `<PremiseFieldPuzzle>` component that owns the variants flow; ConceptForm passes `bookId` + concept to enable per-field LLM calls. **No new schemas in shared** — variants live only in route response, not persisted.

**Tech Stack:** TypeScript 5.7 strict, Zod 4, Anthropic SDK / Claude Agent SDK (already wired through Phase 1), Hono 4.6, React 18, vitest 2.1 + @testing-library/react.

---

## Pre-conditions

- Phase B1 merged on `main` (HEAD `9f47a6c`).
- Phase 1 `dispatchStructured` working (subscription backend, mcp_submit_tool default).
- `pnpm -r typecheck` and `pnpm -r test` green at start (250 tests).
- `BookConcept` schema already includes `premise: { protagonist?, conflict?, stakes?, logline? }` (Phase A).
- ConceptForm already lifts `draft` state and Save flow (Phase B1).

## Files to create

| File | Purpose |
|---|---|
| `packages/agents/src/concept/refiner.ts` | `concept_refiner` contract + `runConceptRefiner(input)` wrapper. |
| `apps/server/src/routes/__tests__/concept-refine.test.ts` | Route integration test with mocked dispatchStructured. |
| `apps/web/src/components/studio/concept/PremiseFieldPuzzle.tsx` | Per-field UI: textarea + Generate button + variants list. |
| `apps/web/src/components/studio/concept/__tests__/PremiseFieldPuzzle.test.tsx` | Generate / pick / regen flow (mocked api). |

## Files to modify

| File | Reason |
|---|---|
| `packages/llm/src/types.ts` | Add `"concept_refiner"` to `AGENT_NAMES` + `STRUCTURED_AGENT_NAMES`. |
| `packages/agents/src/bootstrap.ts` | Register `registerConceptRefinerContract` at startup. |
| `apps/server/src/routes/studio.ts` | Add `POST /books/:id/concept/refine` endpoint. |
| `apps/web/src/api/client.ts` | Add `refineConceptField(bookId, field, draft?)` method. |
| `apps/web/src/components/studio/concept/ConceptForm.tsx` | Replace plain premise inputs with `<PremiseFieldPuzzle>`; pass `bookId` prop. |
| `apps/web/src/pages/StudioPage.tsx` | Pass `bookId` to `<ConceptForm>`. |

## Files NOT to modify

- `packages/shared/src/concept.ts` / `studio-state.ts` — schemas are final for Phase B2. Variants are ephemeral.
- Existing critics, plot, canon-extractor — no behavior changes here.
- `packages/llm/src/dispatcher.ts` — Phase 1 dispatcher is final.

## Conventions

- All Russian user-facing strings; agent system prompt in Russian.
- Route validates body via Zod; returns 400 on bad input, 404 on missing book, 500 on LLM error.
- Mock `dispatchStructured` in route tests via `vi.mock` so tests don't hit real LLM.
- Variants are not persisted; only the accepted text lands in `concept.premise.<field>` via existing PATCH.

---

## Task 1: Add `concept_refiner` to AgentName registry

**Files:**
- Modify: `packages/llm/src/types.ts`

- [ ] **Step 1: Edit `AGENT_NAMES` and `STRUCTURED_AGENT_NAMES`**

In `packages/llm/src/types.ts`:

1. Append `"concept_refiner"` to the `AGENT_NAMES` const array, just before the closing `] as const;`:

```ts
export const AGENT_NAMES = [
  "plot_outline",
  "plot_chapter_plan",
  "lore",
  "character",
  "writer",
  "editor",
  "inline",
  "summarizer",
  "canon_guard",
  "critic_canon",
  "critic_style",
  "critic_editor",
  "critic_reader",
  "style_extractor",
  "concept_refiner",
] as const;
```

2. Append `"concept_refiner"` to the `STRUCTURED_AGENT_NAMES` Set:

```ts
export const STRUCTURED_AGENT_NAMES: ReadonlySet<AgentName> = new Set<AgentName>([
  "critic_canon",
  "critic_style",
  "critic_editor",
  "critic_reader",
  "canon_guard",
  "plot_outline",
  "plot_chapter_plan",
  "style_extractor",
  "concept_refiner",
]);
```

- [ ] **Step 2: Verify typecheck + parity test**

Run: `pnpm --filter @book-forge/llm typecheck && pnpm --filter @book-forge/llm test`

Expected:
- typecheck: 0 errors
- The drift-guard `structured-agents-parity.test.ts` passes because `concept_refiner` is in BOTH `AGENT_NAMES` and `STRUCTURED_AGENT_NAMES` (and is NOT in the `KNOWN_FREE_TEXT_OR_NOLLM` exclusion list, which is exactly what we want — structured agents stay out of the exclusion list).
- Server `assertAllStructuredAgentsHaveContracts` will throw at startup until Task 3 registers the contract — but we don't run the server here, so tests stay green.

If parity test fails, the assertion expects every AgentName not in the exclusion list to be a structured agent. Adding `concept_refiner` to both sets satisfies it.

- [ ] **Step 3: Commit**

```bash
git add packages/llm/src/types.ts
git commit -m "feat(llm): add concept_refiner to AGENT_NAMES + STRUCTURED_AGENT_NAMES"
```

---

## Task 2: Implement `concept_refiner` contract + run function

**Files:**
- Create: `packages/agents/src/concept/refiner.ts`

The directory `packages/agents/src/concept/` does not yet exist — file creation will auto-create it.

- [ ] **Step 1: Implement the agent**

Create `packages/agents/src/concept/refiner.ts`:

```ts
import { z } from "zod";
import type { BookConcept } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export const PREMISE_FIELDS = [
  "protagonist",
  "conflict",
  "stakes",
  "logline",
] as const;
export type PremiseField = (typeof PREMISE_FIELDS)[number];

export interface ConceptRefinerInput {
  field: PremiseField;
  concept: BookConcept;
  accumulated: {
    protagonist?: string;
    conflict?: string;
    stakes?: string;
  };
  draft?: string;
}

const variantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  payload: z.string().min(1).max(2000),
});

const conceptRefinerOutputSchema = z.object({
  variants: z.array(variantSchema).min(2).max(3),
});

export type ConceptRefinerOutput = z.infer<typeof conceptRefinerOutputSchema>;
export type ConceptRefinerVariant = z.infer<typeof variantSchema>;

const FIELD_LABELS: Record<PremiseField, string> = {
  protagonist: "Протагонист",
  conflict: "Конфликт",
  stakes: "Ставки",
  logline: "Логлайн",
};

const FIELD_INSTRUCTIONS: Record<PremiseField, string> = {
  protagonist:
    'Опиши главного героя одним коротким абзацем (40–80 слов): кто он, что хочет, какая внутренняя сила или слабость определяет его выбор. Без имени, если в концепте имя не задано.',
  conflict:
    'Сформулируй центральный конфликт книги (40–80 слов): кто/что мешает протагонисту, на каком уровне (внешний/внутренний/межличностный/системный) и почему столкновение неизбежно.',
  stakes:
    'Опиши ставки одним абзацем (30–60 слов): что протагонист потеряет если проиграет, что приобретёт если победит. Делай ставки конкретными и ощутимыми, а не абстрактными ("спасёт мир").',
  logline:
    'Собери одно-двух-предложный логлайн ≤ 280 символов в формате: "Когда [инцидент], [протагонист с особенностью] должен [действие], или [последствие]." Согласуй с протагонистом, конфликтом и ставками выше.',
};

const SYSTEM = `Ты — литературный соавтор, помогающий формулировать центральный замысел книги. Работаешь на русском.

Цель — предлагать НЕСКОЛЬКО разных по углу формулировок одного и того же поля премисы, чтобы автор мог выбрать и доработать. Не один правильный ответ — а 2–3 разных направления.

Стиль: ёмко, конкретно, без штампов. Не используй "судьба мира", "избранный", "тайные силы" если этого нет в концепте автора.

Возвращай ровно 2 или 3 варианта. Каждый — независимая формулировка (не "продолжение" предыдущего, а альтернатива). У каждого есть короткий label (одно-два слова, что-то отличающее этот вариант: "героическая", "тёмная", "ироничная" и т.п.) и payload — собственно текст.`;

function genresLine(c: BookConcept): string {
  const all = [...c.genres, ...(c.customGenres ?? [])];
  return all.length > 0 ? `Жанры: ${all.join(", ")}` : "Жанры: не выбраны";
}

function tonesLine(c: BookConcept): string {
  const all = [...c.tones, ...(c.customTones ?? [])];
  return all.length > 0 ? `Тон: ${all.join(", ")}` : "Тон: не выбран";
}

function audienceLine(c: BookConcept): string {
  return `Аудитория: ${c.audience}`;
}

function buildPrompt(input: ConceptRefinerInput): string {
  const parts: string[] = [
    `Поле для генерации: ${FIELD_LABELS[input.field]}`,
    "",
    "КОНЦЕПТ:",
    genresLine(input.concept),
    tonesLine(input.concept),
    audienceLine(input.concept),
  ];

  const acc = input.accumulated;
  if (acc.protagonist) {
    parts.push("", "ПРИНЯТЫЙ ПРОТАГОНИСТ:", acc.protagonist);
  }
  if (acc.conflict) {
    parts.push("", "ПРИНЯТЫЙ КОНФЛИКТ:", acc.conflict);
  }
  if (acc.stakes) {
    parts.push("", "ПРИНЯТЫЕ СТАВКИ:", acc.stakes);
  }
  if (input.draft && input.draft.trim()) {
    parts.push("", "ЧЕРНОВИК ОТ АВТОРА (учти, не игнорируй):", input.draft.trim());
  }

  parts.push("", "ИНСТРУКЦИЯ:", FIELD_INSTRUCTIONS[input.field]);
  parts.push(
    "",
    "Сгенерируй 2–3 разных по углу варианта. Не дублируй варианты по смыслу.",
  );

  return parts.join("\n");
}

const conceptRefinerContract: AgentStructuredContract<
  ConceptRefinerInput,
  ConceptRefinerOutput
> = {
  agentName: "concept_refiner",
  getOutputSchema: () => conceptRefinerOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_concept_variants",
    toolDescription:
      "Submit 2–3 alternative formulations of one premise field (protagonist, conflict, stakes, or logline).",
  },
};

export function registerConceptRefinerContract(): void {
  registerAgentContract(conceptRefinerContract);
}

export interface RunConceptRefinerOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runConceptRefiner(
  input: ConceptRefinerInput,
  options: RunConceptRefinerOptions = {},
): Promise<ConceptRefinerOutput> {
  const { raw } = await dispatchStructured<
    ConceptRefinerInput,
    ConceptRefinerOutput
  >({
    agentName: "concept_refiner",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    maxTokens: 2048,
  });
  return raw;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @book-forge/agents typecheck`
Expected: 0 errors.

The agents package has `vitest run --passWithNoTests` so no tests required here — Task 4 covers the route integration which exercises this contract via mocks.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/concept/refiner.ts
git commit -m "feat(agents): concept_refiner contract for premise field generation"
```

---

## Task 3: Register contract in bootstrap

**Files:**
- Modify: `packages/agents/src/bootstrap.ts`

- [ ] **Step 1: Add register call**

In `packages/agents/src/bootstrap.ts`:

1. Add import alongside the existing imports:

```ts
import { registerConceptRefinerContract } from "./concept/refiner.js";
```

2. Inside `registerAllAgentContracts`, append a call:

```ts
  registerConceptRefinerContract();
```

The full function body becomes:

```ts
export function registerAllAgentContracts(): void {
  registerCanonCriticContract();
  registerStyleCriticContract();
  registerEditorCriticContract();
  registerReaderCriticContract();
  registerCanonGuardContract();
  registerPlotOutlineContract();
  registerPlotChapterPlanContract();
  registerConceptRefinerContract();
}
```

3. Update the JSDoc phase comment by adding `concept_refiner` to the listing:

```ts
 * Phase 1: critic_canon.
 * Phase 3: critic_style, critic_editor, critic_reader.
 * Phase 4: plot_outline, plot_chapter_plan, canon_guard, style_extractor.
 * Phase 5: critic_dialogue, foreshadowing_planner.
 * Phase B2 (Studio): concept_refiner.
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @book-forge/agents typecheck`
Expected: 0 errors.

Run: `pnpm --filter @book-forge/llm test`
Expected: all 65 tests still pass (parity test still aligns).

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/bootstrap.ts
git commit -m "feat(agents): register concept_refiner contract at startup"
```

---

## Task 4: Server route `POST /api/books/:id/concept/refine`

**Files:**
- Modify: `apps/server/src/routes/studio.ts`
- Create: `apps/server/src/routes/__tests__/concept-refine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/routes/__tests__/concept-refine.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the agent runner BEFORE importing the app/route, since `studio.ts`
// imports it at module load time.
vi.mock("@book-forge/agents/concept/refiner", () => ({
  runConceptRefiner: vi.fn(),
}));

import { runConceptRefiner } from "@book-forge/agents/concept/refiner";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runConceptRefiner).mockReset();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Refine test",
  });
  return r.id;
}

describe("POST /api/books/:id/concept/refine", () => {
  it("returns 404 for unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/concept/refine", "POST", {
      field: "protagonist",
    });
    expect(r.status).toBe(404);
  });

  it("returns 400 for missing field", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/refine`, "POST", {});
    expect(r.status).toBe(400);
  });

  it("returns 400 for invalid field name", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/refine`, "POST", {
      field: "weird",
    });
    expect(r.status).toBe(400);
  });

  it("calls runConceptRefiner with concept + field, returns variants", async () => {
    vi.mocked(runConceptRefiner).mockResolvedValue({
      variants: [
        { id: "v1", label: "героическая", payload: "Айрис, юный страж..." },
        { id: "v2", label: "тёмная", payload: "Айрис, отверженная..." },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{ variants: Array<{ id: string }> }>(
      t.app,
      `/api/books/${id}/concept/refine`,
      "POST",
      { field: "protagonist", draft: "Молодая страж границы" },
    );
    expect(r.variants).toHaveLength(2);
    expect(runConceptRefiner).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(runConceptRefiner).mock.calls[0]![0];
    expect(callArg.field).toBe("protagonist");
    expect(callArg.draft).toBe("Молодая страж границы");
    expect(callArg.concept.audience).toBe("adult"); // default empty concept
  });

  it("forwards accumulated earlier fields when generating later field", async () => {
    vi.mocked(runConceptRefiner).mockResolvedValue({
      variants: [
        { id: "v1", label: "a", payload: "x".repeat(20) },
        { id: "v2", label: "b", payload: "y".repeat(20) },
      ],
    });
    const id = await createBook();
    // Pre-fill protagonist + conflict via PATCH /concept
    await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      schemaVersion: 1,
      genres: [],
      tones: [],
      audience: "adult",
      premise: { protagonist: "P", conflict: "C" },
    });
    await sendJson(t.app, `/api/books/${id}/concept/refine`, "POST", {
      field: "stakes",
    });
    const callArg = vi.mocked(runConceptRefiner).mock.calls[0]![0];
    expect(callArg.accumulated.protagonist).toBe("P");
    expect(callArg.accumulated.conflict).toBe("C");
    expect(callArg.accumulated).not.toHaveProperty("stakes");
  });

  it("returns 500 when agent throws", async () => {
    vi.mocked(runConceptRefiner).mockRejectedValue(new Error("LLM failure"));
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/refine`, "POST", {
      field: "logline",
    });
    expect(r.status).toBe(500);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/server test`
Expected: FAIL — route or agent module path not found.

- [ ] **Step 3: Add the endpoint to `routes/studio.ts`**

Read `apps/server/src/routes/studio.ts` to confirm its current structure. Then make these changes:

1. Add imports near the top (alongside existing imports):

```ts
import { runConceptRefiner } from "@book-forge/agents/concept/refiner";
```

2. Add a Zod body schema near `patchStudioStateBodySchema`:

```ts
const refineFieldSchema = z.enum(["protagonist", "conflict", "stakes", "logline"]);

const refineConceptBodySchema = z.object({
  field: refineFieldSchema,
  draft: z.string().max(2000).optional(),
});
```

3. Add a new route handler INSIDE `createStudioRoute`, after the existing `r.get("/books/:id/studio-warnings", ...)` handler:

```ts
  r.post("/books/:id/concept/refine", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = refineConceptBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const accumulated: {
      protagonist?: string;
      conflict?: string;
      stakes?: string;
    } = {};
    if (parsed.data.field !== "protagonist" && concept.premise.protagonist) {
      accumulated.protagonist = concept.premise.protagonist;
    }
    if (
      (parsed.data.field === "stakes" || parsed.data.field === "logline") &&
      concept.premise.conflict
    ) {
      accumulated.conflict = concept.premise.conflict;
    }
    if (parsed.data.field === "logline" && concept.premise.stakes) {
      accumulated.stakes = concept.premise.stakes;
    }

    try {
      const result = await runConceptRefiner({
        field: parsed.data.field,
        concept,
        accumulated,
        ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
      });
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "concept_refine_failed", details: { message } },
        500,
      );
    }
  });
```

The existing imports `notFound`, `validationFailed`, `StudioBookNotFoundError`, and `z` are already present in the file. Verify when reading.

The agents package already declares `"./concept/refiner": "./src/concept/refiner.ts"` — wait, no, it currently only declares `"."` and `"./bootstrap"`. We need to either:
- (a) update `packages/agents/package.json` exports field to add `"./concept/refiner"`, OR
- (b) re-export `runConceptRefiner` from `packages/agents/src/index.ts` and import via `@book-forge/agents`.

Pick (a) — explicit subpath export:

In `packages/agents/package.json`, update the `exports` block:

```json
  "exports": {
    ".": "./src/index.ts",
    "./bootstrap": "./src/bootstrap.ts",
    "./concept/refiner": "./src/concept/refiner.ts"
  }
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/server typecheck`
Expected: 0 errors.

Run: `pnpm --filter @book-forge/server test`
Expected: PASS — 6 new concept-refine tests + 108 existing = 114 server tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/studio.ts apps/server/src/routes/__tests__/concept-refine.test.ts packages/agents/package.json
git commit -m "feat(server): POST /api/books/:id/concept/refine endpoint"
```

---

## Task 5: Web API client method

**Files:**
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Add method**

In `apps/web/src/api/client.ts`:

1. Add a type-only import (extend the existing shared import block) — but the `PremiseField` type lives in agents package; we'll declare a local mirror type to avoid pulling agents into web:

```ts
// Inside the api object methods, add:
  refineConceptField: (
    bookId: number,
    field: "protagonist" | "conflict" | "stakes" | "logline",
    draft?: string,
  ) =>
    req<{
      variants: Array<{ id: string; label: string; payload: string }>;
    }>(`/api/books/${bookId}/concept/refine`, {
      method: "POST",
      body: JSON.stringify({
        field,
        ...(draft !== undefined ? { draft } : {}),
      }),
    }),
```

The string literal union for `field` matches the server's `refineFieldSchema` exactly. Web doesn't import from `@book-forge/agents`.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/client.ts
git commit -m "feat(web): add refineConceptField API method"
```

---

## Task 6: PremiseFieldPuzzle component + tests

**Files:**
- Create: `apps/web/src/components/studio/concept/PremiseFieldPuzzle.tsx`
- Create: `apps/web/src/components/studio/concept/__tests__/PremiseFieldPuzzle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/studio/concept/__tests__/PremiseFieldPuzzle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PremiseFieldPuzzle } from "../PremiseFieldPuzzle";

interface Variant {
  id: string;
  label: string;
  payload: string;
}

interface ApiShape {
  variants: Variant[];
}

const fakeRefine = vi.fn<
  (field: string, draft?: string) => Promise<ApiShape>
>();

beforeEach(() => {
  fakeRefine.mockReset();
});

describe("PremiseFieldPuzzle", () => {
  it("renders textarea with current value and a Generate button", () => {
    render(
      <PremiseFieldPuzzle
        label="Логлайн"
        field="logline"
        value="мой черновик"
        onChange={() => {}}
        onRefine={fakeRefine}
        useTextarea
      />,
    );
    expect(screen.getByDisplayValue("мой черновик")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Помочь сформулировать/ }),
    ).toBeInTheDocument();
  });

  it("Generate calls onRefine with field + current value as draft", async () => {
    fakeRefine.mockResolvedValue({
      variants: [
        { id: "v1", label: "героическая", payload: "Героический вариант" },
        { id: "v2", label: "тёмная", payload: "Тёмный вариант" },
      ],
    });
    render(
      <PremiseFieldPuzzle
        label="Протагонист"
        field="protagonist"
        value="черновик"
        onChange={() => {}}
        onRefine={fakeRefine}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Помочь сформулировать/ }),
    );
    await waitFor(() =>
      expect(fakeRefine).toHaveBeenCalledWith("protagonist", "черновик"),
    );
    expect(screen.getByText("Героический вариант")).toBeInTheDocument();
    expect(screen.getByText("Тёмный вариант")).toBeInTheDocument();
  });

  it("clicking a variant calls onChange with payload and clears variants", async () => {
    fakeRefine.mockResolvedValue({
      variants: [
        { id: "v1", label: "a", payload: "Вариант A" },
        { id: "v2", label: "b", payload: "Вариант B" },
      ],
    });
    const onChange = vi.fn();
    render(
      <PremiseFieldPuzzle
        label="Логлайн"
        field="logline"
        value=""
        onChange={onChange}
        onRefine={fakeRefine}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Помочь сформулировать/ }),
    );
    await waitFor(() => screen.getByText("Вариант A"));
    await userEvent.click(screen.getByRole("button", { name: /Принять/ }));
    expect(onChange).toHaveBeenLastCalledWith("Вариант A");
    // Variants list should be hidden after pick.
    expect(screen.queryByText("Вариант B")).not.toBeInTheDocument();
  });

  it("renders error and recovery when onRefine rejects", async () => {
    fakeRefine.mockRejectedValue(new Error("offline"));
    render(
      <PremiseFieldPuzzle
        label="Логлайн"
        field="logline"
        value=""
        onChange={() => {}}
        onRefine={fakeRefine}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Помочь сформулировать/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/offline/),
    );
    // Generate button must be re-enabled after failure.
    expect(
      screen.getByRole("button", { name: /Помочь сформулировать/ }),
    ).toBeEnabled();
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/web test`
Expected: FAIL — `PremiseFieldPuzzle` not found.

- [ ] **Step 3: Implement `PremiseFieldPuzzle.tsx`**

Create `apps/web/src/components/studio/concept/PremiseFieldPuzzle.tsx`:

```tsx
import { useState } from "react";

export type PremiseField = "protagonist" | "conflict" | "stakes" | "logline";

interface Variant {
  id: string;
  label: string;
  payload: string;
}

interface RefineResponse {
  variants: Variant[];
}

interface Props {
  label: string;
  field: PremiseField;
  value: string;
  onChange: (next: string) => void;
  onRefine: (field: PremiseField, draft?: string) => Promise<RefineResponse>;
  /** When true, render a multi-line textarea instead of a single-line input. */
  useTextarea?: boolean;
}

export function PremiseFieldPuzzle({
  label,
  field,
  value,
  onChange,
  onRefine,
  useTextarea = false,
}: Props) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefine() {
    setError(null);
    setBusy(true);
    try {
      const draft = value.trim() || undefined;
      const r = await onRefine(field, draft);
      setVariants(r.variants);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVariants([]);
    } finally {
      setBusy(false);
    }
  }

  function pick(v: Variant) {
    onChange(v.payload);
    setVariants([]);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span>{label}</span>
        {useTextarea ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        )}
      </label>

      <div>
        <button
          type="button"
          onClick={handleRefine}
          disabled={busy}
          className={
            "text-xs border rounded-md px-2 py-1 " +
            (busy
              ? "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed"
              : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
          }
        >
          {busy ? "Генерируем…" : "✨ Помочь сформулировать"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      {variants.length > 0 && (
        <ul
          className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3"
          aria-label={`${field}-variants`}
        >
          {variants.map((v) => (
            <li key={v.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {v.label}
                </span>
                <button
                  type="button"
                  onClick={() => pick(v)}
                  className="text-xs border border-blue-600 text-blue-600 rounded px-2 py-0.5 hover:bg-blue-600 hover:text-white"
                >
                  Принять
                </button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{v.payload}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — 4 new tests in PremiseFieldPuzzle.test.tsx + 27 existing = 31 web tests.

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/concept/PremiseFieldPuzzle.tsx apps/web/src/components/studio/concept/__tests__/PremiseFieldPuzzle.test.tsx
git commit -m "feat(web): PremiseFieldPuzzle component with variants flow"
```

---

## Task 7: Wire PremiseFieldPuzzle into ConceptForm + StudioPage

**Files:**
- Modify: `apps/web/src/components/studio/concept/ConceptForm.tsx`
- Modify: `apps/web/src/pages/StudioPage.tsx`

The existing 4 plain `<input>` / `<textarea>` fields inside the premise fieldset get replaced with `<PremiseFieldPuzzle>` instances. ConceptForm needs the bookId to call the refine API, so we add a `bookId` prop and a `onRefine` callback.

- [ ] **Step 1: Edit `ConceptForm.tsx`**

Open `apps/web/src/components/studio/concept/ConceptForm.tsx`. Apply these changes:

1. Add an import:
```tsx
import { PremiseFieldPuzzle, type PremiseField } from "./PremiseFieldPuzzle";
```

2. Update the `Props` interface to add `bookId` and `onRefine`:
```tsx
interface Props {
  initialConcept: BookConcept;
  onSave: (next: BookConcept) => Promise<BookConcept>;
  onRefine: (
    field: PremiseField,
    draft?: string,
  ) => Promise<{
    variants: Array<{ id: string; label: string; payload: string }>;
  }>;
}
```

3. Update the function signature to destructure the new prop:
```tsx
export function ConceptForm({
  initialConcept,
  onSave,
  onRefine,
}: Props) {
```

4. Replace the entire `<fieldset className="flex flex-col gap-2" aria-label="Премиса">` block with:

```tsx
      <fieldset className="flex flex-col gap-3" aria-label="Премиса">
        <legend className="text-sm font-medium">Премиса</legend>

        <PremiseFieldPuzzle
          label="Протагонист"
          field="protagonist"
          value={draft.premise.protagonist ?? ""}
          onChange={(v) => patchPremise("protagonist", v)}
          onRefine={onRefine}
        />

        <PremiseFieldPuzzle
          label="Конфликт"
          field="conflict"
          value={draft.premise.conflict ?? ""}
          onChange={(v) => patchPremise("conflict", v)}
          onRefine={onRefine}
        />

        <PremiseFieldPuzzle
          label="Ставки"
          field="stakes"
          value={draft.premise.stakes ?? ""}
          onChange={(v) => patchPremise("stakes", v)}
          onRefine={onRefine}
        />

        <PremiseFieldPuzzle
          label="Логлайн"
          field="logline"
          value={draft.premise.logline ?? ""}
          onChange={(v) => patchPremise("logline", v)}
          onRefine={onRefine}
          useTextarea
        />

        <p className="text-xs text-[var(--color-muted-foreground)]">
          ✨ Кнопка под каждым полем спрашивает у LLM 2–3 альтернативы. Текущий черновик становится подсказкой.
        </p>
      </fieldset>
```

5. The existing `ConceptForm.test.tsx` from Phase B1 will break because the component now requires the `onRefine` prop. Update each `<ConceptForm ... />` invocation in the test to pass a stub:

In `apps/web/src/components/studio/concept/__tests__/ConceptForm.test.tsx`, add a stub at the top of the describe block:

```tsx
const noopRefine = vi.fn(async () => ({ variants: [] }));
```

And update every `<ConceptForm ... />` in the file to include `onRefine={noopRefine}`. There are four `render(<ConceptForm ... />)` calls. Each becomes:

```tsx
render(
  <ConceptForm
    initialConcept={c}
    onSave={...}
    onRefine={noopRefine}
  />,
);
```

The test "renders fields preloaded from initialConcept" asserts `getByDisplayValue("Тестовая премиса")` — this still works because PremiseFieldPuzzle for `logline` (which has `useTextarea`) renders a `<textarea>` with that value.

The test "Save button enables after a change…" types into `getByLabelText(/Логлайн/)` — still works because PremiseFieldPuzzle has `<label>...<span>Логлайн</span><textarea/></label>` wrapping.

- [ ] **Step 2: Edit `StudioPage.tsx`**

In `apps/web/src/pages/StudioPage.tsx`:

1. Add a refine handler before the `return`. Place it after the existing `handleSaveConcept` declaration:

```tsx
  async function handleRefine(
    field: "protagonist" | "conflict" | "stakes" | "logline",
    draft?: string,
  ) {
    return await api.refineConceptField(bookId, field, draft);
  }
```

2. Pass it to the form. Update the `<ConceptForm>` JSX:

```tsx
      <ConceptForm
        initialConcept={concept}
        onSave={handleSaveConcept}
        onRefine={handleRefine}
      />
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — all 31 web tests still pass (4 new from Task 6 + 27 existing including 4 ConceptForm tests adapted for new prop).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/studio/concept/ConceptForm.tsx apps/web/src/components/studio/concept/__tests__/ConceptForm.test.tsx apps/web/src/pages/StudioPage.tsx
git commit -m "feat(web): wire PremiseFieldPuzzle into ConceptForm + StudioPage"
```

---

## Task 8: Workspace verification + push

- [ ] **Step 1: Full typecheck**

```bash
cd "d:/PROJECTS/BOOKOPIS"
pnpm -r typecheck
```
Expected: 7 packages, all green.

- [ ] **Step 2: Full test**

```bash
pnpm -r test
```
Expected counts:
- shared: 50 (unchanged)
- llm: 65 (parity test still aligns)
- agents: 0 (passWithNoTests)
- web: 31 (27 + 4 new PremiseFieldPuzzle)
- server: 114 (108 + 6 new concept-refine)
- Total ≈ 260 tests passing.

- [ ] **Step 3: Boot dev (optional smoke)**

```bash
pnpm dev
```
Visit `/books/<id>/studio`. Click "✨ Помочь сформулировать" under "Логлайн" with empty premise. Verify network call `POST /api/books/<id>/concept/refine` returns 200 with 2-3 variants. Click "Принять" on one variant. Verify the textarea fills. Save the form. Reload — the logline persists.

If LLM is offline / `claude login` not done, expect 500 with `concept_refine_failed` — UI should show inline error.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Done criteria

- [ ] `concept_refiner` is in `AGENT_NAMES` and `STRUCTURED_AGENT_NAMES`; parity test green.
- [ ] `packages/agents/src/concept/refiner.ts` exports `registerConceptRefinerContract`, `runConceptRefiner`, `PREMISE_FIELDS`, types.
- [ ] `bootstrap.ts` calls `registerConceptRefinerContract()` so `assertAllStructuredAgentsHaveContracts()` succeeds at server startup.
- [ ] `POST /api/books/:id/concept/refine` validates body, loads concept, builds `accumulated`, calls `runConceptRefiner`, returns variants. Tests cover 200/400/404/500.
- [ ] Web `api.refineConceptField` posts to the new endpoint.
- [ ] `<PremiseFieldPuzzle>` shows textarea/input + Generate button + variants list + error state. Tests cover render, generate, pick, error.
- [ ] `<ConceptForm>` mounts 4 `<PremiseFieldPuzzle>` (one per field) and passes `onRefine` from `<StudioPage>`.
- [ ] `pnpm -r typecheck` and `pnpm -r test` green.
- [ ] All commits pushed to origin/main.

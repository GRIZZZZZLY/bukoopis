# Studio Phase E — Characters + Items Stages (entity_set + Materialize) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land per-stage pages for `characters` and `items` — empty stage → playbook proposes 3-5 entity *categories* (Протагонист, Антагонист, etc.) → per category, LLM generates 2-3 *entity sets* (each set = 1-N characters/items) → user accepts a set → reviews each candidate → materializes accepted candidates into `characters` / `items` SQLite tables.

**Architecture:** New LLM agent `aspect_entity_variants` returns 2-3 EntitySetPayload variants per category. Server playbook endpoint overrides response `payloadKind` to `"entity_set"` for characters/items stages (no agent prompt change). New server endpoint `POST /aspects/:aspectId/materialize` creates rows in canon tables. New web `<EntityStageRunner>` (mirrors AspectRunner but with entity-set workflow: review-then-materialize). New `<EntityStagePage>` mounts both PlaybookRunner + EntityStageRunner. The C1 markdown-only `<AspectRunner>` is unchanged.

**Tech Stack:** TypeScript 5.7, Zod 4, Hono 4.6, React 18, Tailwind 4, vitest 2.1, Anthropic SDK via Phase 1 dispatcher.

---

## Pre-conditions

- Phases A → D merged on `main` (HEAD `e2aa167`).
- 282 tests green at start.
- `aspect_playbook` agent works (Phase C2). Just adding server-side payloadKind override for char/items stages.
- `<PlaybookRunner>` accepts a `StageState` with any aspects (Phase D). Will be reused as-is.
- `EntitySetPayload` Zod schema already in `@book-forge/shared` (Phase A). `entityCandidateSchema` validates each candidate.
- `characters`, `locations`, `items` tables already exist with `bookId`, `canonicalName`/`name`, `profileJson` columns.

## Files to create

| File | Purpose |
|---|---|
| `packages/agents/src/aspects/entity-variants.ts` | `aspect_entity_variants` contract — returns 2-3 entity sets per category. |
| `apps/server/src/routes/__tests__/aspects-entities.test.ts` | Tests for entity generate + materialize endpoints. |
| `apps/web/src/components/studio/aspect-engine/entityAdapter.tsx` | Renders entity_set payload — list of candidate cards with profile. |
| `apps/web/src/components/studio/aspect-engine/EntityStageRunner.tsx` | Orchestration: generate → variant pick → per-candidate review → materialize. |
| `apps/web/src/components/studio/aspect-engine/__tests__/EntityStageRunner.test.tsx` | Tests for entity workflow. |
| `apps/web/src/pages/EntityStagePage.tsx` | Page wrapping PlaybookRunner + EntityStageRunner. |

## Files to modify

| File | Reason |
|---|---|
| `packages/llm/src/types.ts` | Add `aspect_entity_variants` to AGENT_NAMES + STRUCTURED_AGENT_NAMES. |
| `packages/llm/src/router.ts` | Add backend default. |
| `packages/agents/package.json` | Subpath export `./aspects/entity-variants`. |
| `packages/agents/src/bootstrap.ts` | Register new contract. |
| `apps/server/src/routes/studio.ts` | (a) override payloadKind=entity_set in `/playbook` for char/items; (b) dispatch generate by payloadKind; (c) new `/aspects/:aspectId/materialize` endpoint. |
| `apps/web/src/api/client.ts` | Add `generateAspectEntityVariants` + `materializeEntitySet` methods. |
| `apps/web/src/App.tsx` | Add route `/books/:bookId/studio/characters` and `/items`. |
| `apps/web/src/pages/StudioPage.tsx` | Add `href` for characters/items cards. |

## Files NOT to modify

- `packages/shared/src/studio-state.ts` — schemas final.
- `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx` / `PlaybookRunner.tsx` — D-final.
- Existing markdown stages in Phase D — untouched.

## Conventions

- New agent contract uses `defaultMode: "mcp_submit_tool"`, subscription backend.
- Server `/playbook` for stages `characters`/`items` overrides `payloadKind` from LLM response to `"entity_set"`. Aspect names come from LLM ("Протагонист"). Prompt unchanged.
- Server `/aspects/:aspectId/generate` dispatches by aspect's `payloadKind`: `markdown` → `runAspectVariants` (current); `entity_set` → `runAspectEntityVariants` (new).
- Server `/aspects/:aspectId/materialize` accepts `{ aspectId, candidates: Array<{tempId, accepted: boolean, mergedIntoId?}> }`. For accepted candidates without merge target, INSERT into the appropriate canon table. Returns updated payload + emits.
- Russian UI strings.
- Per Phase D pattern: `EntityStageRunner` is a controlled component, parent owns `onPatch`.

---

## Task 1: Add `aspect_entity_variants` to AGENT_NAMES

**Files:**
- Modify: `packages/llm/src/types.ts`
- Modify: `packages/llm/src/router.ts`

- [ ] **Step 1: types.ts**

Append `"aspect_entity_variants"` to `AGENT_NAMES`:

```ts
  "aspect_refine",
  "aspect_entity_variants",
] as const;
```

Append to `STRUCTURED_AGENT_NAMES`:

```ts
  "aspect_refine",
  "aspect_entity_variants",
]);
```

- [ ] **Step 2: router.ts**

Append entry:

```ts
  aspect_refine: "subscription",
  aspect_entity_variants: "subscription",
};
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @book-forge/llm typecheck && pnpm --filter @book-forge/llm test
git add packages/llm/src/types.ts packages/llm/src/router.ts
git commit -m "feat(llm): add aspect_entity_variants to AGENT_NAMES"
```

---

## Task 2: `aspect_entity_variants` contract

**Files:**
- Create: `packages/agents/src/aspects/entity-variants.ts`

The contract returns 2-3 variants where each variant payload is `EntitySetPayload` (a set of candidate entities). For characters: each candidate has `kind: "character"` + profile (name, role, age, description, background, etc.). For items: `kind: "item"` + profile (name, type, properties, description).

- [ ] **Step 1: Implement**

```ts
import { z } from "zod";
import type {
  AspectVariant,
  BookConcept,
  ContextRef,
  EntityCandidate,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export type EntityStageId = "characters" | "items";

export interface AspectEntityVariantsInput {
  stageId: EntityStageId;
  concept: BookConcept;
  /** Aspect describes the *category* (e.g. "Протагонист", "Артефакты"). */
  aspect: {
    id: string;
    name: string;
    description?: string;
  };
  accumulated: Array<{
    name: string;
    finalEntities: Array<{
      kind: "character" | "location" | "item";
      profile: unknown;
    }>;
  }>;
  contextRef: ContextRef;
}

const characterProfileSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(60),
  age: z.string().max(40).optional(),
  description: z.string().min(20).max(2000),
  background: z.string().max(2000).optional(),
});

const itemProfileSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  description: z.string().min(20).max(2000),
  properties: z.string().max(1000).optional(),
});

const characterCandidateSchema = z.object({
  tempId: z.string().min(1),
  kind: z.literal("character"),
  profile: characterProfileSchema,
});

const itemCandidateSchema = z.object({
  tempId: z.string().min(1),
  kind: z.literal("item"),
  profile: itemProfileSchema,
});

const charactersSetSchema = z.object({
  label: z.string().min(1).max(60),
  candidates: z.array(characterCandidateSchema).min(1).max(6),
});

const itemsSetSchema = z.object({
  label: z.string().min(1).max(60),
  candidates: z.array(itemCandidateSchema).min(1).max(6),
});

const charactersOutputSchema = z.object({
  variants: z.array(charactersSetSchema).min(2).max(3),
});

const itemsOutputSchema = z.object({
  variants: z.array(itemsSetSchema).min(2).max(3),
});

export type AspectEntityVariantsOutput =
  | z.infer<typeof charactersOutputSchema>
  | z.infer<typeof itemsOutputSchema>;

const SYSTEM = `Ты — литературный соавтор, генерирующий конкретных ПЕРСОНАЖЕЙ или ПРЕДМЕТЫ для книжной библии. Работаешь на русском.

Тебе дают категорию (например "Протагонист" или "Артефакты"), концепт книги, уже принятые сущности других категорий. Задача: предложить 2–3 РАЗНЫХ варианта *набора сущностей* для этой категории. Каждый вариант — независимая интерпретация категории.

Каждая сущность ИМЕНОВАНА (с конкретным именем, не "молодой воин"), имеет роль/тип, описание (минимум 20 слов), и опциональные поля.

Стиль имён: согласован с жанрами (для fantasy — мифологичный, для sci_fi — современный/футуристический и т.п.).

У каждого варианта есть короткий label (одно-два слова, что отличает: "героическая команда", "одиночка", "наёмники").

Не дублируй сущности между вариантами и не противоречь уже принятым.`;

const ENTITY_LABEL: Record<EntityStageId, string> = {
  characters: "персонажи",
  items: "предметы",
};

function buildPrompt(input: AspectEntityVariantsInput): string {
  const parts: string[] = [
    `Стадия: ${ENTITY_LABEL[input.stageId]}`,
    `Категория аспекта: ${input.aspect.name}`,
  ];
  if (input.aspect.description) {
    parts.push(`Описание: ${input.aspect.description}`);
  }
  parts.push(
    "",
    "КОНЦЕПТ:",
    `Жанры: ${[...input.concept.genres, ...(input.concept.customGenres ?? [])].join(", ") || "не выбраны"}`,
    `Тон: ${[...input.concept.tones, ...(input.concept.customTones ?? [])].join(", ") || "не выбран"}`,
    `Аудитория: ${input.concept.audience}`,
  );
  if (input.concept.premise.logline) {
    parts.push("Логлайн:", input.concept.premise.logline);
  }
  if (input.accumulated.length > 0) {
    parts.push("", "УЖЕ ПРИНЯТЫЕ СУЩНОСТИ ЭТОЙ СТАДИИ:");
    for (const a of input.accumulated) {
      parts.push(`### ${a.name}`);
      for (const e of a.finalEntities) {
        const profile = e.profile as { name?: string };
        const name = profile?.name ?? "(без имени)";
        parts.push(`- ${name} (${e.kind})`);
      }
    }
  }
  parts.push(
    "",
    `Сгенерируй 2–3 разных варианта набора *${ENTITY_LABEL[input.stageId]}* для категории "${input.aspect.name}". Каждый вариант = 1–6 именованных сущностей.`,
  );
  return parts.join("\n");
}

const aspectEntityVariantsContract: AgentStructuredContract<
  AspectEntityVariantsInput,
  AspectEntityVariantsOutput
> = {
  agentName: "aspect_entity_variants",
  getOutputSchema: (input) =>
    input.stageId === "characters"
      ? (charactersOutputSchema as unknown as z.ZodType<AspectEntityVariantsOutput>)
      : (itemsOutputSchema as unknown as z.ZodType<AspectEntityVariantsOutput>),
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_entity_variants",
    toolDescription:
      "Submit 2–3 alternative entity-set variants for a single category aspect (characters or items).",
  },
};

export function registerAspectEntityVariantsContract(): void {
  registerAgentContract(aspectEntityVariantsContract);
}

export interface RunAspectEntityVariantsOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runAspectEntityVariants(
  input: AspectEntityVariantsInput,
  options: RunAspectEntityVariantsOptions = {},
): Promise<AspectEntityVariantsOutput> {
  const { raw } = await dispatchStructured<
    AspectEntityVariantsInput,
    AspectEntityVariantsOutput
  >({
    agentName: "aspect_entity_variants",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    maxTokens: 4096,
  });
  return raw;
}

/** Helper: take server-side output and produce stored AspectVariant[]
 *  whose payload is EntitySetPayload (with auto-generated tempIds and
 *  candidate.status="proposed"). */
export function toStoredEntityVariants(
  output: AspectEntityVariantsOutput,
  meta: { contextRef: ContextRef; modelId: string },
): AspectVariant[] {
  const now = new Date().toISOString();
  return output.variants.map((v) => {
    const candidates: EntityCandidate[] = v.candidates.map((c) => ({
      tempId: c.tempId,
      kind: c.kind,
      profile: c.profile,
      status: "proposed" as const,
    }));
    return {
      id: crypto.randomUUID(),
      label: v.label,
      payloadKind: "entity_set" as const,
      payload: { candidates },
      status: "generated" as const,
      editSource: "llm" as const,
      generatedAt: now,
      modelId: meta.modelId,
      contextRef: meta.contextRef,
    };
  });
}
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @book-forge/agents typecheck
git add packages/agents/src/aspects/entity-variants.ts
git commit -m "feat(agents): aspect_entity_variants contract — 2-3 entity sets per category"
```

---

## Task 3: Register + package exports

**Files:**
- Modify: `packages/agents/package.json`
- Modify: `packages/agents/src/bootstrap.ts`

- [ ] **Step 1: package.json**

Add to `exports`:

```json
    "./aspects/refine": "./src/aspects/refine.ts",
    "./aspects/entity-variants": "./src/aspects/entity-variants.ts"
  }
```

- [ ] **Step 2: bootstrap.ts**

Add import + register call:

```ts
import { registerAspectEntityVariantsContract } from "./aspects/entity-variants.js";
```

```ts
  registerAspectRefineContract();
  registerAspectEntityVariantsContract();
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @book-forge/agents typecheck
pnpm --filter @book-forge/llm test
git add packages/agents/package.json packages/agents/src/bootstrap.ts
git commit -m "feat(agents): register aspect_entity_variants contract"
```

---

## Task 4: Server endpoints — entity dispatch + materialize + tests

**Files:**
- Modify: `apps/server/src/routes/studio.ts`
- Create: `apps/server/src/routes/__tests__/aspects-entities.test.ts`

3 server-side changes:

A) `/playbook` overrides `payloadKind` to `"entity_set"` for stages `characters`/`items`.
B) `/aspects/:aspectId/generate` dispatches by request body's `aspect.payloadKind`. If `"entity_set"`, calls `runAspectEntityVariants` and uses `toStoredEntityVariants`.
C) New endpoint `POST /api/books/:id/aspects/:aspectId/materialize` accepts `{stageId, aspectName, candidates: Array<{tempId, decision, mergedIntoId?, profile}>}` and creates rows in `characters`/`items` tables. Returns updated `EntitySetPayload` (with materializedEntityId set on accepted candidates) + `emits.entityIds`.

- [ ] **Step 1: Add helpers + the materialize endpoint**

In `apps/server/src/routes/studio.ts`, add imports:

```ts
import {
  runAspectEntityVariants,
  toStoredEntityVariants,
  type AspectEntityVariantsInput,
} from "@book-forge/agents/aspects/entity-variants";
```

After existing schemas, add:

```ts
const ENTITY_STAGES = new Set(["characters", "items"] as const);

const entityCandidateProfileSchema = z.record(z.string(), z.unknown());

const materializeBodySchema = z.object({
  stageId: z.enum(["characters", "items"]),
  aspectName: z.string().min(1).max(120),
  candidates: z.array(
    z.object({
      tempId: z.string().min(1),
      decision: z.enum(["accept", "reject"]),
      profile: entityCandidateProfileSchema,
      mergedIntoId: z.number().int().positive().optional(),
    }),
  ).min(1),
});
```

Add the materialize handler INSIDE `createStudioRoute`, after the `/refine` handler:

```ts
  r.post("/books/:id/aspects/:aspectId/materialize", async (c) => {
    const id = Number(c.req.param("id"));
    const aspectId = c.req.param("aspectId");
    const body = await c.req.json().catch(() => null);
    const parsed = materializeBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    // Verify book exists
    const bookRow = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!bookRow) return notFound(c, "book");

    const now = new Date().toISOString();
    const createdEntityIds: number[] = [];
    const candidatesAfter: Array<{
      tempId: string;
      decision: "accept" | "reject";
      materializedEntityId?: number;
      mergedIntoId?: number;
    }> = [];

    const insertChar = sqlite.prepare(
      `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertItem = sqlite.prepare(
      `INSERT INTO items (book_id, name, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const cand of parsed.data.candidates) {
      if (cand.decision === "reject") {
        candidatesAfter.push({
          tempId: cand.tempId,
          decision: "reject",
        });
        continue;
      }
      if (cand.mergedIntoId !== undefined) {
        // Merge: do not insert; record the existing ID
        candidatesAfter.push({
          tempId: cand.tempId,
          decision: "accept",
          mergedIntoId: cand.mergedIntoId,
        });
        continue;
      }
      // Insert new entity
      const profileJson = JSON.stringify(cand.profile);
      let entityId: number;
      if (parsed.data.stageId === "characters") {
        const profile = cand.profile as { name?: unknown };
        const name = typeof profile.name === "string" ? profile.name : "Без имени";
        const info = insertChar.run(id, name, profileJson, now, now);
        entityId = Number(info.lastInsertRowid);
      } else {
        const profile = cand.profile as { name?: unknown };
        const name = typeof profile.name === "string" ? profile.name : "Без имени";
        const info = insertItem.run(id, name, profileJson, now, now);
        entityId = Number(info.lastInsertRowid);
      }
      createdEntityIds.push(entityId);
      candidatesAfter.push({
        tempId: cand.tempId,
        decision: "accept",
        materializedEntityId: entityId,
      });
    }

    return c.json({
      aspectId,
      createdEntityIds,
      candidates: candidatesAfter,
    });
  });
```

- [ ] **Step 2: Modify `/playbook` to override payloadKind for entity stages**

Find the `r.post("/books/:id/stages/:stageId/playbook", ...)` handler. Inside the success branch (before `return c.json({ aspects: result.aspects, contextRef })`), add override logic:

```ts
      const isEntity = ENTITY_STAGES.has(stageParse.data as "characters" | "items");
      const aspects = isEntity
        ? result.aspects.map((a) => ({ ...a, payloadKind: "entity_set" as const }))
        : result.aspects;
      return c.json({ aspects, contextRef });
```

Replace the existing `return c.json({ aspects: result.aspects, contextRef });` with this.

- [ ] **Step 3: Modify `/generate` to dispatch by payloadKind**

Find the `r.post("/books/:id/stages/:stageId/aspects/:aspectId/generate", ...)` handler. Update its `generateAspectBodySchema` (or create separate `generateEntityBodySchema`) — but easier to keep one schema and add `payloadKind` to body:

Update `generateAspectBodySchema`:

```ts
const generateAspectBodySchema = z.object({
  aspect: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    payloadKind: z.enum(["markdown", "entity_set"]).optional(),
  }),
  accumulated: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      finalPayload: z.unknown(),
    }),
  ),
  draft: z.string().max(2000).optional(),
});
```

Note: `finalPayload: z.unknown()` because entity_set context has structured data, not just strings.

In the handler body, after `parsed.success` check and `concept` load, ADD a dispatch branch:

```ts
    const stageId = stageParse.data;
    const payloadKind = parsed.data.aspect.payloadKind ?? "markdown";

    if (payloadKind === "entity_set") {
      if (stageId !== "characters" && stageId !== "items") {
        return c.json(
          { error: "stage_not_entity", details: { stageId } },
          400,
        );
      }
      const accumulatedEntities = parsed.data.accumulated
        .map((a) => {
          const fp = a.finalPayload;
          if (!fp || typeof fp !== "object") return null;
          const candidates = (fp as { candidates?: unknown }).candidates;
          if (!Array.isArray(candidates)) return null;
          const finalEntities = (candidates as Array<{
            kind?: "character" | "location" | "item";
            profile?: unknown;
            status?: string;
          }>)
            .filter((c) => c.status === "accepted" || c.status === "merged")
            .map((c) => ({
              kind: c.kind ?? "character",
              profile: c.profile,
            }));
          return { name: a.name, finalEntities };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const contextRefEntity = buildContextRef({
        stageId,
        concept,
        accumulated: parsed.data.accumulated.map((a) => ({
          id: a.id,
          name: a.name,
          finalPayload: JSON.stringify(a.finalPayload),
        })),
        extra: { kind: "entity_variants", aspectId: parsed.data.aspect.id },
      });
      try {
        const result = await runAspectEntityVariants({
          stageId,
          concept,
          aspect: parsed.data.aspect,
          accumulated: accumulatedEntities,
          contextRef: contextRefEntity,
        });
        const variants = toStoredEntityVariants(result, {
          contextRef: contextRefEntity,
          modelId: "subscription:claude-sonnet-4-6",
        });
        return c.json({ variants, contextRef: contextRefEntity });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return c.json(
          { error: "aspect_entity_variants_failed", details: { message } },
          500,
        );
      }
    }

    // Existing markdown path follows...
```

The existing markdown branch (calling `runAspectVariants`) stays as-is, runs only when `payloadKind === "markdown"`. The accumulated mapping for markdown stays:
```ts
        accumulated: parsed.data.accumulated.map((a) => ({
          name: a.name,
          finalPayload: typeof a.finalPayload === "string" ? a.finalPayload : JSON.stringify(a.finalPayload),
        })),
```

(keep this conversion to handle `finalPayload: z.unknown()` correctly — markdown stages still pass strings)

- [ ] **Step 4: Tests**

Create `apps/server/src/routes/__tests__/aspects-entities.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/aspects/playbook", () => ({
  runAspectPlaybook: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/variants", async () => {
  const actual = await vi.importActual<
    typeof import("@book-forge/agents/aspects/variants")
  >("@book-forge/agents/aspects/variants");
  return { runAspectVariants: vi.fn(), toStoredVariants: actual.toStoredVariants };
});
vi.mock("@book-forge/agents/aspects/refine", async () => {
  const actual = await vi.importActual<
    typeof import("@book-forge/agents/aspects/refine")
  >("@book-forge/agents/aspects/refine");
  return { runAspectRefine: vi.fn(), toStoredRefinedVariant: actual.toStoredRefinedVariant };
});
vi.mock("@book-forge/agents/aspects/entity-variants", async () => {
  const actual = await vi.importActual<
    typeof import("@book-forge/agents/aspects/entity-variants")
  >("@book-forge/agents/aspects/entity-variants");
  return {
    runAspectEntityVariants: vi.fn(),
    toStoredEntityVariants: actual.toStoredEntityVariants,
  };
});

import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import { runAspectEntityVariants } from "@book-forge/agents/aspects/entity-variants";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runAspectPlaybook).mockReset();
  vi.mocked(runAspectEntityVariants).mockReset();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Entity test",
  });
  return r.id;
}

describe("playbook overrides payloadKind for entity stages", () => {
  it("/stages/characters/playbook returns aspects with payloadKind=entity_set", async () => {
    vi.mocked(runAspectPlaybook).mockResolvedValue({
      aspects: [
        { name: "Протагонист", description: "герой книги", required: true, payloadKind: "markdown" },
        { name: "Антагонист", description: "противник", required: true, payloadKind: "markdown" },
        { name: "Спутники", description: "союзники", required: false, payloadKind: "markdown" },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{
      aspects: Array<{ payloadKind: string }>;
    }>(t.app, `/api/books/${id}/stages/characters/playbook`, "POST", {});
    expect(r.aspects).toHaveLength(3);
    for (const a of r.aspects) {
      expect(a.payloadKind).toBe("entity_set");
    }
  });

  it("/stages/world/playbook still returns markdown aspects", async () => {
    vi.mocked(runAspectPlaybook).mockResolvedValue({
      aspects: [
        { name: "география", description: "земли", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила", required: true, payloadKind: "markdown" },
        { name: "технологии", description: "уровень", required: false, payloadKind: "markdown" },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{ aspects: Array<{ payloadKind: string }> }>(
      t.app,
      `/api/books/${id}/stages/world/playbook`,
      "POST",
      {},
    );
    for (const a of r.aspects) {
      expect(a.payloadKind).toBe("markdown");
    }
  });
});

describe("/aspects/:aspectId/generate dispatches by payloadKind", () => {
  it("entity_set payloadKind → calls runAspectEntityVariants", async () => {
    vi.mocked(runAspectEntityVariants).mockResolvedValue({
      variants: [
        {
          label: "героические",
          candidates: [
            {
              tempId: "t1",
              kind: "character",
              profile: {
                name: "Айрис",
                role: "protagonist",
                description: "Молодая страж границы, выросшая в горном монастыре среди старых рукописей и мечей.",
              },
            },
          ],
        },
        {
          label: "тёмные",
          candidates: [
            {
              tempId: "t2",
              kind: "character",
              profile: {
                name: "Кеан",
                role: "protagonist",
                description: "Бывший палач, ищущий искупления после пятнадцати лет на службе тирана.",
              },
            },
          ],
        },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{
      variants: Array<{ payloadKind: string; payload: { candidates: Array<{ tempId: string }> } }>;
    }>(
      t.app,
      `/api/books/${id}/stages/characters/aspects/asp1/generate`,
      "POST",
      {
        aspect: { id: "asp1", name: "Протагонист", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    expect(r.variants).toHaveLength(2);
    expect(r.variants[0]!.payloadKind).toBe("entity_set");
    expect(r.variants[0]!.payload.candidates[0]!.tempId).toBe("t1");
  });

  it("entity_set on non-entity stage → 400", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/generate`,
      "POST",
      {
        aspect: { id: "asp1", name: "география", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    expect(r.status).toBe(400);
  });
});

describe("/aspects/:aspectId/materialize", () => {
  it("creates character rows for accepted candidates and returns ids", async () => {
    const id = await createBook();
    const r = await sendJson<{
      aspectId: string;
      createdEntityIds: number[];
      candidates: Array<{ tempId: string; decision: string; materializedEntityId?: number }>;
    }>(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Протагонист",
        candidates: [
          {
            tempId: "t1",
            decision: "accept",
            profile: { name: "Айрис", role: "protagonist", description: "Молодая страж границы, выросшая в горном монастыре." },
          },
          {
            tempId: "t2",
            decision: "reject",
            profile: { name: "Кеан", role: "protagonist", description: "skipped" },
          },
        ],
      },
    );
    expect(r.createdEntityIds).toHaveLength(1);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]!.materializedEntityId).toBeDefined();
    expect(r.candidates[1]!.materializedEntityId).toBeUndefined();
  });

  it("creates item rows on items stageId", async () => {
    const id = await createBook();
    const r = await sendJson<{
      createdEntityIds: number[];
    }>(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "items",
        aspectName: "Артефакты",
        candidates: [
          {
            tempId: "t1",
            decision: "accept",
            profile: { name: "Меч Заката", type: "оружие", description: "Древний клинок, поглощающий свет." },
          },
        ],
      },
    );
    expect(r.createdEntityIds).toHaveLength(1);
  });

  it("returns 404 for unknown book", async () => {
    const r = await send(
      t.app,
      `/api/books/9999/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "x",
        candidates: [
          { tempId: "t1", decision: "accept", profile: { name: "x", description: "Достаточно длинное описание чтобы пройти валидацию." } },
        ],
      },
    );
    expect(r.status).toBe(404);
  });

  it("returns 400 for invalid stageId", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "world",
        aspectName: "x",
        candidates: [{ tempId: "t1", decision: "accept", profile: { name: "x" } }],
      },
    );
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 5: Verify + commit**

```bash
pnpm --filter @book-forge/server test
pnpm --filter @book-forge/server typecheck
git add apps/server/src/routes/studio.ts apps/server/src/routes/__tests__/aspects-entities.test.ts
git commit -m "feat(server): entity_set generate dispatch + materialize endpoint"
```

Expected: 7 new tests + 122 existing = 129 server tests.

---

## Task 5: Web SDK methods

**Files:**
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Add methods**

In the `api` object literal, after `refineAspectVariant`, add:

```ts
  generateAspectEntityVariants: (
    bookId: number,
    stageId: "characters" | "items",
    aspectId: string,
    body: {
      aspect: { id: string; name: string; description?: string; payloadKind: "entity_set" };
      accumulated: Array<{ id: string; name: string; finalPayload: unknown }>;
    },
  ) =>
    req<{
      variants: Array<{
        id: string;
        label: string;
        payloadKind: "entity_set";
        payload: {
          candidates: Array<{
            tempId: string;
            kind: "character" | "location" | "item";
            profile: unknown;
            status: "proposed";
          }>;
        };
        status: "generated";
        editSource: "llm";
        generatedAt: string;
        modelId: string;
        contextRef: {
          hash: string;
          summary: string;
          includedAspectIds: string[];
          includedEntityIds: string[];
        };
      }>;
      contextRef: {
        hash: string;
        summary: string;
        includedAspectIds: string[];
        includedEntityIds: string[];
      };
    }>(
      `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/generate`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  materializeEntitySet: (
    bookId: number,
    aspectId: string,
    body: {
      stageId: "characters" | "items";
      aspectName: string;
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        profile: unknown;
        mergedIntoId?: number;
      }>;
    },
  ) =>
    req<{
      aspectId: string;
      createdEntityIds: number[];
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        materializedEntityId?: number;
        mergedIntoId?: number;
      }>;
    }>(`/api/books/${bookId}/aspects/${aspectId}/materialize`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm --filter @book-forge/web typecheck
git add apps/web/src/api/client.ts
git commit -m "feat(web): generateAspectEntityVariants + materializeEntitySet SDK methods"
```

---

## Task 6: Entity adapter + LLM entity generator factory

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/entityAdapter.tsx`
- Modify: `apps/web/src/components/studio/aspect-engine/llmGenerators.ts`

- [ ] **Step 1: Create `entityAdapter.tsx`**

```tsx
import { z } from "zod";
import type { StageAdapter } from "./types.js";

const candidateSchema = z.object({
  tempId: z.string(),
  kind: z.enum(["character", "location", "item"]),
  profile: z.record(z.string(), z.unknown()),
  status: z.enum(["proposed", "accepted", "rejected", "merged"]),
  materializedEntityId: z.number().optional(),
  mergedIntoEntityId: z.number().optional(),
});

const entitySetPayloadSchema = z.object({
  candidates: z.array(candidateSchema),
});

type EntitySetPayload = z.infer<typeof entitySetPayloadSchema>;

function renderCandidate(c: EntitySetPayload["candidates"][number]): React.ReactNode {
  const profile = c.profile as { name?: string; role?: string; type?: string; description?: string };
  return (
    <li key={c.tempId} className="flex flex-col gap-0.5">
      <span className="text-sm font-medium">
        {profile.name ?? "Без имени"}
        {profile.role && (
          <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
            {profile.role}
          </span>
        )}
        {profile.type && (
          <span className="text-xs text-[var(--color-muted-foreground)] ml-2">
            {profile.type}
          </span>
        )}
      </span>
      {profile.description && (
        <span className="text-xs text-[var(--color-muted-foreground)]">
          {profile.description}
        </span>
      )}
    </li>
  );
}

export function createEntityAdapter(
  stageId: "characters" | "items",
): StageAdapter<EntitySetPayload> {
  return {
    stageId,
    payloadKind: "entity_set",
    payloadSchema: entitySetPayloadSchema,
    renderVariant: (payload) => (
      <ul className="flex flex-col gap-2 pl-2">
        {payload.candidates.map(renderCandidate)}
      </ul>
    ),
    renderFinal: (payload) => (
      <ul className="flex flex-col gap-2 rounded bg-[var(--color-muted)] px-3 py-2">
        {payload.candidates
          .filter((c) => c.status === "accepted" || c.status === "merged")
          .map((c) => {
            const profile = c.profile as { name?: string };
            const idChip = c.materializedEntityId
              ? `#${c.materializedEntityId}`
              : c.mergedIntoEntityId
                ? `→ #${c.mergedIntoEntityId}`
                : "";
            return (
              <li key={c.tempId} className="text-sm">
                {profile.name ?? "Без имени"}{" "}
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {idChip}
                </span>
              </li>
            );
          })}
      </ul>
    ),
  };
}
```

- [ ] **Step 2: Add LLM entity variant generator to `llmGenerators.ts`**

Append to `apps/web/src/components/studio/aspect-engine/llmGenerators.ts`:

```ts
import type { EntitySetPayload as EntitySetPayloadType } from "@book-forge/shared";

/** LLM-backed VariantGenerator for entity_set stages (characters/items). */
export function createLLMEntityVariantGenerator(args: {
  bookId: number;
  stageId: "characters" | "items";
}): VariantGenerator<EntitySetPayloadType> {
  return {
    async generate(input) {
      if (input.refineFrom) {
        throw new Error("refine for entity_set not supported in Phase E");
      }
      const r = await api.generateAspectEntityVariants(
        args.bookId,
        args.stageId,
        input.aspect.id,
        {
          aspect: {
            id: input.aspect.id,
            name: input.aspect.name,
            ...(input.aspect.description !== undefined
              ? { description: input.aspect.description }
              : {}),
            payloadKind: "entity_set",
          },
          accumulated: input.accumulated.acceptedAspects.map((a) => ({
            id: a.id,
            name: a.name,
            finalPayload: a.finalPayload,
          })),
        },
      );
      return r.variants;
    },
  };
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @book-forge/web typecheck
git add apps/web/src/components/studio/aspect-engine/entityAdapter.tsx apps/web/src/components/studio/aspect-engine/llmGenerators.ts
git commit -m "feat(web): entity StageAdapter + LLM entity variant generator factory"
```

---

## Task 7: EntityStageRunner component + tests

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/EntityStageRunner.tsx`
- Create: `apps/web/src/components/studio/aspect-engine/__tests__/EntityStageRunner.test.tsx`

The component handles entity workflow: per pending aspect → generate variants → pick variant (which sets aspect.selectedVariantId, status=reviewing) → per-candidate review (accept/reject toggles) → "Materialize" button calls api → updates aspect to status=accepted with emits.

For Phase E v1, simplification: when user clicks "Принять" on a variant, automatically:
1. Set aspect.selectedVariantId, mark candidates with `status: "proposed"` (already so)
2. Show per-candidate accept/reject toggles
3. "Materialize" button → calls api.materializeEntitySet → on success: set aspect.status=accepted, aspect.finalPayload={candidates: [...with materializedEntityId or rejected]}, aspect.emits.entityIds.

Skip refine for entity stages (out of scope E v1).

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/studio/aspect-engine/__tests__/EntityStageRunner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { EntityStageRunner } from "../EntityStageRunner";

function makeAspect(partial?: Partial<StageAspect>): StageAspect {
  return {
    id: "asp1",
    name: "Протагонист",
    status: "pending",
    order: 0,
    required: true,
    source: "llm",
    payloadKind: "entity_set",
    variants: [],
    ...partial,
  };
}

function makeStage(aspects: StageAspect[]): StageState {
  return {
    status: "in_progress",
    playbookGenerated: true,
    aspects,
  };
}

const generator = {
  generate: vi.fn(),
};

const materialize = vi.fn();

beforeEach(() => {
  generator.generate.mockReset();
  materialize.mockReset();
});

describe("EntityStageRunner", () => {
  it("pending aspect shows Generate button", () => {
    render(
      <EntityStageRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        stageId="characters"
        generator={generator as never}
        onPatch={vi.fn()}
        onMaterialize={materialize}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    ).toBeInTheDocument();
  });

  it("clicking Принять on variant enters review-entities mode", async () => {
    const reviewing = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "героические",
          payloadKind: "entity_set",
          payload: {
            candidates: [
              {
                tempId: "t1",
                kind: "character",
                profile: { name: "Айрис", role: "protagonist", description: "x" },
                status: "proposed",
              },
              {
                tempId: "t2",
                kind: "character",
                profile: { name: "Кеан", role: "protagonist", description: "y" },
                status: "proposed",
              },
            ],
          },
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <EntityStageRunner
        stage={makeStage([reviewing])}
        revision={0}
        stageId="characters"
        generator={generator as never}
        onPatch={onPatch}
        onMaterialize={materialize}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Принять/ }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    // selectedVariantId set, status remains reviewing for entity review
    expect(next.aspects[0]!.selectedVariantId).toBe("v1");
    expect(next.aspects[0]!.status).toBe("reviewing");
  });

  it("Materialize calls onMaterialize with candidates and patches aspect to accepted", async () => {
    const reviewing = makeAspect({
      status: "reviewing",
      selectedVariantId: "v1",
      variants: [
        {
          id: "v1",
          label: "героические",
          payloadKind: "entity_set",
          payload: {
            candidates: [
              {
                tempId: "t1",
                kind: "character",
                profile: { name: "Айрис", role: "protagonist", description: "x" },
                status: "proposed",
              },
            ],
          },
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    materialize.mockResolvedValue({
      aspectId: "asp1",
      createdEntityIds: [42],
      candidates: [
        { tempId: "t1", decision: "accept", materializedEntityId: 42 },
      ],
    });
    render(
      <EntityStageRunner
        stage={makeStage([reviewing])}
        revision={0}
        stageId="characters"
        generator={generator as never}
        onPatch={onPatch}
        onMaterialize={materialize}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Материализовать/ }),
    );
    await waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.status).toBe("accepted");
    expect(next.aspects[0]!.emits?.entityIds).toEqual([42]);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/web test`
Expected: FAIL — `EntityStageRunner` not found.

- [ ] **Step 3: Implement `EntityStageRunner.tsx`**

```tsx
import { useState } from "react";
import type { StageAspect, StageState } from "@book-forge/shared";
import type { VariantGenerator } from "./types.js";
import { createEntityAdapter } from "./entityAdapter";

interface EntitySetPayload {
  candidates: Array<{
    tempId: string;
    kind: "character" | "location" | "item";
    profile: unknown;
    status: "proposed" | "accepted" | "rejected" | "merged";
    materializedEntityId?: number;
    mergedIntoEntityId?: number;
  }>;
}

interface MaterializeResult {
  aspectId: string;
  createdEntityIds: number[];
  candidates: Array<{
    tempId: string;
    decision: "accept" | "reject";
    materializedEntityId?: number;
    mergedIntoId?: number;
  }>;
}

interface Props {
  stage: StageState;
  revision: number;
  stageId: "characters" | "items";
  generator: VariantGenerator<EntitySetPayload>;
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
  onMaterialize: (
    aspectId: string,
    body: {
      stageId: "characters" | "items";
      aspectName: string;
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        profile: unknown;
      }>;
    },
  ) => Promise<MaterializeResult>;
}

export function EntityStageRunner({
  stage,
  revision,
  stageId,
  generator,
  onPatch,
  onMaterialize,
}: Props) {
  const adapter = createEntityAdapter(stageId);
  const [busyAspectId, setBusyAspectId] = useState<string | null>(null);
  const [errorByAspect, setErrorByAspect] = useState<Record<string, string>>({});
  const [pendingDecisions, setPendingDecisions] = useState<
    Record<string, Record<string, "accept" | "reject">>
  >({});

  if (stage.aspects.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        В стадии нет аспектов. Запустите генерацию плейбука.
      </p>
    );
  }

  function buildAccumulated(skip: string): Array<{
    id: string;
    name: string;
    finalPayload: unknown;
  }> {
    return stage.aspects
      .filter(
        (a) =>
          a.status === "accepted" &&
          a.id !== skip &&
          a.finalPayload !== undefined,
      )
      .sort((a, b) => a.order - b.order)
      .map((a) => ({
        id: a.id,
        name: a.name,
        finalPayload: a.finalPayload,
      }));
  }

  function buildNextStage(
    updater: (a: StageAspect) => StageAspect,
    aspectId: string,
  ): StageState {
    return {
      ...stage,
      status: stage.status === "not_started" ? "in_progress" : stage.status,
      aspects: stage.aspects.map((a) => (a.id === aspectId ? updater(a) : a)),
      updatedAt: new Date().toISOString(),
    };
  }

  async function handleGenerate(aspect: StageAspect): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const variants = await generator.generate({
        aspect,
        accumulated: { acceptedAspects: buildAccumulated(aspect.id) },
      });
      const next = buildNextStage(
        (a) => ({
          ...a,
          status: "reviewing" as const,
          variants,
          ...(a.selectedVariantId !== undefined
            ? { selectedVariantId: undefined }
            : {}),
        }),
        aspect.id,
      );
      await onPatch(revision, next);
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  async function handlePickVariant(
    aspect: StageAspect,
    variantId: string,
  ): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const next = buildNextStage(
        (a) => ({ ...a, selectedVariantId: variantId }),
        aspect.id,
      );
      await onPatch(revision, next);
      // Initialize pending decisions = all accept by default
      const variant = aspect.variants.find((v) => v.id === variantId);
      const payload = variant?.payload as EntitySetPayload | undefined;
      if (payload) {
        const init: Record<string, "accept" | "reject"> = {};
        for (const c of payload.candidates) init[c.tempId] = "accept";
        setPendingDecisions((p) => ({ ...p, [aspect.id]: init }));
      }
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  function toggleCandidate(aspectId: string, tempId: string): void {
    setPendingDecisions((p) => {
      const current = p[aspectId] ?? {};
      const cur = current[tempId] ?? "accept";
      return {
        ...p,
        [aspectId]: {
          ...current,
          [tempId]: cur === "accept" ? "reject" : "accept",
        },
      };
    });
  }

  async function handleMaterialize(aspect: StageAspect): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const variant = aspect.variants.find(
        (v) => v.id === aspect.selectedVariantId,
      );
      if (!variant) throw new Error("Вариант не выбран");
      const payload = variant.payload as EntitySetPayload;
      const decisions = pendingDecisions[aspect.id] ?? {};
      const candidatesForApi = payload.candidates.map((c) => ({
        tempId: c.tempId,
        decision: decisions[c.tempId] ?? ("accept" as const),
        profile: c.profile,
      }));
      const result = await onMaterialize(aspect.id, {
        stageId,
        aspectName: aspect.name,
        candidates: candidatesForApi,
      });
      // Build finalPayload + emits from result
      const tempIdToResult = new Map(result.candidates.map((c) => [c.tempId, c]));
      const updatedCandidates = payload.candidates.map((c) => {
        const r = tempIdToResult.get(c.tempId);
        if (!r) return c;
        if (r.decision === "reject") {
          return { ...c, status: "rejected" as const };
        }
        return {
          ...c,
          status: "accepted" as const,
          ...(r.materializedEntityId !== undefined
            ? { materializedEntityId: r.materializedEntityId }
            : {}),
          ...(r.mergedIntoId !== undefined
            ? { mergedIntoEntityId: r.mergedIntoId }
            : {}),
        };
      });
      const next = buildNextStage(
        (a) => ({
          ...a,
          status: "accepted" as const,
          finalPayload: { candidates: updatedCandidates },
          variants: a.variants.map((v) =>
            v.id === aspect.selectedVariantId
              ? { ...v, status: "accepted" as const, payload: { candidates: updatedCandidates } }
              : v.status === "accepted"
                ? { ...v, status: "rejected" as const }
                : v,
          ),
          emits: {
            kind: stageId === "characters" ? "character" : "item",
            entityIds: result.createdEntityIds,
          },
        }),
        aspect.id,
      );
      await onPatch(revision, next);
      setPendingDecisions((p) => {
        const copy = { ...p };
        delete copy[aspect.id];
        return copy;
      });
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  async function handleSkip(aspect: StageAspect): Promise<void> {
    const next = buildNextStage(
      (a) => ({ ...a, status: "skipped" as const }),
      aspect.id,
    );
    setBusyAspectId(aspect.id);
    try {
      await onPatch(revision, next);
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }

  return (
    <ul
      aria-label="entity-aspects"
      className="flex flex-col gap-4 border border-[var(--color-border)] rounded-lg p-4"
    >
      {stage.aspects.map((aspect) => {
        const busy = busyAspectId === aspect.id;
        const err = errorByAspect[aspect.id];
        const selectedVariant = aspect.variants.find(
          (v) => v.id === aspect.selectedVariantId,
        );
        const decisions = pendingDecisions[aspect.id] ?? {};
        return (
          <li key={aspect.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{aspect.name}</span>
              <span className="text-xs uppercase text-[var(--color-muted-foreground)]">
                {aspect.status}
              </span>
            </div>
            {aspect.description && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {aspect.description}
              </p>
            )}

            {aspect.status === "pending" && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerate(aspect)}
                  disabled={busy}
                  className="text-sm border border-blue-600 text-blue-600 rounded-md px-3 py-1 hover:bg-blue-600 hover:text-white disabled:opacity-50"
                >
                  {busy ? "Генерируем…" : "Сгенерировать варианты"}
                </button>
                <button
                  type="button"
                  onClick={() => handleSkip(aspect)}
                  disabled={busy}
                  className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
                >
                  Пропустить
                </button>
              </div>
            )}

            {aspect.status === "reviewing" && !aspect.selectedVariantId && (
              <div className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3">
                {aspect.variants.map((v) => (
                  <div key={v.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase text-[var(--color-muted-foreground)]">
                        {v.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => handlePickVariant(aspect, v.id)}
                        disabled={busy}
                        className="text-xs border border-blue-600 text-blue-600 rounded px-2 py-0.5 hover:bg-blue-600 hover:text-white"
                      >
                        Принять
                      </button>
                    </div>
                    {adapter.renderVariant(
                      v.payload as EntitySetPayload,
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => handleGenerate(aspect)}
                  disabled={busy}
                  className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)] self-start"
                >
                  Перегенерировать
                </button>
              </div>
            )}

            {aspect.status === "reviewing" && aspect.selectedVariantId && selectedVariant && (
              <div className="flex flex-col gap-2 border-l-2 border-blue-600 pl-3">
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Просмотрите кандидатов и решите, какие из них сохранить:
                </p>
                <ul className="flex flex-col gap-1">
                  {(selectedVariant.payload as EntitySetPayload).candidates.map((c) => {
                    const profile = c.profile as { name?: string; description?: string };
                    const decision = decisions[c.tempId] ?? "accept";
                    return (
                      <li
                        key={c.tempId}
                        className="flex items-start gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          aria-label={`accept-${c.tempId}`}
                          checked={decision === "accept"}
                          onChange={() => toggleCandidate(aspect.id, c.tempId)}
                          className="mt-1"
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">{profile.name ?? "Без имени"}</span>
                          {profile.description && (
                            <span className="text-xs text-[var(--color-muted-foreground)]">
                              {profile.description}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleMaterialize(aspect)}
                    disabled={busy}
                    className="text-sm border border-blue-600 bg-blue-600 text-white rounded-md px-3 py-1 disabled:opacity-50"
                  >
                    {busy ? "Материализуем…" : "Материализовать"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkip(aspect)}
                    disabled={busy}
                    className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
                  >
                    Пропустить
                  </button>
                </div>
              </div>
            )}

            {aspect.status === "accepted" && aspect.finalPayload !== undefined && (
              <div>
                {adapter.renderFinal(aspect.finalPayload as EntitySetPayload)}
              </div>
            )}

            {aspect.status === "skipped" && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Пропущено
              </p>
            )}

            {err && (
              <p role="alert" className="text-xs text-red-600">
                {err}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @book-forge/web test
pnpm --filter @book-forge/web typecheck
git add apps/web/src/components/studio/aspect-engine/EntityStageRunner.tsx apps/web/src/components/studio/aspect-engine/__tests__/EntityStageRunner.test.tsx
git commit -m "feat(web): EntityStageRunner — generate/review/materialize for char/items"
```

Expected: 3 new EntityStageRunner tests + 45 existing = 48 web tests.

---

## Task 8: EntityStagePage + routes + StudioPage links

**Files:**
- Create: `apps/web/src/pages/EntityStagePage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/StudioPage.tsx`

- [ ] **Step 1: Create `EntityStagePage.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { api } from "@/api/client";
import type { StageId, StageState, StudioState } from "@book-forge/shared";
import { EntityStageRunner } from "@/components/studio/aspect-engine/EntityStageRunner";
import { PlaybookRunner } from "@/components/studio/aspect-engine/PlaybookRunner";
import {
  createLLMEntityVariantGenerator,
  createLLMPlaybookGenerator,
} from "@/components/studio/aspect-engine/llmGenerators";

const STAGE_LABELS: Record<"characters" | "items", string> = {
  characters: "Персонажи",
  items: "Предметы",
};

function isEntityStage(s: string): s is "characters" | "items" {
  return s === "characters" || s === "items";
}

export function EntityStagePage() {
  const { bookId: rawBookId, stageId: rawStageId } =
    useParams<{ bookId: string; stageId: string }>();
  const bookId = Number(rawBookId);

  if (!rawStageId || !isEntityStage(rawStageId)) {
    return <Navigate to={`/books/${bookId}/studio`} replace />;
  }
  const stageId: "characters" | "items" = rawStageId;

  const [studio, setStudio] = useState<StudioState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(bookId)) return;
    let alive = true;
    (async () => {
      try {
        const s = await api.getStudioState(bookId);
        if (alive) setStudio(s);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  async function handlePatch(
    expectedRevision: number,
    nextStage: StageState,
  ): Promise<{ stage: StageState; revision: number }> {
    if (!studio) throw new Error("studio state not loaded");
    const nextStudio: StudioState = {
      ...studio,
      stages: { ...studio.stages, [stageId as StageId]: nextStage },
    };
    const saved = await api.patchStudioState(bookId, expectedRevision, nextStudio);
    setStudio(saved);
    const savedStage = saved.stages[stageId as StageId];
    if (!savedStage) throw new Error("stage missing in saved state");
    return { stage: savedStage, revision: saved.revision };
  }

  async function handleMaterialize(
    aspectId: string,
    body: {
      stageId: "characters" | "items";
      aspectName: string;
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        profile: unknown;
      }>;
    },
  ) {
    return api.materializeEntitySet(bookId, aspectId, body);
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!studio) {
    return <main className="max-w-5xl mx-auto p-8">Загрузка…</main>;
  }

  const stage: StageState = studio.stages[stageId as StageId] ?? {
    status: "not_started",
    playbookGenerated: false,
    aspects: [],
  };

  const playbookGenerator = createLLMPlaybookGenerator({ bookId, stageId: stageId as StageId });
  const entityGenerator = createLLMEntityVariantGenerator({ bookId, stageId });

  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-6">
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">{STAGE_LABELS[stageId]}</h1>
        <Link to={`/books/${bookId}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>

      {stage.aspects.length === 0 ? (
        <PlaybookRunner
          stage={stage}
          revision={studio.revision}
          generator={playbookGenerator}
          onPatch={handlePatch}
        />
      ) : (
        <EntityStageRunner
          stage={stage}
          revision={studio.revision}
          stageId={stageId}
          generator={entityGenerator}
          onPatch={handlePatch}
          onMaterialize={handleMaterialize}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: App.tsx — modify the existing studio:stageId route to dispatch by stageId**

In `apps/web/src/App.tsx`, the existing route `/books/:bookId/studio/:stageId` points to `<MarkdownStagePage>`. We need both `MarkdownStagePage` (for world/lore) AND `EntityStagePage` (for characters/items). Both pages already redirect to `/studio` when stageId doesn't match — so we can use a single dispatch wrapper.

Add a wrapper component above the router:

```tsx
import { useParams } from "react-router-dom";
import { MarkdownStagePage } from "@/pages/MarkdownStagePage";
import { EntityStagePage } from "@/pages/EntityStagePage";

function StagePageDispatch() {
  const { stageId } = useParams<{ stageId: string }>();
  if (stageId === "characters" || stageId === "items") {
    return <EntityStagePage />;
  }
  return <MarkdownStagePage />;
}
```

Replace the existing `element: <MarkdownStagePage />` with `element: <StagePageDispatch />`. Keep the route path the same.

- [ ] **Step 3: StudioPage.tsx — enable links for characters/items**

In `apps/web/src/pages/StudioPage.tsx`, find the `href` ternary and extend:

```tsx
            const href =
              id === "world" || id === "lore" || id === "characters" || id === "items"
                ? `/books/${bookId}/studio/${id}`
                : undefined;
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @book-forge/web typecheck
pnpm --filter @book-forge/web test
git add apps/web/src/pages/EntityStagePage.tsx apps/web/src/App.tsx apps/web/src/pages/StudioPage.tsx
git commit -m "feat(web): EntityStagePage + dispatch route + StudioPage links for characters/items"
```

---

## Task 9: Workspace verification + push

- [ ] **Step 1: Full typecheck**

Run: `pnpm -r typecheck`
Expected: 7 packages green.

- [ ] **Step 2: Full test**

Run: `pnpm -r test`
Expected: shared 50, llm 65, agents 0, server 129 (122+7), web 48 (45+3) = 292 tests.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Done criteria

- [ ] `aspect_entity_variants` agent registered + LLM contract returns 2-3 entity sets per category.
- [ ] `/playbook` overrides `payloadKind=entity_set` for characters/items stages.
- [ ] `/aspects/:id/generate` dispatches by `payloadKind` — markdown vs entity_set.
- [ ] `/aspects/:id/materialize` creates rows in `characters`/`items` SQLite tables and returns IDs.
- [ ] Web SDK has 2 new methods.
- [ ] `<EntityStageRunner>` handles: pending → generate → variant pick → per-candidate review → materialize → accepted.
- [ ] `<EntityStagePage>` mounts on `/studio/characters` and `/studio/items`.
- [ ] World/lore cards still link to MarkdownStagePage; characters/items to EntityStagePage.
- [ ] `pnpm -r typecheck` and `pnpm -r test` green; total 292.
- [ ] Commits pushed to origin/main.

## Out of scope E

- Refine for entity_set variants — Phase E v1 throws if `refineFrom` is set.
- Per-candidate "merge with existing entity" UI — accepts only "accept" or "reject" for now.
- Locations stage (`locations` table not used; Phase E uses only characters + items).
- Server-side validation that `tempId` matches an existing variant in studio_state — server trusts the request.
- Studio_events audit on materialize — out of scope.

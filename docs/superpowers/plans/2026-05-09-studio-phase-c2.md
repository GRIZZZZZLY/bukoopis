# Studio Phase C2 — Aspect Engine LLM (Playbook + Variants + Refine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land 3 LLM agents (`aspect_playbook`, `aspect_variants`, `aspect_refine`) + their server endpoints + thin web SDK with LLM-backed `VariantGenerator` and `PlaybookGenerator` factories. **No UI changes** — Phase D will wire the SDK into `<AspectRunner>` per stage in StudioPage.

**Architecture:** Each agent is registered through Phase 1 dispatchStructured machinery (mcp_submit_tool, subscription backend). Server adds 3 thin endpoints under `/api/books/:id/stages/:stageId/...` that load the book's concept + canon summary, build accumulated context (with SHA-256 hash for `contextRef`), call the agent, return raw output. Web client gets 3 fetch methods + 2 generator factories that match the C1 interfaces (`VariantGenerator<string>` for markdown stages and `PlaybookGenerator` — a new interface for playbook flow).

**Tech Stack:** TypeScript 5.7, Zod 4, Anthropic SDK / Claude Agent SDK (Phase 1 dispatcher), Hono 4.6, vitest 2.1.

---

## Pre-conditions

- Phase A + B1 + B2 + C1 merged on `main` (HEAD `2d14db8`).
- `pnpm -r typecheck` and `pnpm -r test` green at start (268 tests).
- `dispatchStructured` Phase 1 working (subscription backend, mcp_submit_tool default).
- `StageAspect` / `AspectVariant` / `ContextRef` schemas already in `@book-forge/shared`.
- The `aspect_engine/types.ts` (Phase C1) defines `VariantGenerator<TPayload>` and `GenerateInput<TPayload>`.

## Files to create

| File | Purpose |
|---|---|
| `packages/agents/src/aspects/playbook.ts` | `aspect_playbook` contract — proposes 5–9 aspects per stage. |
| `packages/agents/src/aspects/variants.ts` | `aspect_variants` contract — generates 2–3 variants for one aspect. |
| `packages/agents/src/aspects/refine.ts` | `aspect_refine` contract — refines one variant via instructions. |
| `apps/server/src/services/studio/contextHash.ts` | Pure helper: SHA-256 of canonical accumulated-context payload + `buildContextRef`. |
| `apps/server/src/routes/__tests__/aspects.test.ts` | Route integration tests (3 endpoints × happy + error paths). |
| `apps/web/src/components/studio/aspect-engine/llmGenerators.ts` | Factories: `createLLMMarkdownVariantGenerator`, `createLLMPlaybookGenerator`. |

## Files to modify

| File | Reason |
|---|---|
| `packages/llm/src/types.ts` | Add 3 names to `AGENT_NAMES` + `STRUCTURED_AGENT_NAMES`. |
| `packages/llm/src/router.ts` | Add 3 entries to `DEFAULT_AGENT_BACKEND` (subscription). |
| `packages/agents/package.json` | Add subpath export `./aspects/playbook`, `./aspects/variants`, `./aspects/refine`. |
| `packages/agents/src/bootstrap.ts` | Register 3 new contracts. |
| `apps/server/src/routes/studio.ts` | Add 3 endpoints. |
| `apps/web/src/api/client.ts` | Add 3 methods (`generateStagePlaybook`, `generateAspectVariants`, `refineAspectVariant`). |

## Files NOT to modify

- `packages/shared/src/studio-state.ts` — schemas final.
- `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx` — UI integration is Phase D.
- `apps/server/src/db/studio.ts` — repository final for C2; new endpoints reuse `loadConcept` only.

## Conventions

- All agents use `defaultMode: "mcp_submit_tool"`, `subscription` backend.
- Routes accept `stageId` as a path param (validated against `STAGE_IDS`).
- Routes mock `runConceptRefiner`-style: we mock `runAspectPlaybook` / `runAspectVariants` / `runAspectRefine` in tests via `vi.mock` to avoid real LLM.
- `contextRef.hash` = `sha256(canonicalJSON({ stageId, conceptShortHash, accumulatedAspectIds, accumulatedPayloads }))`. Length `64` hex chars.
- Russian system prompts (consistent with `concept_refiner` and critics).

---

## Task 1: Add 3 agent names to AGENT_NAMES + router

**Files:**
- Modify: `packages/llm/src/types.ts`
- Modify: `packages/llm/src/router.ts`

- [ ] **Step 1: Edit types.ts**

Append to `AGENT_NAMES` const tuple (just before the closing `] as const;`):

```ts
  "concept_refiner",
  "aspect_playbook",
  "aspect_variants",
  "aspect_refine",
] as const;
```

Append to `STRUCTURED_AGENT_NAMES` Set:

```ts
  "concept_refiner",
  "aspect_playbook",
  "aspect_variants",
  "aspect_refine",
]);
```

- [ ] **Step 2: Edit router.ts**

In the `DEFAULT_AGENT_BACKEND` object, add 3 entries after `concept_refiner: "subscription"`:

```ts
  concept_refiner: "subscription",
  aspect_playbook: "subscription",
  aspect_variants: "subscription",
  aspect_refine: "subscription",
};
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @book-forge/llm typecheck && pnpm --filter @book-forge/llm test`
Expected: typecheck 0 errors; tests 65/65 still pass (parity test still aligns since the 3 new names are in BOTH `AGENT_NAMES` and `STRUCTURED_AGENT_NAMES`).

- [ ] **Step 4: Commit**

```bash
git add packages/llm/src/types.ts packages/llm/src/router.ts
git commit -m "feat(llm): add aspect_playbook + aspect_variants + aspect_refine to AGENT_NAMES"
```

---

## Task 2: `aspect_playbook` contract

**Files:**
- Create: `packages/agents/src/aspects/playbook.ts`

The directory `packages/agents/src/aspects/` does not yet exist — file creation will auto-create it.

- [ ] **Step 1: Implement**

```ts
import { z } from "zod";
import type { BookConcept, ContextRef, StageId } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export interface AspectPlaybookInput {
  stageId: StageId;
  concept: BookConcept;
  /** Already-existing aspect names so the LLM doesn't propose duplicates. */
  existingAspectNames: string[];
  contextRef: ContextRef;
}

const proposedAspectSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(400),
  required: z.boolean(),
  payloadKind: z.literal("markdown"),
});

const aspectPlaybookOutputSchema = z.object({
  aspects: z.array(proposedAspectSchema).min(3).max(9),
});

export type AspectPlaybookOutput = z.infer<typeof aspectPlaybookOutputSchema>;
export type ProposedAspect = z.infer<typeof proposedAspectSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const SYSTEM = `Ты — литературный соавтор, формирующий содержание книжной библии. Работаешь на русском.

Текущая задача — предложить список *аспектов* для одной стадии. Аспект — это короткое тематическое поле (например, для стадии Мир: "география", "политика", "магия"; для стадии Лор: "космогония", "фракции", "религия"). Каждый аспект потом будет раскрыт отдельно (5-9 аспектов суммарно).

Стиль аспектов: одно-два слова на русском, без штампов, согласовано с жанрами/тоном/аудиторией концепта.

Поле required:
- true: без этого аспекта стадия не может считаться завершённой (например, "география" для Мир);
- false: дополняющий аспект, можно пропустить.

Возвращай только аспекты с payloadKind === "markdown". Сейчас поддерживается только текстовый формат.

Не дублируй уже существующие аспекты из existingAspectNames.`;

function buildPrompt(input: AspectPlaybookInput): string {
  const parts: string[] = [
    `Стадия: ${STAGE_LABELS[input.stageId]}`,
    "",
    "КОНЦЕПТ:",
    `Жанры: ${[...input.concept.genres, ...(input.concept.customGenres ?? [])].join(", ") || "не выбраны"}`,
    `Тон: ${[...input.concept.tones, ...(input.concept.customTones ?? [])].join(", ") || "не выбран"}`,
    `Аудитория: ${input.concept.audience}`,
  ];
  if (input.concept.premise.logline) {
    parts.push("", "Логлайн:", input.concept.premise.logline);
  }
  if (input.existingAspectNames.length > 0) {
    parts.push(
      "",
      `Уже существующие аспекты (НЕ дублируй): ${input.existingAspectNames.join(", ")}`,
    );
  }
  parts.push(
    "",
    `Сгенерируй 5–9 аспектов для стадии "${STAGE_LABELS[input.stageId]}".`,
  );
  return parts.join("\n");
}

const aspectPlaybookContract: AgentStructuredContract<
  AspectPlaybookInput,
  AspectPlaybookOutput
> = {
  agentName: "aspect_playbook",
  getOutputSchema: () => aspectPlaybookOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_playbook",
    toolDescription:
      "Submit a list of 5–9 markdown aspects proposed for a stage. Each aspect has name, description, required flag.",
  },
};

export function registerAspectPlaybookContract(): void {
  registerAgentContract(aspectPlaybookContract);
}

export interface RunAspectPlaybookOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runAspectPlaybook(
  input: AspectPlaybookInput,
  options: RunAspectPlaybookOptions = {},
): Promise<AspectPlaybookOutput> {
  const { raw } = await dispatchStructured<
    AspectPlaybookInput,
    AspectPlaybookOutput
  >({
    agentName: "aspect_playbook",
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

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @book-forge/agents typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/aspects/playbook.ts
git commit -m "feat(agents): aspect_playbook contract — propose 5-9 aspects per stage"
```

---

## Task 3: `aspect_variants` contract

**Files:**
- Create: `packages/agents/src/aspects/variants.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from "zod";
import type {
  AspectVariant,
  BookConcept,
  ContextRef,
  StageId,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export interface AspectVariantsInput {
  stageId: StageId;
  concept: BookConcept;
  aspect: {
    id: string;
    name: string;
    description?: string;
  };
  /** Accumulated context from already-accepted aspects in this stage. */
  accumulated: Array<{ name: string; finalPayload: string }>;
  draft?: string;
  contextRef: ContextRef;
}

const variantPayloadSchema = z.string().min(20).max(20000);

const proposedVariantSchema = z.object({
  label: z.string().min(1).max(60),
  payload: variantPayloadSchema,
});

const aspectVariantsOutputSchema = z.object({
  variants: z.array(proposedVariantSchema).min(2).max(3),
});

export type AspectVariantsOutput = z.infer<typeof aspectVariantsOutputSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const SYSTEM = `Ты — литературный соавтор, раскрывающий аспект книжной библии в нескольких альтернативных формулировках. Работаешь на русском.

На вход даётся: стадия (мир/лор/...), концепт книги, имя аспекта (например, "география"), уже принятые аспекты той же стадии (контекст), опционально черновик от автора.

Цель: выдать 2–3 НЕЗАВИСИМЫХ варианта, каждый — самостоятельная подача аспекта в виде markdown-абзаца (200–500 слов). Не "продолжение" предыдущего, а альтернативное направление.

Стиль: ёмко, конкретно, без штампов и общих мест. Согласовано с жанрами/тоном/аудиторией концепта. Учти все принятые аспекты — варианты должны им не противоречить.

У каждого варианта есть короткий label (одно-два слова, отличающее этот вариант: "морской", "пустынный", "тёмный", "героический" и т.п.) и payload — собственно текст.`;

function buildPrompt(input: AspectVariantsInput): string {
  const parts: string[] = [
    `Стадия: ${STAGE_LABELS[input.stageId]}`,
    `Аспект: ${input.aspect.name}`,
  ];
  if (input.aspect.description) {
    parts.push(`Описание аспекта: ${input.aspect.description}`);
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
    parts.push("", "ПРИНЯТЫЕ АСПЕКТЫ ЭТОЙ ЖЕ СТАДИИ (ниже — порядковый):");
    for (const a of input.accumulated) {
      parts.push(`### ${a.name}`, a.finalPayload, "");
    }
  }
  if (input.draft && input.draft.trim()) {
    parts.push("ЧЕРНОВИК ОТ АВТОРА:", input.draft.trim());
  }
  parts.push(
    "",
    `Сгенерируй 2–3 разных по углу варианта раскрытия аспекта "${input.aspect.name}". Каждый вариант — markdown-абзац 200–500 слов.`,
  );
  return parts.join("\n");
}

const aspectVariantsContract: AgentStructuredContract<
  AspectVariantsInput,
  AspectVariantsOutput
> = {
  agentName: "aspect_variants",
  getOutputSchema: () => aspectVariantsOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_variants",
    toolDescription:
      "Submit 2–3 alternative markdown payloads for a single stage aspect.",
  },
};

export function registerAspectVariantsContract(): void {
  registerAgentContract(aspectVariantsContract);
}

export interface RunAspectVariantsOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runAspectVariants(
  input: AspectVariantsInput,
  options: RunAspectVariantsOptions = {},
): Promise<AspectVariantsOutput> {
  const { raw } = await dispatchStructured<
    AspectVariantsInput,
    AspectVariantsOutput
  >({
    agentName: "aspect_variants",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    maxTokens: 4096,
  });
  return raw;
}

/** Helper: take server-side output (from runAspectVariants) and produce
 *  storable AspectVariant[] with crypto-random IDs and timestamps. */
export function toStoredVariants(
  output: AspectVariantsOutput,
  meta: { contextRef: ContextRef; modelId: string },
): AspectVariant[] {
  const now = new Date().toISOString();
  return output.variants.map((v) => ({
    id: crypto.randomUUID(),
    label: v.label,
    payloadKind: "markdown" as const,
    payload: v.payload,
    status: "generated" as const,
    editSource: "llm" as const,
    generatedAt: now,
    modelId: meta.modelId,
    contextRef: meta.contextRef,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @book-forge/agents typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/aspects/variants.ts
git commit -m "feat(agents): aspect_variants contract — 2-3 markdown variants per aspect"
```

---

## Task 4: `aspect_refine` contract

**Files:**
- Create: `packages/agents/src/aspects/refine.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from "zod";
import type {
  AspectVariant,
  BookConcept,
  ContextRef,
  StageId,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";
import type { ModelChoice } from "@book-forge/shared";

export interface AspectRefineInput {
  stageId: StageId;
  concept: BookConcept;
  aspect: {
    id: string;
    name: string;
    description?: string;
  };
  parentVariant: {
    id: string;
    payload: string;
    label: string;
  };
  instructions: string;
  /** Other accepted aspects in the same stage. */
  accumulated: Array<{ name: string; finalPayload: string }>;
  contextRef: ContextRef;
}

const refinedVariantSchema = z.object({
  label: z.string().min(1).max(60),
  payload: z.string().min(20).max(20000),
});

const aspectRefineOutputSchema = z.object({
  variant: refinedVariantSchema,
});

export type AspectRefineOutput = z.infer<typeof aspectRefineOutputSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const SYSTEM = `Ты — литературный соавтор. Работаешь на русском. Тебе дают существующий вариант раскрытия аспекта и инструкции автора по его доработке. Твоя задача — выдать ОДИН новый вариант, учитывающий инструкции, в той же форме (markdown-абзац 200–500 слов).

Сохраняй внутреннюю согласованность: учитывай все принятые аспекты той же стадии. Не придумывай противоречий с ними.

Label: одно-два слова, кратко описывающие изменение ("темнее", "короче", "с фракцией X").`;

function buildPrompt(input: AspectRefineInput): string {
  const parts: string[] = [
    `Стадия: ${STAGE_LABELS[input.stageId]}`,
    `Аспект: ${input.aspect.name}`,
  ];
  if (input.aspect.description) {
    parts.push(`Описание аспекта: ${input.aspect.description}`);
  }
  parts.push(
    "",
    "ИСХОДНЫЙ ВАРИАНТ:",
    `Label: ${input.parentVariant.label}`,
    input.parentVariant.payload,
    "",
    "ИНСТРУКЦИИ ОТ АВТОРА:",
    input.instructions,
  );
  if (input.accumulated.length > 0) {
    parts.push("", "ПРИНЯТЫЕ АСПЕКТЫ ТОЙ ЖЕ СТАДИИ:");
    for (const a of input.accumulated) {
      parts.push(`### ${a.name}`, a.finalPayload, "");
    }
  }
  parts.push(
    "",
    "Выдай ОДИН доработанный вариант, согласно инструкциям. НЕ дублируй исходник дословно.",
  );
  return parts.join("\n");
}

const aspectRefineContract: AgentStructuredContract<
  AspectRefineInput,
  AspectRefineOutput
> = {
  agentName: "aspect_refine",
  getOutputSchema: () => aspectRefineOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_aspect_refined_variant",
    toolDescription:
      "Submit one refined markdown variant of an existing aspect variant, following user instructions.",
  },
};

export function registerAspectRefineContract(): void {
  registerAgentContract(aspectRefineContract);
}

export interface RunAspectRefineOptions {
  model?: ModelChoice;
  temperature?: number;
}

export async function runAspectRefine(
  input: AspectRefineInput,
  options: RunAspectRefineOptions = {},
): Promise<AspectRefineOutput> {
  const { raw } = await dispatchStructured<
    AspectRefineInput,
    AspectRefineOutput
  >({
    agentName: "aspect_refine",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    maxTokens: 2048,
  });
  return raw;
}

/** Helper: take refine output and produce a storable AspectVariant
 *  linked to the parent via parentVariantId. */
export function toStoredRefinedVariant(
  output: AspectRefineOutput,
  meta: {
    parentVariantId: string;
    contextRef: ContextRef;
    modelId: string;
  },
): AspectVariant {
  return {
    id: crypto.randomUUID(),
    label: output.variant.label,
    payloadKind: "markdown" as const,
    payload: output.variant.payload,
    status: "generated" as const,
    editSource: "refine" as const,
    parentVariantId: meta.parentVariantId,
    generatedAt: new Date().toISOString(),
    modelId: meta.modelId,
    contextRef: meta.contextRef,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @book-forge/agents typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/aspects/refine.ts
git commit -m "feat(agents): aspect_refine contract — produce one refined variant from instructions"
```

---

## Task 5: Register all 3 + add agents subpath exports

**Files:**
- Modify: `packages/agents/package.json`
- Modify: `packages/agents/src/bootstrap.ts`

- [ ] **Step 1: Add subpath exports to `packages/agents/package.json`**

In the `exports` block, add 3 new subpath entries:

```json
  "exports": {
    ".": "./src/index.ts",
    "./bootstrap": "./src/bootstrap.ts",
    "./concept/refiner": "./src/concept/refiner.ts",
    "./aspects/playbook": "./src/aspects/playbook.ts",
    "./aspects/variants": "./src/aspects/variants.ts",
    "./aspects/refine": "./src/aspects/refine.ts"
  }
```

- [ ] **Step 2: Edit `packages/agents/src/bootstrap.ts`**

Add 3 imports near the existing ones:

```ts
import { registerAspectPlaybookContract } from "./aspects/playbook.js";
import { registerAspectVariantsContract } from "./aspects/variants.js";
import { registerAspectRefineContract } from "./aspects/refine.js";
```

Inside `registerAllAgentContracts`, add 3 calls at the end:

```ts
  registerConceptRefinerContract();
  registerAspectPlaybookContract();
  registerAspectVariantsContract();
  registerAspectRefineContract();
}
```

Update the JSDoc phase listing:

```ts
 * Phase B2 (Studio): concept_refiner.
 * Phase C2 (Studio): aspect_playbook, aspect_variants, aspect_refine.
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @book-forge/agents typecheck`
Expected: 0 errors.

Run: `pnpm --filter @book-forge/llm test`
Expected: parity test still passes (3 new names in both AGENT_NAMES and STRUCTURED_AGENT_NAMES).

- [ ] **Step 4: Commit**

```bash
git add packages/agents/package.json packages/agents/src/bootstrap.ts
git commit -m "feat(agents): register aspect_playbook + aspect_variants + aspect_refine"
```

---

## Task 6: Server endpoints + tests

**Files:**
- Create: `apps/server/src/services/studio/contextHash.ts`
- Modify: `apps/server/src/routes/studio.ts`
- Create: `apps/server/src/routes/__tests__/aspects.test.ts`

The endpoints:
- `POST /api/books/:id/stages/:stageId/playbook` — body: `{ existingAspectNames?: string[] }` → returns `{ aspects, contextRef }`
- `POST /api/books/:id/stages/:stageId/aspects/:aspectId/generate` — body: `{ aspect, accumulated, draft? }` → returns `{ variants, contextRef }`
- `POST /api/books/:id/stages/:stageId/aspects/:aspectId/refine` — body: `{ aspect, parentVariant, instructions, accumulated }` → returns `{ variant, contextRef }`

The endpoints DON'T mutate `studio_state`. Web client merges results into local state and calls `patchStudioState` separately. This keeps endpoints simple and idempotent.

- [ ] **Step 1: Create `services/studio/contextHash.ts`**

```ts
import { createHash } from "node:crypto";
import type {
  BookConcept,
  ContextRef,
  StageId,
} from "@book-forge/shared";

interface BuildContextRefInput {
  stageId: StageId;
  concept: BookConcept;
  accumulated: Array<{
    id: string;
    name: string;
    finalPayload: string;
  }>;
  /** Extra metadata (e.g. parentVariantId for refine, draft for variants). */
  extra?: Record<string, unknown>;
}

export function buildContextRef(input: BuildContextRefInput): ContextRef {
  const conceptHash = createHash("sha256")
    .update(JSON.stringify(input.concept))
    .digest("hex")
    .slice(0, 16);
  const canonical = JSON.stringify({
    stageId: input.stageId,
    conceptHash,
    accumulated: input.accumulated.map((a) => ({
      id: a.id,
      name: a.name,
      payloadHash: createHash("sha256")
        .update(a.finalPayload)
        .digest("hex")
        .slice(0, 16),
    })),
    extra: input.extra ?? {},
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  const summary = `stage=${input.stageId} concept=${conceptHash} acc=${input.accumulated.length}`;
  return {
    hash,
    summary,
    includedAspectIds: input.accumulated.map((a) => a.id),
    includedEntityIds: [],
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/routes/__tests__/aspects.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/aspects/playbook", () => ({
  runAspectPlaybook: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/variants", () => ({
  runAspectVariants: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/refine", () => ({
  runAspectRefine: vi.fn(),
}));

import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import { runAspectVariants } from "@book-forge/agents/aspects/variants";
import { runAspectRefine } from "@book-forge/agents/aspects/refine";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runAspectPlaybook).mockReset();
  vi.mocked(runAspectVariants).mockReset();
  vi.mocked(runAspectRefine).mockReset();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Aspects test",
  });
  return r.id;
}

describe("POST /api/books/:id/stages/:stageId/playbook", () => {
  it("returns 404 for unknown book", async () => {
    const r = await send(
      t.app,
      "/api/books/9999/stages/world/playbook",
      "POST",
      {},
    );
    expect(r.status).toBe(404);
  });

  it("returns 400 for invalid stageId", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/wrong/playbook`,
      "POST",
      {},
    );
    expect(r.status).toBe(400);
  });

  it("returns aspects + contextRef on success", async () => {
    vi.mocked(runAspectPlaybook).mockResolvedValue({
      aspects: [
        { name: "география", description: "земли и воды", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила колдовства", required: true, payloadKind: "markdown" },
        { name: "технологии", description: "уровень развития", required: false, payloadKind: "markdown" },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{
      aspects: Array<{ name: string }>;
      contextRef: { hash: string };
    }>(t.app, `/api/books/${id}/stages/world/playbook`, "POST", {
      existingAspectNames: ["климат"],
    });
    expect(r.aspects).toHaveLength(3);
    expect(r.contextRef.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(runAspectPlaybook).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runAspectPlaybook).mock.calls[0]![0];
    expect(arg.stageId).toBe("world");
    expect(arg.existingAspectNames).toEqual(["климат"]);
  });

  it("returns 500 on agent failure", async () => {
    vi.mocked(runAspectPlaybook).mockRejectedValue(new Error("LLM down"));
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/playbook`,
      "POST",
      {},
    );
    expect(r.status).toBe(500);
  });
});

describe("POST /api/books/:id/stages/:stageId/aspects/:aspectId/generate", () => {
  it("returns variants + contextRef on success", async () => {
    vi.mocked(runAspectVariants).mockResolvedValue({
      variants: [
        { label: "морской", payload: "Островная цепь, торговые ветры…" },
        { label: "горный", payload: "Снежные пики, узкие перевалы…" },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{
      variants: Array<{ id: string; payload: string }>;
      contextRef: { hash: string };
    }>(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/generate`,
      "POST",
      {
        aspect: { id: "asp1", name: "география", description: "земли и воды" },
        accumulated: [{ id: "prev", name: "климат", finalPayload: "Тёплый муссон" }],
      },
    );
    expect(r.variants).toHaveLength(2);
    expect(r.variants[0]!.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.contextRef.hash).toMatch(/^[0-9a-f]{64}$/);
    const arg = vi.mocked(runAspectVariants).mock.calls[0]![0];
    expect(arg.aspect.name).toBe("география");
    expect(arg.accumulated[0]!.name).toBe("климат");
  });

  it("returns 400 for missing aspect body", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/x/generate`,
      "POST",
      {},
    );
    expect(r.status).toBe(400);
  });
});

describe("POST /api/books/:id/stages/:stageId/aspects/:aspectId/refine", () => {
  it("returns refined variant with parentVariantId", async () => {
    vi.mocked(runAspectRefine).mockResolvedValue({
      variant: { label: "темнее", payload: "Серые острова, постоянные шторма…" },
    });
    const id = await createBook();
    const r = await sendJson<{
      variant: { id: string; parentVariantId: string };
      contextRef: { hash: string };
    }>(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/refine`,
      "POST",
      {
        aspect: { id: "asp1", name: "география" },
        parentVariant: { id: "v1", label: "морской", payload: "old" },
        instructions: "сделай мрачнее",
        accumulated: [],
      },
    );
    expect(r.variant.parentVariantId).toBe("v1");
    expect(r.variant.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.contextRef.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 400 for missing instructions", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/refine`,
      "POST",
      {
        aspect: { id: "asp1", name: "география" },
        parentVariant: { id: "v1", label: "x", payload: "y" },
        accumulated: [],
      },
    );
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 3: Verify it fails**

Run: `pnpm --filter @book-forge/server test`
Expected: FAIL — endpoints not registered.

- [ ] **Step 4: Add endpoints to `apps/server/src/routes/studio.ts`**

Read the file. Then apply changes:

1. Add imports near the top (alongside the `runConceptRefiner` import):

```ts
import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import {
  runAspectVariants,
  toStoredVariants,
} from "@book-forge/agents/aspects/variants";
import {
  runAspectRefine,
  toStoredRefinedVariant,
} from "@book-forge/agents/aspects/refine";
import { stageIdSchema } from "@book-forge/shared";
import { buildContextRef } from "../services/studio/contextHash.js";
```

2. Add Zod body schemas after the existing `refineConceptBodySchema`:

```ts
const playbookBodySchema = z.object({
  existingAspectNames: z.array(z.string()).optional(),
});

const generateAspectBodySchema = z.object({
  aspect: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  accumulated: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      finalPayload: z.string().min(1),
    }),
  ),
  draft: z.string().max(2000).optional(),
});

const refineAspectBodySchema = z.object({
  aspect: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  parentVariant: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    payload: z.string().min(1),
  }),
  instructions: z.string().min(1).max(2000),
  accumulated: z.array(
    z.object({
      name: z.string().min(1),
      finalPayload: z.string().min(1),
    }),
  ),
});
```

3. Add 3 handlers INSIDE `createStudioRoute`, AFTER the existing `r.post("/books/:id/concept/refine", ...)` handler:

```ts
  r.post("/books/:id/stages/:stageId/playbook", async (c) => {
    const id = Number(c.req.param("id"));
    const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
    if (!stageParse.success) return validationFailed(c, stageParse.error);
    const body = await c.req.json().catch(() => ({}));
    const parsed = playbookBodySchema.safeParse(body ?? {});
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const contextRef = buildContextRef({
      stageId: stageParse.data,
      concept,
      accumulated: [],
      extra: { kind: "playbook" },
    });
    try {
      const result = await runAspectPlaybook({
        stageId: stageParse.data,
        concept,
        existingAspectNames: parsed.data.existingAspectNames ?? [],
        contextRef,
      });
      return c.json({ aspects: result.aspects, contextRef });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "aspect_playbook_failed", details: { message } },
        500,
      );
    }
  });

  r.post("/books/:id/stages/:stageId/aspects/:aspectId/generate", async (c) => {
    const id = Number(c.req.param("id"));
    const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
    if (!stageParse.success) return validationFailed(c, stageParse.error);
    const body = await c.req.json().catch(() => null);
    const parsed = generateAspectBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const contextRef = buildContextRef({
      stageId: stageParse.data,
      concept,
      accumulated: parsed.data.accumulated,
      extra: {
        kind: "variants",
        aspectId: parsed.data.aspect.id,
        ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
      },
    });
    try {
      const result = await runAspectVariants({
        stageId: stageParse.data,
        concept,
        aspect: parsed.data.aspect,
        accumulated: parsed.data.accumulated.map((a) => ({
          name: a.name,
          finalPayload: a.finalPayload,
        })),
        ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
        contextRef,
      });
      const variants = toStoredVariants(result, {
        contextRef,
        modelId: "subscription:claude-sonnet-4-6",
      });
      return c.json({ variants, contextRef });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "aspect_variants_failed", details: { message } },
        500,
      );
    }
  });

  r.post("/books/:id/stages/:stageId/aspects/:aspectId/refine", async (c) => {
    const id = Number(c.req.param("id"));
    const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
    if (!stageParse.success) return validationFailed(c, stageParse.error);
    const body = await c.req.json().catch(() => null);
    const parsed = refineAspectBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const contextRef = buildContextRef({
      stageId: stageParse.data,
      concept,
      accumulated: parsed.data.accumulated.map((a, i) => ({
        id: `acc${i}`,
        name: a.name,
        finalPayload: a.finalPayload,
      })),
      extra: {
        kind: "refine",
        aspectId: parsed.data.aspect.id,
        parentVariantId: parsed.data.parentVariant.id,
        instructions: parsed.data.instructions,
      },
    });
    try {
      const result = await runAspectRefine({
        stageId: stageParse.data,
        concept,
        aspect: parsed.data.aspect,
        parentVariant: parsed.data.parentVariant,
        instructions: parsed.data.instructions,
        accumulated: parsed.data.accumulated,
        contextRef,
      });
      const variant = toStoredRefinedVariant(result, {
        parentVariantId: parsed.data.parentVariant.id,
        contextRef,
        modelId: "subscription:claude-sonnet-4-6",
      });
      return c.json({ variant, contextRef });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "aspect_refine_failed", details: { message } },
        500,
      );
    }
  });
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @book-forge/server test`
Expected: PASS — 8 new aspects tests + 114 existing = 122.

Run: `pnpm --filter @book-forge/server typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/studio/contextHash.ts apps/server/src/routes/studio.ts apps/server/src/routes/__tests__/aspects.test.ts
git commit -m "feat(server): /api/books/:id/stages/:stageId/{playbook,generate,refine} endpoints"
```

---

## Task 7: Web SDK + LLM-backed generators

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Create: `apps/web/src/components/studio/aspect-engine/llmGenerators.ts`

- [ ] **Step 1: Add 3 methods to `apps/web/src/api/client.ts`**

In the `api` object literal, after the existing `refineConceptField` method, add:

```ts
  generateStagePlaybook: (
    bookId: number,
    stageId: string,
    existingAspectNames: string[] = [],
  ) =>
    req<{
      aspects: Array<{
        name: string;
        description: string;
        required: boolean;
        payloadKind: "markdown";
      }>;
      contextRef: {
        hash: string;
        summary: string;
        includedAspectIds: string[];
        includedEntityIds: string[];
      };
    }>(`/api/books/${bookId}/stages/${stageId}/playbook`, {
      method: "POST",
      body: JSON.stringify({ existingAspectNames }),
    }),
  generateAspectVariants: (
    bookId: number,
    stageId: string,
    aspectId: string,
    body: {
      aspect: { id: string; name: string; description?: string };
      accumulated: Array<{ id: string; name: string; finalPayload: string }>;
      draft?: string;
    },
  ) =>
    req<{
      variants: Array<{
        id: string;
        label: string;
        payloadKind: "markdown";
        payload: string;
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
  refineAspectVariant: (
    bookId: number,
    stageId: string,
    aspectId: string,
    body: {
      aspect: { id: string; name: string; description?: string };
      parentVariant: { id: string; label: string; payload: string };
      instructions: string;
      accumulated: Array<{ name: string; finalPayload: string }>;
    },
  ) =>
    req<{
      variant: {
        id: string;
        label: string;
        payloadKind: "markdown";
        payload: string;
        status: "generated";
        editSource: "refine";
        parentVariantId: string;
        generatedAt: string;
        modelId: string;
        contextRef: {
          hash: string;
          summary: string;
          includedAspectIds: string[];
          includedEntityIds: string[];
        };
      };
      contextRef: {
        hash: string;
        summary: string;
        includedAspectIds: string[];
        includedEntityIds: string[];
      };
    }>(
      `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/refine`,
      { method: "POST", body: JSON.stringify(body) },
    ),
```

- [ ] **Step 2: Create `apps/web/src/components/studio/aspect-engine/llmGenerators.ts`**

```ts
import type { AspectVariant, StageId } from "@book-forge/shared";
import { api } from "@/api/client";
import type {
  GenerateInput,
  VariantGenerator,
} from "./types.js";

/** LLM-backed VariantGenerator for markdown stages (world/lore). Wraps the
 *  POST /generate endpoint and translates the response into AspectVariant[]. */
export function createLLMMarkdownVariantGenerator(args: {
  bookId: number;
  stageId: StageId;
}): VariantGenerator<string> {
  return {
    async generate(input: GenerateInput<string>): Promise<AspectVariant[]> {
      if (input.refineFrom) {
        const r = await api.refineAspectVariant(
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
            },
            parentVariant: {
              id: input.refineFrom.variantId,
              label: "исходный",
              payload: input.refineFrom.payload,
            },
            instructions: input.refineFrom.instructions,
            accumulated: input.accumulated.acceptedAspects.map((a) => ({
              name: a.name,
              finalPayload: String(a.finalPayload),
            })),
          },
        );
        return [r.variant];
      }
      const r = await api.generateAspectVariants(
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
          },
          accumulated: input.accumulated.acceptedAspects.map((a) => ({
            id: a.id,
            name: a.name,
            finalPayload: String(a.finalPayload),
          })),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        },
      );
      return r.variants;
    },
  };
}

/** Standalone playbook generator (returns proposed aspect templates, NOT
 *  variants). Used by Phase D's per-stage page when the stage has no
 *  aspects yet and the user wants the LLM to propose them. */
export interface PlaybookGenerator {
  generate(args: {
    existingAspectNames?: string[];
  }): Promise<{
    aspects: Array<{
      name: string;
      description: string;
      required: boolean;
      payloadKind: "markdown";
    }>;
  }>;
}

export function createLLMPlaybookGenerator(args: {
  bookId: number;
  stageId: StageId;
}): PlaybookGenerator {
  return {
    async generate(input) {
      const r = await api.generateStagePlaybook(
        args.bookId,
        args.stageId,
        input.existingAspectNames ?? [],
      );
      return { aspects: r.aspects };
    },
  };
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

Run: `pnpm --filter @book-forge/web test`
Expected: 39 tests still pass (no new tests in this task — Phase D will add UI tests).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/components/studio/aspect-engine/llmGenerators.ts
git commit -m "feat(web): LLM-backed VariantGenerator + PlaybookGenerator factories + api SDK"
```

---

## Task 8: Workspace verification + push

- [ ] **Step 1: Full typecheck**

```bash
cd "d:/PROJECTS/BOOKOPIS"
pnpm -r typecheck
```
Expected: 7 packages green.

- [ ] **Step 2: Full test**

```bash
pnpm -r test
```
Expected:
- shared: 50, llm: 65, agents: 0, server: 122 (114 + 8 aspects), web: 39 = 276 tests.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Done criteria

- [ ] `aspect_playbook`, `aspect_variants`, `aspect_refine` registered in `AGENT_NAMES` + `STRUCTURED_AGENT_NAMES` + router default backend.
- [ ] Three `packages/agents/src/aspects/{playbook,variants,refine}.ts` files exist with contracts + `runX` helpers.
- [ ] `bootstrap.ts` calls all 3 register functions; assert at server startup succeeds.
- [ ] `apps/server/src/services/studio/contextHash.ts` produces a 64-char hex hash.
- [ ] 3 server endpoints respond with `{aspects|variants|variant, contextRef}` shape; tests cover 200/400/404/500 paths.
- [ ] Web `api.generateStagePlaybook` / `generateAspectVariants` / `refineAspectVariant` SDK methods exist.
- [ ] Web `createLLMMarkdownVariantGenerator` and `createLLMPlaybookGenerator` factories exist and conform to C1 interfaces.
- [ ] `pnpm -r typecheck` and `pnpm -r test` green; total 276 tests.
- [ ] Commits pushed to origin/main.

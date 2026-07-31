# Studio Phase C1 — Aspect Engine Skeleton (UI + Adapter Pattern, No LLM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the universal aspect-engine UI skeleton: `StageAdapter` interface + `VariantGenerator` interface + `<AspectRunner>` React component with full generate/accept/regen/skip flow, driven by mock implementations for tests. **No LLM in this phase.** Phase C2 plugs in real LLM-backed generator. Phase D/E will create real stage adapters (world/lore/characters/items) and mount `<AspectRunner>` per stage in StudioPage.

**Architecture:** Two-layer separation per master spec. **Layer 1** — `<AspectRunner>` orchestrates state transitions (pending → generating → reviewing → accepted | skipped) via callback prop `onPatch(expectedRevision, nextStage)`. Parent owns the API; runner is a controlled component. **Layer 2** — `StageAdapter<TPayload>` per-stage interface defines `payloadSchema`, `renderVariant`, `renderFinal` so the runner stays payload-agnostic. **`VariantGenerator<TPayload>`** is a separate interface so C2 can plug in LLM-backed generators without touching C1 code.

**Tech Stack:** TypeScript 5.7 strict, React 18, Tailwind 4, Zod 4, vitest 2.1 + @testing-library/react.

---

## Pre-conditions

- Phase A + B1 + B2 merged on `main` (HEAD `5816f00`).
- `pnpm -r typecheck` and `pnpm -r test` green at start (260 tests).
- Shared types `StageAspect` / `AspectVariant` / `StageState` / `PayloadKind` already exported from `@book-forge/shared` (Phase A Task 1).
- ULID/random IDs: use `crypto.randomUUID()` (Node 22 + browser modern). No new deps.

## Files to create

| File | Purpose |
|---|---|
| `apps/web/src/components/studio/aspect-engine/types.ts` | `StageAdapter<TPayload>` + `VariantGenerator<TPayload>` + `AccumulatedContext` interfaces. |
| `apps/web/src/components/studio/aspect-engine/markdownAdapter.ts` | Reusable markdown-payload adapter (used by mock tests AND later by world/lore adapters in Phase D). |
| `apps/web/src/components/studio/aspect-engine/mockGenerator.ts` | Test-only generator returning canned variants. |
| `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx` | Orchestration component. |
| `apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx` | Behavior tests via mock adapter + mock generator. |

## Files to modify

None in C1. AspectRunner is standalone — Phase D mounts it per stage in StudioPage with real adapters.

## Conventions

- All new code in `apps/web/src/components/studio/aspect-engine/`. One concern per file.
- Component is "controlled": receives `stage` + `revision` props, fires `onPatch`. Parent owns the data.
- New variant IDs and aspect IDs use `crypto.randomUUID()`.
- `StageAdapter` interface lives in web (uses React types). Server-side validation belongs to per-stage validators in Phase D/E.
- Mock generator and markdown adapter both live in the same folder so future stage adapters (Phase D) can reuse `markdownAdapter`.

---

## Task 1: Aspect-engine types (`types.ts`)

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/types.ts`

The directory does not yet exist. Creating the file will auto-create the parent dirs.

- [ ] **Step 1: Implement**

```ts
import type { ReactNode } from "react";
import type { ZodType } from "zod";
import type {
  AspectVariant,
  PayloadKind,
  StageAspect,
  StageId,
} from "@book-forge/shared";

/** Stage-specific behavior. Each stage (world/lore/characters/items) provides
 *  its own implementation. C1 ships only a markdown adapter for tests; Phase D/E
 *  add real stage adapters. */
export interface StageAdapter<TPayload> {
  stageId: StageId;
  payloadKind: PayloadKind;
  /** Runtime guard for stored payload. Defends against drift after migration
   *  or when other code paths write into `studio_state` JSONB. */
  payloadSchema: ZodType<TPayload>;
  /** Render one generated variant (or refined variant) inside the runner. */
  renderVariant(payload: TPayload): ReactNode;
  /** Render the accepted final payload. May differ from variant render
   *  (e.g. accepted markdown gets prose styling). */
  renderFinal(payload: TPayload): ReactNode;
}

/** Variants generator interface. C1 ships a mock implementation; C2 plugs in
 *  LLM-backed generators. */
export interface VariantGenerator<TPayload> {
  generate(input: GenerateInput<TPayload>): Promise<AspectVariant[]>;
}

export interface GenerateInput<TPayload> {
  aspect: StageAspect;
  accumulated: AccumulatedContext;
  /** Optional draft from the user — passed for fields that allow seed text. */
  draft?: string;
  /** When set, generator is asked to refine THIS variant's payload (via
   *  user-supplied instructions) and produce a new descendant variant. */
  refineFrom?: { variantId: string; payload: TPayload; instructions: string };
}

/** Context built from already-accepted aspects in the same stage, in `order`. */
export interface AccumulatedContext {
  acceptedAspects: Array<{
    id: string;
    name: string;
    finalPayload: unknown;
  }>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/studio/aspect-engine/types.ts
git commit -m "feat(web): aspect-engine types (StageAdapter, VariantGenerator, AccumulatedContext)"
```

---

## Task 2: Markdown adapter + mock generator

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/markdownAdapter.ts`
- Create: `apps/web/src/components/studio/aspect-engine/mockGenerator.ts`

- [ ] **Step 1: Implement `markdownAdapter.ts`**

```ts
import { z } from "zod";
import type { StageAdapter } from "./types.js";
import type { StageId } from "@book-forge/shared";

const markdownPayloadSchema = z.string().min(1).max(20000);
type MarkdownPayload = z.infer<typeof markdownPayloadSchema>;

/** Factory: a markdown adapter scoped to one stage. Used by world/lore in
 *  Phase D and by C1 tests via the mock generator. */
export function createMarkdownAdapter(stageId: StageId): StageAdapter<MarkdownPayload> {
  return {
    stageId,
    payloadKind: "markdown",
    payloadSchema: markdownPayloadSchema,
    renderVariant: (payload) => (
      <div className="text-sm whitespace-pre-wrap">{payload}</div>
    ),
    renderFinal: (payload) => (
      <div className="text-sm whitespace-pre-wrap rounded bg-[var(--color-muted)] px-3 py-2">
        {payload}
      </div>
    ),
  };
}
```

NOTE: this file is `.ts` but renders JSX, so rename to `.tsx`:

Actually to keep things clean, **save as `markdownAdapter.tsx` instead of `.ts`**, since it contains JSX.

- [ ] **Step 2: Rename + recreate**

Save the file to `apps/web/src/components/studio/aspect-engine/markdownAdapter.tsx` (with `.tsx` extension). Imports stay the same.

- [ ] **Step 3: Implement `mockGenerator.ts`**

```ts
import type { AspectVariant } from "@book-forge/shared";
import type { GenerateInput, VariantGenerator } from "./types.js";

/** Deterministic mock generator for C1 tests + dev. Returns 2 canned variants
 *  whose payload incorporates the aspect name + accumulated context summary,
 *  so tests can verify the generator was called with the right input. */
export function createMockMarkdownGenerator(): VariantGenerator<string> {
  return {
    async generate(input: GenerateInput<string>): Promise<AspectVariant[]> {
      const accSummary = input.accumulated.acceptedAspects
        .map((a) => a.name)
        .join(",");
      const accLabel = accSummary ? ` (accumulated: ${accSummary})` : "";
      const refineNote = input.refineFrom
        ? ` (refined from ${input.refineFrom.variantId}: ${input.refineFrom.instructions})`
        : "";
      const draftNote = input.draft ? ` (draft: ${input.draft})` : "";
      const aspect = input.aspect;
      const now = new Date().toISOString();
      return [
        {
          id: crypto.randomUUID(),
          label: "первый",
          payloadKind: "markdown",
          payload: `Variant 1 for ${aspect.name}${accLabel}${refineNote}${draftNote}`,
          status: "generated",
          editSource: input.refineFrom ? "refine" : "llm",
          generatedAt: now,
          ...(input.refineFrom !== undefined
            ? { parentVariantId: input.refineFrom.variantId }
            : {}),
        },
        {
          id: crypto.randomUUID(),
          label: "второй",
          payloadKind: "markdown",
          payload: `Variant 2 for ${aspect.name}${accLabel}${refineNote}${draftNote}`,
          status: "generated",
          editSource: input.refineFrom ? "refine" : "llm",
          generatedAt: now,
          ...(input.refineFrom !== undefined
            ? { parentVariantId: input.refineFrom.variantId }
            : {}),
        },
      ];
    },
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/aspect-engine/markdownAdapter.tsx apps/web/src/components/studio/aspect-engine/mockGenerator.ts
git commit -m "feat(web): markdown StageAdapter + mock VariantGenerator for tests"
```

---

## Task 3: AspectRunner component

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from "react";
import type {
  AspectVariant,
  StageAspect,
  StageState,
} from "@book-forge/shared";
import type {
  AccumulatedContext,
  StageAdapter,
  VariantGenerator,
} from "./types.js";

interface Props<TPayload> {
  stage: StageState;
  /** Current StudioState revision — passed back to parent on patch. */
  revision: number;
  adapter: StageAdapter<TPayload>;
  generator: VariantGenerator<TPayload>;
  /** Parent callback that owns the API patch. Returns new state + revision
   *  after server confirms. */
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
}

const STATUS_LABEL: Record<StageAspect["status"], string> = {
  pending: "ожидает",
  generating: "генерация…",
  reviewing: "выбор",
  accepted: "принято",
  skipped: "пропущено",
};

export function AspectRunner<TPayload>({
  stage,
  revision,
  adapter,
  generator,
  onPatch,
}: Props<TPayload>) {
  const [busyAspectId, setBusyAspectId] = useState<string | null>(null);
  const [errorByAspect, setErrorByAspect] = useState<Record<string, string>>({});

  if (stage.aspects.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        В стадии нет аспектов. Запустите генерацию плейбука (Phase C2).
      </p>
    );
  }

  function buildAccumulatedContext(skip?: string): AccumulatedContext {
    return {
      acceptedAspects: stage.aspects
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
        })),
    };
  }

  function buildNextStage(updater: (a: StageAspect) => StageAspect, aspectId: string): StageState {
    return {
      ...stage,
      status:
        stage.status === "not_started" ? "in_progress" : stage.status,
      aspects: stage.aspects.map((a) =>
        a.id === aspectId ? updater(a) : a,
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  async function applyPatch(
    aspectId: string,
    next: StageState,
  ): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspectId]: "" }));
    setBusyAspectId(aspectId);
    try {
      await onPatch(revision, next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorByAspect((p) => ({ ...p, [aspectId]: msg }));
    } finally {
      setBusyAspectId(null);
    }
  }

  async function handleGenerate(aspect: StageAspect): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const variants = await generator.generate({
        aspect,
        accumulated: buildAccumulatedContext(aspect.id),
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

  async function handleAccept(
    aspect: StageAspect,
    variant: AspectVariant,
  ): Promise<void> {
    const next = buildNextStage(
      (a) => ({
        ...a,
        status: "accepted" as const,
        selectedVariantId: variant.id,
        finalPayload: variant.payload,
        variants: a.variants.map((v) =>
          v.id === variant.id
            ? { ...v, status: "accepted" as const }
            : v.status === "accepted"
              ? { ...v, status: "rejected" as const }
              : v,
        ),
      }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  async function handleSkip(aspect: StageAspect): Promise<void> {
    const next = buildNextStage(
      (a) => ({ ...a, status: "skipped" as const }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  async function handleRestore(aspect: StageAspect): Promise<void> {
    const next = buildNextStage(
      (a) => ({ ...a, status: "pending" as const }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  async function handleEdit(aspect: StageAspect): Promise<void> {
    const next = buildNextStage(
      (a) => ({
        ...a,
        status: "reviewing" as const,
        ...(a.selectedVariantId !== undefined
          ? { selectedVariantId: undefined }
          : {}),
        ...(a.finalPayload !== undefined ? { finalPayload: undefined } : {}),
      }),
      aspect.id,
    );
    await applyPatch(aspect.id, next);
  }

  function renderVariantPayload(variant: AspectVariant): React.ReactNode {
    const parsed = adapter.payloadSchema.safeParse(variant.payload);
    if (!parsed.success) {
      return (
        <p className="text-xs text-red-600">
          Не удалось разобрать payload: {parsed.error.message}
        </p>
      );
    }
    return adapter.renderVariant(parsed.data);
  }

  function renderFinalPayload(payload: unknown): React.ReactNode {
    const parsed = adapter.payloadSchema.safeParse(payload);
    if (!parsed.success) {
      return (
        <p className="text-xs text-red-600">
          Не удалось разобрать финальный payload: {parsed.error.message}
        </p>
      );
    }
    return adapter.renderFinal(parsed.data);
  }

  return (
    <ul
      aria-label="aspects"
      className="flex flex-col gap-4 border border-[var(--color-border)] rounded-lg p-4"
    >
      {stage.aspects.map((aspect) => {
        const busy = busyAspectId === aspect.id;
        const err = errorByAspect[aspect.id];
        return (
          <li key={aspect.id} data-aspect-id={aspect.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{aspect.name}</span>
                {aspect.required && (
                  <span className="text-xs text-amber-700">(обязательно)</span>
                )}
              </div>
              <span
                aria-label={`status-${aspect.status}`}
                className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]"
              >
                {STATUS_LABEL[aspect.status]}
              </span>
            </div>

            {aspect.description && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {aspect.description}
              </p>
            )}

            {aspect.status === "pending" && (
              <div>
                <button
                  type="button"
                  onClick={() => handleGenerate(aspect)}
                  disabled={busy}
                  className={
                    "text-sm border rounded-md px-3 py-1 " +
                    (busy
                      ? "bg-[var(--color-muted)] cursor-not-allowed"
                      : "border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white")
                  }
                >
                  {busy ? "Генерируем…" : "Сгенерировать варианты"}
                </button>
                <button
                  type="button"
                  onClick={() => handleSkip(aspect)}
                  disabled={busy}
                  className="ml-2 text-sm border rounded-md px-3 py-1 border-[var(--color-border)] hover:bg-[var(--color-muted)]"
                >
                  Пропустить
                </button>
              </div>
            )}

            {aspect.status === "reviewing" && aspect.variants.length > 0 && (
              <div className="flex flex-col gap-2 border-l-2 border-[var(--color-border)] pl-3">
                {aspect.variants.map((v) => (
                  <div key={v.id} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        {v.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAccept(aspect, v)}
                        disabled={busy}
                        className="text-xs border border-blue-600 text-blue-600 rounded px-2 py-0.5 hover:bg-blue-600 hover:text-white"
                      >
                        Принять
                      </button>
                    </div>
                    {renderVariantPayload(v)}
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerate(aspect)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Перегенерировать
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkip(aspect)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Пропустить
                  </button>
                </div>
              </div>
            )}

            {aspect.status === "accepted" && aspect.finalPayload !== undefined && (
              <div className="flex flex-col gap-2">
                {renderFinalPayload(aspect.finalPayload)}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(aspect)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSkip(aspect)}
                    disabled={busy}
                    className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            )}

            {aspect.status === "skipped" && (
              <div>
                <button
                  type="button"
                  onClick={() => handleRestore(aspect)}
                  disabled={busy}
                  className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                >
                  Восстановить
                </button>
              </div>
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

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/studio/aspect-engine/AspectRunner.tsx
git commit -m "feat(web): AspectRunner — controlled aspect-engine UI orchestrator"
```

---

## Task 4: AspectRunner tests

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { AspectRunner } from "../AspectRunner";
import { createMarkdownAdapter } from "../markdownAdapter";
import { createMockMarkdownGenerator } from "../mockGenerator";

const adapter = createMarkdownAdapter("world");
const generator = createMockMarkdownGenerator();
const generateSpy = vi.spyOn(generator, "generate");

function makeAspect(partial?: Partial<StageAspect>): StageAspect {
  return {
    id: "a1",
    name: "география",
    status: "pending",
    order: 0,
    required: true,
    source: "system",
    payloadKind: "markdown",
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

beforeEach(() => {
  generateSpy.mockClear();
});

describe("AspectRunner", () => {
  it("shows empty state when stage has no aspects", () => {
    render(
      <AspectRunner
        stage={makeStage([])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.getByText(/нет аспектов/i)).toBeInTheDocument();
  });

  it("pending aspect shows Generate + Skip buttons", () => {
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Пропустить/ }),
    ).toBeInTheDocument();
  });

  it("clicking Generate calls generator and patches with reviewing+variants", async () => {
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={3}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const [rev, next] = onPatch.mock.calls[0]!;
    expect(rev).toBe(3);
    expect(next.aspects[0]!.status).toBe("reviewing");
    expect(next.aspects[0]!.variants).toHaveLength(2);
  });

  it("clicking Принять on a reviewing aspect patches with accepted+finalPayload", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Variant payload one",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
        {
          id: "v2",
          label: "второй",
          payloadKind: "markdown",
          payload: "Variant payload two",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    const acceptButtons = screen.getAllByRole("button", { name: /Принять/ });
    await userEvent.click(acceptButtons[0]!);
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.status).toBe("accepted");
    expect(next.aspects[0]!.selectedVariantId).toBe("v1");
    expect(next.aspects[0]!.finalPayload).toBe("Variant payload one");
    expect(next.aspects[0]!.variants[0]!.status).toBe("accepted");
  });

  it("clicking Skip on pending patches with status=skipped", async () => {
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Пропустить/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch.mock.calls[0]![1].aspects[0]!.status).toBe("skipped");
  });

  it("accepted aspect renders renderFinal and Edit/Delete buttons", () => {
    const acceptedAspect = makeAspect({
      status: "accepted",
      selectedVariantId: "v1",
      finalPayload: "Окончательный текст об острове",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Окончательный текст об острове",
          status: "accepted",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    render(
      <AspectRunner
        stage={makeStage([acceptedAspect])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Окончательный текст об острове/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Изменить/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Удалить/ })).toBeInTheDocument();
  });

  it("Перегенерировать calls generator a second time", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "p1",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
        {
          id: "v2",
          label: "второй",
          payloadKind: "markdown",
          payload: "p2",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Перегенерировать/ }),
    );
    await waitFor(() => expect(generateSpy).toHaveBeenCalled());
  });

  it("error from onPatch shows inline alert", async () => {
    const onPatch = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
  });
});
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — 8 new tests + 31 existing = 39 web tests.

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx
git commit -m "test(web): AspectRunner behavior — generate/accept/skip/regen/edit/error"
```

---

## Task 5: Workspace verification + push

- [ ] **Step 1: Full typecheck**

Run: `pnpm -r typecheck`
Expected: 7 packages green.

- [ ] **Step 2: Full test**

Run: `pnpm -r test`
Expected counts:
- shared: 50, llm: 65, agents: 0, server: 114, web: 39 (was 31, +8 AspectRunner) = 268.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Done criteria

- [ ] `apps/web/src/components/studio/aspect-engine/types.ts` exports `StageAdapter`, `VariantGenerator`, `GenerateInput`, `AccumulatedContext`.
- [ ] `markdownAdapter.tsx` exports `createMarkdownAdapter(stageId)` that returns an adapter with markdown payload schema.
- [ ] `mockGenerator.ts` exports `createMockMarkdownGenerator()` returning 2 canned variants.
- [ ] `<AspectRunner>` is a generic controlled component handling: pending → generate → reviewing → accept | regenerate | skip → accepted (renderFinal) → edit (back to reviewing) | skipped → restore.
- [ ] Tests cover: empty state, pending UI, generate+patch, accept+patch, skip+patch, accepted renderFinal, regenerate, error path.
- [ ] `pnpm -r typecheck` and `pnpm -r test` green; total 268 tests.
- [ ] Commits pushed to origin/main.

## NOT in C1

- No real LLM (Phase C2).
- No mount in StudioPage (Phase D will mount per stage).
- No playbook generation (Phase C2).
- No refine flow with `parentVariantId` chain — generator already supports `refineFrom` input but `AspectRunner` doesn't expose a refine button yet (added in C2 alongside LLM refine).
- No server-side per-stage validators — only generic Zod from shared.

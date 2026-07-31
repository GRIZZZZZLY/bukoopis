# Studio Phase D — World + Lore Stages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land per-stage pages for `world` and `lore` — empty stage shows `<PlaybookRunner>` (LLM proposes 5–9 aspects → user reviews → materialize), populated stage shows `<AspectRunner>` (generate variants per aspect → review → accept). Add refine UI inside `<AspectRunner>` so users can iterate on a single variant. **Markdown payload only** — characters/items (entity_set) is Phase E.

**Architecture:** One generic `<MarkdownStagePage>` component driven by URL param `stageId ∈ {world, lore}`. It loads `studioState`, picks `stages[stageId]`, owns the `onPatch` flow (api.patchStudioState with revision tracking), and renders either `<PlaybookRunner>` (when stage has zero aspects) OR `<AspectRunner>` (existing C1 component, extended with refine). Stage cards on the StudioPage become links to `/studio/:stageId` for world/lore.

**Tech Stack:** TypeScript 5.7 strict, React 18, Tailwind 4, Zod 4, react-router-dom 7, vitest 2.1 + @testing-library/react.

---

## Pre-conditions

- Phases A–C2 merged on `main` (HEAD `5f69a1a`).
- 276 tests green at start.
- `<AspectRunner>` (C1), `markdownAdapter` (C1), `createLLMMarkdownVariantGenerator` + `createLLMPlaybookGenerator` (C2) all exist.
- Server endpoints `/playbook` and `/aspects/:id/{generate,refine}` working.
- `api.patchStudioState(bookId, expectedRevision, next)` returns `Promise<StudioState>`.

## Files to create

| File | Purpose |
|---|---|
| `apps/web/src/components/studio/aspect-engine/PlaybookRunner.tsx` | Plays the playbook flow: empty stage → "Сгенерировать список аспектов" → review proposed → materialize into `stage.aspects`. |
| `apps/web/src/components/studio/aspect-engine/__tests__/PlaybookRunner.test.tsx` | 4 tests. |
| `apps/web/src/pages/MarkdownStagePage.tsx` | The world/lore page. Loads state, renders Playbook OR AspectRunner. |

## Files to modify

| File | Reason |
|---|---|
| `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx` | Add per-variant "✏️ Уточнить" button + inline refine form. |
| `apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx` | +2 tests for refine flow. |
| `apps/web/src/components/studio/StageCard.tsx` | Accept optional `href` prop and render as `<Link>` when set. |
| `apps/web/src/pages/StudioPage.tsx` | Pass `href` to world/lore stage cards. |
| `apps/web/src/App.tsx` | Add route `/books/:bookId/studio/:stageId`. |

## Files NOT to modify

- `packages/agents/**`, `apps/server/**` — backend final for D.
- `packages/llm/**`, `packages/shared/**` — schemas final.
- C1 types.ts / markdownAdapter / mockGenerator — final.

## Conventions

- Markdown stage page mounts both `<PlaybookRunner>` and `<AspectRunner>`. Either component's `onPatch` callback rebuilds the full studioState and calls `api.patchStudioState`.
- New aspect IDs from playbook materialization use `crypto.randomUUID()` client-side.
- `source: "llm"` for materialized aspects (came from playbook agent), `source: "user"` if user adds manually (out of scope D).
- `payloadKind: "markdown"` for all aspects in world/lore stages.
- All Russian UI strings.

---

## Task 1: Refine UI in AspectRunner

**Files:**
- Modify: `apps/web/src/components/studio/aspect-engine/AspectRunner.tsx`
- Modify: `apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx`

The refine flow per variant in `reviewing` aspect:
1. Variant card shows "✏️ Уточнить" button next to "Принять".
2. Click → expands inline form: textarea (placeholder "Сделай мрачнее, добавь фракцию X…") + "Применить" / "Отменить".
3. Submit → calls `generator.generate({ aspect, accumulated, refineFrom: { variantId, payload, instructions } })` → returns `[newVariant]` (length 1) → patches state with new variant appended + parent variant set to `status: "superseded"`.
4. Cancel closes the form without state change.

- [ ] **Step 1: Modify AspectRunner.tsx**

Read the existing file. Apply changes:

1. Add to top of component body, alongside existing useState calls:
```ts
  const [refiningVariantId, setRefiningVariantId] = useState<string | null>(null);
  const [refineInstructions, setRefineInstructions] = useState<string>("");
```

2. Add a new handler after `handleEdit`:

```ts
  async function handleRefineSubmit(
    aspect: StageAspect,
    variant: AspectVariant,
    instructions: string,
  ): Promise<void> {
    setErrorByAspect((p) => ({ ...p, [aspect.id]: "" }));
    setBusyAspectId(aspect.id);
    try {
      const parsed = adapter.payloadSchema.safeParse(variant.payload);
      if (!parsed.success) {
        throw new Error(
          `payload не валиден: ${parsed.error.message}`,
        );
      }
      const newVariants = await generator.generate({
        aspect,
        accumulated: buildAccumulatedContext(aspect.id),
        refineFrom: {
          variantId: variant.id,
          payload: parsed.data,
          instructions,
        },
      });
      const next = buildNextStage(
        (a) => ({
          ...a,
          variants: [
            ...a.variants.map((v) =>
              v.id === variant.id
                ? { ...v, status: "superseded" as const }
                : v,
            ),
            ...newVariants,
          ],
        }),
        aspect.id,
      );
      await onPatch(revision, next);
      setRefiningVariantId(null);
      setRefineInstructions("");
    } catch (e) {
      setErrorByAspect((p) => ({
        ...p,
        [aspect.id]: e instanceof Error ? e.message : String(e),
      }));
    } finally {
      setBusyAspectId(null);
    }
  }
```

3. Inside the `reviewing` branch, modify the per-variant render block. Replace the existing `aspect.variants.map((v) => ...)` block with this expanded version:

```tsx
                {aspect.variants
                  .filter((v) => v.status !== "superseded")
                  .map((v) => {
                    const isRefining = refiningVariantId === v.id;
                    return (
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
                          <button
                            type="button"
                            onClick={() => {
                              setRefiningVariantId(isRefining ? null : v.id);
                              setRefineInstructions("");
                            }}
                            disabled={busy}
                            className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 hover:bg-[var(--color-muted)]"
                          >
                            {isRefining ? "Закрыть" : "✏️ Уточнить"}
                          </button>
                        </div>
                        {renderVariantPayload(v)}
                        {isRefining && (
                          <div className="flex flex-col gap-2 mt-1 border-l-2 border-blue-600 pl-3">
                            <textarea
                              value={refineInstructions}
                              onChange={(e) =>
                                setRefineInstructions(e.target.value)
                              }
                              placeholder="Сделай мрачнее, добавь фракцию X…"
                              rows={2}
                              aria-label={`refine-instructions-${v.id}`}
                              className="border border-[var(--color-border)] rounded px-2 py-1 text-sm"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleRefineSubmit(
                                    aspect,
                                    v,
                                    refineInstructions,
                                  )
                                }
                                disabled={busy || !refineInstructions.trim()}
                                className={
                                  "text-xs border rounded-md px-2 py-1 " +
                                  (busy || !refineInstructions.trim()
                                    ? "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed"
                                    : "bg-blue-600 text-white border-blue-600")
                                }
                              >
                                Применить
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRefiningVariantId(null);
                                  setRefineInstructions("");
                                }}
                                className="text-xs border border-[var(--color-border)] rounded-md px-2 py-1 hover:bg-[var(--color-muted)]"
                              >
                                Отменить
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
```

Note: `superseded` variants are filtered out (won't render in reviewing state) — they remain in storage for audit but aren't shown.

- [ ] **Step 2: Add 2 tests to AspectRunner.test.tsx**

Append AFTER the existing "error from onPatch shows inline alert" test, INSIDE the `describe("AspectRunner", ...)` block:

```tsx
  it("clicking '✏️ Уточнить' opens inline refine form", async () => {
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
          generatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Уточнить/ }),
    );
    expect(screen.getByLabelText(/refine-instructions-v1/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Применить/ }),
    ).toBeInTheDocument();
  });

  it("submitting refine calls generator with refineFrom and patches with new variant + superseded parent", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "исходный текст для рефайна",
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
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Уточнить/ }));
    await userEvent.type(
      screen.getByLabelText(/refine-instructions-v1/),
      "сделай мрачнее",
    );
    await userEvent.click(screen.getByRole("button", { name: /Применить/ }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const callArg = generateSpy.mock.calls[0]![0];
    expect(callArg.refineFrom).toBeDefined();
    expect(callArg.refineFrom!.variantId).toBe("v1");
    expect(callArg.refineFrom!.instructions).toBe("сделай мрачнее");
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.variants).toHaveLength(3); // v1 superseded + 2 new
    expect(next.aspects[0]!.variants[0]!.status).toBe("superseded");
  });
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — 10 AspectRunner tests (was 8, +2) + 31 other = 41 web tests.

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/studio/aspect-engine/AspectRunner.tsx apps/web/src/components/studio/aspect-engine/__tests__/AspectRunner.test.tsx
git commit -m "feat(web): add refine UI to AspectRunner — per-variant '✏️ Уточнить' inline form"
```

---

## Task 2: PlaybookRunner component + tests

**Files:**
- Create: `apps/web/src/components/studio/aspect-engine/PlaybookRunner.tsx`
- Create: `apps/web/src/components/studio/aspect-engine/__tests__/PlaybookRunner.test.tsx`

The flow:
1. Empty stage → button "Сгенерировать список аспектов".
2. Click → calls `playbookGenerator.generate({})` → shows proposed aspects with toggles (each has `name`, `description`, `required`, default-checked).
3. Toggle "required" individually OR uncheck the entire aspect to skip it.
4. Click "Принять список" → builds `StageAspect[]` from accepted entries (with `crypto.randomUUID` IDs, `order` from index, `source: "llm"`, `status: "pending"`, `payloadKind: "markdown"`, empty variants).
5. Calls `onPatch(expectedRevision, nextStage)` with `playbookGenerated: true` and the new aspects.
6. After patch, the parent (`MarkdownStagePage`) re-renders and switches from PlaybookRunner to AspectRunner.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/studio/aspect-engine/__tests__/PlaybookRunner.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageState } from "@book-forge/shared";
import { PlaybookRunner } from "../PlaybookRunner";
import type { PlaybookGenerator } from "../llmGenerators";

function makeEmptyStage(): StageState {
  return {
    status: "not_started",
    playbookGenerated: false,
    aspects: [],
  };
}

function makeGenerator(
  result: Awaited<ReturnType<PlaybookGenerator["generate"]>>,
): PlaybookGenerator {
  return {
    generate: vi.fn().mockResolvedValue(result),
  };
}

describe("PlaybookRunner", () => {
  it("renders Generate button when stage has no playbookGenerated", () => {
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={0}
        generator={makeGenerator({ aspects: [] })}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Сгенерировать список аспектов/ }),
    ).toBeInTheDocument();
  });

  it("clicking Generate shows proposed aspects for review", async () => {
    const generator = makeGenerator({
      aspects: [
        { name: "география", description: "земли и воды", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила колдовства", required: true, payloadKind: "markdown" },
        { name: "технологии", description: "уровень развития", required: false, payloadKind: "markdown" },
      ],
    });
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={0}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать список аспектов/ }),
    );
    await waitFor(() =>
      expect(screen.getByText("география")).toBeInTheDocument(),
    );
    expect(screen.getByText("магия")).toBeInTheDocument();
    expect(screen.getByText("технологии")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Принять список/ }),
    ).toBeInTheDocument();
  });

  it("Принять список materializes aspects with new IDs and patches", async () => {
    const generator = makeGenerator({
      aspects: [
        { name: "география", description: "земли и воды", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила колдовства", required: false, payloadKind: "markdown" },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={2}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать список аспектов/ }),
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Принять список/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Принять список/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [rev, next] = onPatch.mock.calls[0]!;
    expect(rev).toBe(2);
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects[0]!.name).toBe("география");
    expect(next.aspects[0]!.required).toBe(true);
    expect(next.aspects[1]!.required).toBe(false);
    expect(next.aspects[0]!.id).toMatch(/[0-9a-f-]{36}/);
    expect(next.aspects[0]!.status).toBe("pending");
    expect(next.aspects[0]!.payloadKind).toBe("markdown");
    expect(next.aspects[0]!.source).toBe("llm");
    expect(next.playbookGenerated).toBe(true);
  });

  it("toggling off an aspect excludes it from materialization", async () => {
    const generator = makeGenerator({
      aspects: [
        { name: "география", description: "x", required: true, payloadKind: "markdown" },
        { name: "магия", description: "y", required: true, payloadKind: "markdown" },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={0}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать список аспектов/ }),
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Принять список/ }),
    );
    // Uncheck the second aspect (магия) — find its include checkbox
    const includes = screen.getAllByRole("checkbox", { name: /Включить/ });
    expect(includes.length).toBe(2);
    await userEvent.click(includes[1]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Принять список/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects).toHaveLength(1);
    expect(next.aspects[0]!.name).toBe("география");
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/web test`
Expected: FAIL — `PlaybookRunner` not found.

- [ ] **Step 3: Implement `PlaybookRunner.tsx`**

```tsx
import { useState } from "react";
import type { StageAspect, StageState } from "@book-forge/shared";
import type { PlaybookGenerator } from "./llmGenerators";

interface ProposedAspect {
  name: string;
  description: string;
  required: boolean;
  payloadKind: "markdown";
}

interface ReviewItem extends ProposedAspect {
  include: boolean;
}

interface Props {
  stage: StageState;
  revision: number;
  generator: PlaybookGenerator;
  onPatch: (
    expectedRevision: number,
    next: StageState,
  ) => Promise<{ stage: StageState; revision: number }>;
}

export function PlaybookRunner({
  stage,
  revision,
  generator,
  onPatch,
}: Props) {
  const [proposed, setProposed] = useState<ReviewItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const r = await generator.generate({
        existingAspectNames: stage.aspects.map((a) => a.name),
      });
      setProposed(
        r.aspects.map((a) => ({ ...a, include: true })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptAll(): Promise<void> {
    if (!proposed) return;
    setError(null);
    setBusy(true);
    try {
      const accepted = proposed.filter((p) => p.include);
      const baseOrder = stage.aspects.length;
      const newAspects: StageAspect[] = accepted.map((p, i) => ({
        id: crypto.randomUUID(),
        name: p.name,
        description: p.description,
        status: "pending",
        order: baseOrder + i,
        required: p.required,
        source: "llm",
        payloadKind: "markdown",
        variants: [],
      }));
      const next: StageState = {
        ...stage,
        status: stage.status === "not_started" ? "in_progress" : stage.status,
        playbookGenerated: true,
        aspects: [...stage.aspects, ...newAspects],
        updatedAt: new Date().toISOString(),
      };
      await onPatch(revision, next);
      setProposed(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleInclude(index: number): void {
    setProposed((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const item = copy[index];
      if (!item) return prev;
      copy[index] = { ...item, include: !item.include };
      return copy;
    });
  }

  function toggleRequired(index: number): void {
    setProposed((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      const item = copy[index];
      if (!item) return prev;
      copy[index] = { ...item, required: !item.required };
      return copy;
    });
  }

  if (proposed === null) {
    return (
      <div className="flex flex-col gap-2 border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          В стадии пока нет аспектов. Запустите генерацию плейбука: LLM
          предложит 5–9 ключевых полей, которые потом раскроем по одному.
        </p>
        <div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className={
              "text-sm border rounded-md px-3 py-1 " +
              (busy
                ? "bg-[var(--color-muted)] cursor-not-allowed"
                : "border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white")
            }
          >
            {busy ? "Генерируем…" : "Сгенерировать список аспектов"}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border border-[var(--color-border)] rounded-lg p-4">
      <p className="text-sm font-medium">Предложенные аспекты</p>
      <ul className="flex flex-col gap-2">
        {proposed.map((p, i) => (
          <li
            key={`${p.name}-${i}`}
            className="flex items-start gap-3 rounded p-2 hover:bg-[var(--color-muted)]"
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={p.include}
                onChange={() => toggleInclude(i)}
                aria-label={`Включить ${p.name}`}
              />
            </label>
            <div className="flex flex-col gap-1 flex-1">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {p.description}
              </span>
              <label className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={() => toggleRequired(i)}
                  aria-label={`Обязательный ${p.name}`}
                />
                обязательный
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAcceptAll}
          disabled={busy || proposed.every((p) => !p.include)}
          className={
            "text-sm border rounded-md px-3 py-1 " +
            (busy || proposed.every((p) => !p.include)
              ? "bg-[var(--color-muted)] cursor-not-allowed"
              : "border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white")
          }
        >
          {busy ? "Сохраняем…" : "Принять список"}
        </button>
        <button
          type="button"
          onClick={() => setProposed(null)}
          disabled={busy}
          className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
        >
          Отменить
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy}
          className="text-sm border border-[var(--color-border)] rounded-md px-3 py-1 hover:bg-[var(--color-muted)]"
        >
          Перегенерировать
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — 4 PlaybookRunner + 41 existing = 45.

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/aspect-engine/PlaybookRunner.tsx apps/web/src/components/studio/aspect-engine/__tests__/PlaybookRunner.test.tsx
git commit -m "feat(web): PlaybookRunner — generate stage aspects via LLM playbook"
```

---

## Task 3: MarkdownStagePage

**Files:**
- Create: `apps/web/src/pages/MarkdownStagePage.tsx`

The page mounts both runners and owns state.

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { api } from "@/api/client";
import type { StageId, StudioState } from "@book-forge/shared";
import { AspectRunner } from "@/components/studio/aspect-engine/AspectRunner";
import { PlaybookRunner } from "@/components/studio/aspect-engine/PlaybookRunner";
import { createMarkdownAdapter } from "@/components/studio/aspect-engine/markdownAdapter";
import {
  createLLMMarkdownVariantGenerator,
  createLLMPlaybookGenerator,
} from "@/components/studio/aspect-engine/llmGenerators";

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const MARKDOWN_STAGES: ReadonlySet<StageId> = new Set(["world", "lore"]);

function isMarkdownStage(s: string): s is "world" | "lore" {
  return MARKDOWN_STAGES.has(s as StageId);
}

export function MarkdownStagePage() {
  const { bookId: rawBookId, stageId: rawStageId } =
    useParams<{ bookId: string; stageId: string }>();
  const bookId = Number(rawBookId);

  if (!rawStageId || !isMarkdownStage(rawStageId)) {
    return <Navigate to={`/books/${bookId}/studio`} replace />;
  }
  const stageId: "world" | "lore" = rawStageId;

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
    nextStage: StudioState["stages"][StageId],
  ): Promise<{ stage: NonNullable<StudioState["stages"][StageId]>; revision: number }> {
    if (!studio) throw new Error("studio state not loaded");
    if (!nextStage) throw new Error("next stage cannot be null");
    const nextStudio: StudioState = {
      ...studio,
      stages: {
        ...studio.stages,
        [stageId]: nextStage,
      },
    };
    const saved = await api.patchStudioState(bookId, expectedRevision, nextStudio);
    setStudio(saved);
    const savedStage = saved.stages[stageId];
    if (!savedStage) throw new Error("stage missing in saved state");
    return { stage: savedStage, revision: saved.revision };
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

  const stage = studio.stages[stageId] ?? {
    status: "not_started" as const,
    playbookGenerated: false,
    aspects: [],
  };

  const adapter = createMarkdownAdapter(stageId);
  const playbookGenerator = createLLMPlaybookGenerator({ bookId, stageId });
  const variantGenerator = createLLMMarkdownVariantGenerator({
    bookId,
    stageId,
  });

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
        <AspectRunner
          stage={stage}
          revision={studio.revision}
          adapter={adapter}
          generator={variantGenerator}
          onPatch={handlePatch}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit (page only — route wiring next task)**

```bash
git add apps/web/src/pages/MarkdownStagePage.tsx
git commit -m "feat(web): MarkdownStagePage — world/lore stage UI host"
```

---

## Task 4: Add route + StageCard link prop + StudioPage links

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/studio/StageCard.tsx`
- Modify: `apps/web/src/pages/StudioPage.tsx`

- [ ] **Step 1: App.tsx — add route**

In `apps/web/src/App.tsx`:

1. Add import alongside other page imports:
```ts
import { MarkdownStagePage } from "@/pages/MarkdownStagePage";
```

2. Add route entry to the `createBrowserRouter` array, AFTER the `/books/:bookId/studio` entry:
```ts
  {
    path: "/books/:bookId/studio/:stageId",
    element: <MarkdownStagePage />,
  },
```

- [ ] **Step 2: StageCard — accept href prop**

In `apps/web/src/components/studio/StageCard.tsx`, replace the file with:

```tsx
import type { StageId } from "@book-forge/shared";
import { Link } from "react-router-dom";

interface StageCardProps {
  stageId: StageId;
  label: string;
  status: "not_started" | "in_progress" | "complete" | "skipped";
  recommended: boolean;
  /** When set, the entire card becomes a Link to this URL. */
  href?: string;
}

const STATUS_ICON: Record<StageCardProps["status"], string> = {
  not_started: "●",
  in_progress: "▶",
  complete: "✓",
  skipped: "↷",
};

export function StageCard({
  stageId,
  label,
  status,
  recommended,
  href,
}: StageCardProps) {
  const className =
    "border rounded-lg p-4 flex flex-col gap-2 " +
    (recommended ? "border-blue-500 bg-blue-50" : "border-[var(--color-border)]") +
    (href ? " hover:bg-[var(--color-muted)] transition-colors" : "");

  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span aria-label={`status-${status}`} className="text-lg">
          {STATUS_ICON[status]}
        </span>
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)]">
        {status}
      </div>
      {recommended && (
        <div className="text-xs text-blue-700">Рекомендуем сейчас →</div>
      )}
    </>
  );

  if (href) {
    return (
      <Link to={href} data-stage-id={stageId} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <div data-stage-id={stageId} className={className}>
      {inner}
    </div>
  );
}
```

- [ ] **Step 3: StudioPage — pass href to world/lore cards**

In `apps/web/src/pages/StudioPage.tsx`, find the section that maps `STAGE_IDS` and renders `<StageCard>`. Update the call to pass `href` for world and lore:

```tsx
          {STAGE_IDS.map((id) => {
            const stage = studio.stages[id];
            const href =
              id === "world" || id === "lore"
                ? `/books/${bookId}/studio/${id}`
                : undefined;
            return (
              <StageCard
                key={id}
                stageId={id}
                label={STAGE_LABELS[id]}
                status={stage?.status ?? "not_started"}
                recommended={recommended === id}
                {...(href !== undefined ? { href } : {})}
              />
            );
          })}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

Run: `pnpm --filter @book-forge/web test`
Expected: 45 tests still pass (StageCard change doesn't break existing tests; no new test added in this task).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/studio/StageCard.tsx apps/web/src/pages/StudioPage.tsx
git commit -m "feat(web): wire /studio/:stageId route + clickable World/Lore stage cards"
```

---

## Task 5: Workspace verification + push

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
Expected counts:
- shared: 50, llm: 65, agents: 0, server: 122, web: 45 (was 39, +6: +2 AspectRunner refine, +4 PlaybookRunner) = 282 tests.

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

## Done criteria

- [ ] `<AspectRunner>` has per-variant "✏️ Уточнить" button + inline form; submitting calls generator with `refineFrom` and patches state with new variant + parent superseded.
- [ ] `<PlaybookRunner>` shows Generate button → review proposed aspects → Принять список materializes them with new IDs.
- [ ] `<MarkdownStagePage>` mounts on `/books/:bookId/studio/:stageId` for stageId ∈ {world, lore}; loads studio state; renders Playbook OR AspectRunner; persists via `api.patchStudioState`.
- [ ] `<StageCard>` becomes a clickable `<Link>` when `href` is set; world/lore cards on StudioPage are clickable.
- [ ] `pnpm -r typecheck` and `pnpm -r test` green; total 282.
- [ ] All commits pushed to origin/main.

## Out of scope D

- characters/items stages (entity_set payload) — Phase E.
- Server-side per-stage payload validators — Phase D doesn't add. Generic Zod from C1 suffices.
- Smoke against real LLM (manual; requires `claude login` + dev server).
- Manual aspect editing (user adds aspect by hand) — D omits, can land later.

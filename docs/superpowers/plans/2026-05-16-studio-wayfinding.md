# Studio Wayfinding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single shared stage stepper, a dashboard progress indicator, and a "Продолжить" deep-link from the books list so users can move through the 7-stage Studio pipeline without dead-reckoning.

**Architecture:** One pure shared function `computeStudioProgress` (built on the existing `computeRecommendedNextStage`) is the single source of truth. A reusable `<StageStepper>` web component renders it and is embedded in every Studio page. A new batch server endpoint returns the recommended stage per book for the list view. A client route-mapping util (`stageRoute`) is shared by stepper, dashboard, and list.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 18, react-router-dom@7, Hono, better-sqlite3, Vitest + @testing-library/react + MemoryRouter.

Spec: `docs/superpowers/specs/2026-05-16-studio-wayfinding-design.md`

---

## File Structure

- **Modify** `packages/shared/src/studio-warnings.ts` — add `computeStudioProgress` next to `computeRecommendedNextStage` (they live in the same file; spec said "рядом с computeRecommendedNextStage").
- **Test** `packages/shared/src/studio-warnings.test.ts` — append progress cases (file exists).
- **Create** `apps/web/src/lib/studio-routes.ts` — `stageRoute(bookId, stageId)` mapping.
- **Test** `apps/web/src/lib/studio-routes.test.ts`.
- **Create** `apps/web/src/components/studio/StageStepper.tsx`.
- **Test** `apps/web/src/components/studio/__tests__/StageStepper.test.tsx`.
- **Modify** `apps/server/src/routes/studio.ts` — add `GET /books/recommended` (mounted under `/api`).
- **Test** `apps/server/src/routes/__tests__/studio.test.ts` — append endpoint cases.
- **Modify** `apps/web/src/api/client.ts` — add `listRecommended`.
- **Modify** `apps/web/src/pages/StudioPage.tsx` — embed stepper + progress bar + «Продолжить».
- **Modify** `apps/web/src/pages/MarkdownStagePage.tsx` — load concept, embed stepper.
- **Modify** `apps/web/src/pages/EntityStagePage.tsx` — load concept, embed stepper.
- **Modify** `apps/web/src/pages/ChaptersStagePage.tsx` — load concept+studio, embed stepper.
- **Modify** `apps/web/src/pages/SettingsStagePage.tsx` — load concept+studio, embed stepper (no active stage) + keep «← к Studio».
- **Modify** `apps/web/src/pages/BooksListPage.tsx` — fetch `listRecommended`, add «Продолжить →».
- **Modify** the affected page test files to satisfy the new data dependencies.

---

## Task 1: shared `computeStudioProgress`

**Files:**
- Modify: `packages/shared/src/studio-warnings.ts` (append at end of file)
- Test: `packages/shared/src/studio-warnings.test.ts` (append a new `describe`)

Context: `computeRecommendedNextStage({ concept, studioState }): StageId | undefined` already exists in this file (returns `undefined` when every stage is complete/skipped). `STAGE_IDS` and types come from `./studio-state.js`. `computeStudioProgress` must NOT re-implement stage ordering or readiness — it delegates to `computeRecommendedNextStage` and re-reads stage status the same way (via the existing `stageStatus` helper already used in this file).

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/studio-warnings.test.ts`:

```ts
import { computeStudioProgress } from "./studio-warnings.js";
import { emptyBookConcept } from "./concept.js";
import { emptyStudioState, type StudioState } from "./studio-state.js";

describe("computeStudioProgress", () => {
  function stateWith(
    statuses: Partial<Record<string, "complete" | "skipped" | "in_progress">>,
  ): StudioState {
    const s = emptyStudioState();
    for (const [id, status] of Object.entries(statuses)) {
      s.stages[id] = { status: status!, playbookGenerated: false, aspects: [] };
    }
    return s;
  }

  it("empty studio: nothing done, recommended is concept", () => {
    const p = computeStudioProgress(emptyBookConcept(), emptyStudioState());
    expect(p.total).toBe(7);
    expect(p.doneCount).toBe(0);
    expect(p.recommended).toBe("concept");
    expect(p.stages).toHaveLength(7);
    expect(p.stages[0]).toEqual({ id: "concept", status: "current", done: false });
  });

  it("counts complete and skipped as done", () => {
    const p = computeStudioProgress(
      emptyBookConcept(),
      stateWith({ concept: "complete", world: "skipped", lore: "complete" }),
    );
    expect(p.doneCount).toBe(3);
    const byId = Object.fromEntries(p.stages.map((s) => [s.id, s]));
    expect(byId.concept!.done).toBe(true);
    expect(byId.world!.done).toBe(true);
    expect(byId.lore!.done).toBe(true);
    expect(byId.characters!.done).toBe(false);
  });

  it("marks the recommended stage as current", () => {
    const p = computeStudioProgress(
      emptyBookConcept(),
      stateWith({ concept: "complete" }),
    );
    expect(p.recommended).toBe("world");
    const world = p.stages.find((s) => s.id === "world")!;
    expect(world.status).toBe("current");
  });

  it("all done: doneCount 7, recommended undefined, no current", () => {
    const all = stateWith({
      concept: "complete",
      world: "complete",
      lore: "complete",
      characters: "complete",
      items: "complete",
      plot: "complete",
      chapters: "complete",
    });
    const p = computeStudioProgress(emptyBookConcept(), all);
    expect(p.doneCount).toBe(7);
    expect(p.recommended).toBeUndefined();
    expect(p.stages.every((s) => s.status === "done")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/shared test -- src/studio-warnings.test.ts`
Expected: FAIL — `computeStudioProgress` is not exported.

- [ ] **Step 3: Implement**

Append to the end of `packages/shared/src/studio-warnings.ts`:

```ts
export interface StudioStageProgress {
  id: StageId;
  status: "done" | "current" | "todo";
  done: boolean;
}

export interface StudioProgress {
  stages: StudioStageProgress[];
  doneCount: number;
  total: 7;
  recommended: StageId | undefined;
}

export function computeStudioProgress(
  concept: BookConcept,
  studioState: StudioState,
): StudioProgress {
  const recommended = computeRecommendedNextStage({ concept, studioState });
  const stages: StudioStageProgress[] = STAGE_IDS.map((id) => {
    const s = stageStatus(studioState, id) ?? "not_started";
    const done = s === "complete" || s === "skipped";
    const status: StudioStageProgress["status"] = done
      ? "done"
      : id === recommended
        ? "current"
        : "todo";
    return { id, status, done };
  });
  const doneCount = stages.filter((s) => s.done).length;
  return { stages, doneCount, total: 7, recommended };
}
```

Notes for the implementer:
- `STAGE_IDS`, `StageId`, `StudioState` are imported from `./studio-state.js` and `BookConcept` from `./concept.js`. Check the existing import block at the top of `studio-warnings.ts`; add any missing named imports (`STAGE_IDS`, `BookConcept`) to the existing import statements — do not add duplicate import lines.
- `stageStatus(studioState, id)` is the helper already defined/used earlier in this file by `computeRecommendedNextStage`. Reuse it; do not write a new status reader. If it is not exported but file-local, that's fine — `computeStudioProgress` is in the same file.
- `computeRecommendedNextStage` takes a single object arg `{ concept, studioState }` and returns `StageId | undefined`.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/shared test -- src/studio-warnings.test.ts`
Expected: PASS (4 new tests + existing file tests still green).

- [ ] **Step 5: Verify the export is reachable from the package barrel**

Run: `pnpm --filter @book-forge/shared build` (or `pnpm typecheck`)
Expected: clean. `packages/shared/src/index.ts` already does `export * from "./studio-warnings.js"` (it re-exports `computeRecommendedNextStage` consumed by the web app today), so `computeStudioProgress` is automatically exported — confirm by grepping `index.ts` for `studio-warnings`; if for some reason it is named-export, add `computeStudioProgress` there.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/studio-warnings.ts packages/shared/src/studio-warnings.test.ts
git commit -m "feat(shared): computeStudioProgress — single source for stepper/progress"
```

---

## Task 2: client `stageRoute` util

**Files:**
- Create: `apps/web/src/lib/studio-routes.ts`
- Test: `apps/web/src/lib/studio-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/studio-routes.test.ts
import { describe, it, expect } from "vitest";
import { stageRoute } from "./studio-routes";

describe("stageRoute", () => {
  it("concept maps to the studio dashboard", () => {
    expect(stageRoute(3, "concept")).toBe("/books/3/studio");
  });
  it("chapters maps to the chapters page", () => {
    expect(stageRoute(3, "chapters")).toBe("/books/3/studio/chapters");
  });
  it("aspect/entity stages map to their stage route", () => {
    expect(stageRoute(3, "world")).toBe("/books/3/studio/world");
    expect(stageRoute(3, "lore")).toBe("/books/3/studio/lore");
    expect(stageRoute(3, "plot")).toBe("/books/3/studio/plot");
    expect(stageRoute(3, "characters")).toBe("/books/3/studio/characters");
    expect(stageRoute(3, "items")).toBe("/books/3/studio/items");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/lib/studio-routes.test.ts`
Expected: FAIL — cannot resolve `./studio-routes`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/studio-routes.ts
import type { StageId } from "@book-forge/shared";

/** Single source of truth for stage → URL mapping in the web app. */
export function stageRoute(bookId: number, stageId: StageId): string {
  if (stageId === "concept") return `/books/${bookId}/studio`;
  if (stageId === "chapters") return `/books/${bookId}/studio/chapters`;
  // world | lore | plot | characters | items
  return `/books/${bookId}/studio/${stageId}`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/lib/studio-routes.test.ts`
Expected: PASS (6 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/studio-routes.ts apps/web/src/lib/studio-routes.test.ts
git commit -m "feat(web): stageRoute util — stage→URL single source"
```

---

## Task 3: `<StageStepper>` component

**Files:**
- Create: `apps/web/src/components/studio/StageStepper.tsx`
- Test: `apps/web/src/components/studio/__tests__/StageStepper.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/components/studio/__tests__/StageStepper.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StageStepper } from "../StageStepper";
import { emptyBookConcept, emptyStudioState, type StudioState } from "@book-forge/shared";

function stateWith(
  statuses: Partial<Record<string, "complete" | "skipped">>,
): StudioState {
  const s = emptyStudioState();
  for (const [id, status] of Object.entries(statuses)) {
    s.stages[id] = { status: status!, playbookGenerated: false, aspects: [] };
  }
  return s;
}

function renderStepper(props?: Partial<Parameters<typeof StageStepper>[0]>) {
  return render(
    <MemoryRouter>
      <StageStepper
        bookId={3}
        concept={emptyBookConcept()}
        studioState={props?.studioState ?? emptyStudioState()}
        activeStageId={props?.activeStageId}
      />
    </MemoryRouter>,
  );
}

describe("StageStepper", () => {
  it("renders all 7 stages as links with correct targets", () => {
    renderStepper();
    const nav = screen.getByRole("navigation", { name: "Этапы книги" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(within(nav).getByRole("link", { name: /Концепт/ })).toHaveAttribute(
      "href",
      "/books/3/studio",
    );
    expect(within(nav).getByRole("link", { name: /Главы/ })).toHaveAttribute(
      "href",
      "/books/3/studio/chapters",
    );
    expect(within(nav).getByRole("link", { name: /Мир/ })).toHaveAttribute(
      "href",
      "/books/3/studio/world",
    );
  });

  it("shows the done count out of 7", () => {
    renderStepper({ studioState: stateWith({ concept: "complete", world: "skipped" }) });
    expect(screen.getByText("2/7")).toBeInTheDocument();
  });

  it("marks the active stage with aria-current=step", () => {
    renderStepper({ activeStageId: "lore" });
    const active = screen.getByRole("link", { name: /Лор/ });
    expect(active).toHaveAttribute("aria-current", "step");
  });

  it("no aria-current when activeStageId is undefined (e.g. settings)", () => {
    renderStepper({ activeStageId: undefined });
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("aria-current") === "step")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/__tests__/StageStepper.test.tsx`
Expected: FAIL — cannot resolve `../StageStepper`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/components/studio/StageStepper.tsx
import { Link } from "react-router-dom";
import {
  STAGE_IDS,
  computeStudioProgress,
  type BookConcept,
  type StageId,
  type StudioState,
} from "@book-forge/shared";
import { stageRoute } from "@/lib/studio-routes";

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Концепт",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "Сюжет",
  chapters: "Главы",
};

const STATUS_ICON: Record<"done" | "current" | "todo", string> = {
  done: "✓",
  current: "▶",
  todo: "●",
};

interface StageStepperProps {
  bookId: number;
  concept: BookConcept;
  studioState: StudioState;
  /** Highlight "you are here"; undefined for non-stage pages (e.g. settings). */
  activeStageId?: StageId;
}

export function StageStepper({
  bookId,
  concept,
  studioState,
  activeStageId,
}: StageStepperProps) {
  const progress = computeStudioProgress(concept, studioState);
  const byId = new Map(progress.stages.map((s) => [s.id, s]));

  return (
    <nav
      aria-label="Этапы книги"
      className="flex items-center gap-2 flex-wrap text-sm"
    >
      <span
        className="text-xs font-medium text-[var(--color-muted-foreground)] mr-1"
        aria-label={`Готово ${progress.doneCount} из 7`}
      >
        {progress.doneCount}/7
      </span>
      {STAGE_IDS.map((id) => {
        const stage = byId.get(id);
        const status = stage?.status ?? "todo";
        const skipped =
          studioState.stages[id]?.status === "skipped";
        const isActive = activeStageId === id;
        const icon = skipped ? "↷" : STATUS_ICON[status];
        return (
          <Link
            key={id}
            to={stageRoute(bookId, id)}
            data-stage-id={id}
            {...(isActive ? { "aria-current": "step" as const } : {})}
            className={
              "inline-flex items-center gap-1 rounded px-2 py-1 " +
              (isActive
                ? "bg-blue-100 text-blue-800 font-medium"
                : "hover:bg-[var(--color-muted)] text-[var(--color-foreground)]")
            }
          >
            <span aria-hidden="true">{icon}</span>
            <span>{STAGE_LABELS[id]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/components/studio/__tests__/StageStepper.test.tsx`
Expected: PASS (4 tests). Then `pnpm typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/StageStepper.tsx apps/web/src/components/studio/__tests__/StageStepper.test.tsx
git commit -m "feat(web): StageStepper component"
```

---

## Task 4: server `GET /api/books/recommended` + client method

**Files:**
- Modify: `apps/server/src/routes/studio.ts` (add one route handler in the existing `createStudioRoute`)
- Test: `apps/server/src/routes/__tests__/studio.test.ts` (append)
- Modify: `apps/web/src/api/client.ts` (add `listRecommended`)

Context: `createStudioRoute(sqlite)` builds a Hono router `r` mounted at `/api`. It already constructs `const repo = createStudioRepository(sqlite)` and exposes `repo.loadConcept(id)` / `repo.loadStudioState(id)` (both return defaults for a book with no saved data). Server test helper: `apps/server/src/routes/__tests__/_helpers.ts` exports `makeTestApp()`, `send`, `sendJson`; books are created via `POST /api/books`.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("studio routes", ...)` block in `apps/server/src/routes/__tests__/studio.test.ts` (it already imports `send`, `sendJson`, `emptyBookConcept`, and has the `createBook()` helper):

```ts
  it("GET /api/books/recommended returns concept for a fresh book", async () => {
    const id = await createBook();
    const r = await send(t.app, "/api/books/recommended", "GET");
    expect(r.status).toBe(200);
    const map = (await r.json()) as Record<string, string>;
    expect(map[String(id)]).toBe("concept");
  });

  it("GET /api/books/recommended advances after concept is completed", async () => {
    const id = await createBook();
    // Mark the concept stage complete via studio-state PATCH.
    const current = await sendJson<{ revision: number }>(
      t.app,
      `/api/books/${id}/studio-state`,
      "GET",
    );
    await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: current.revision,
      next: {
        schemaVersion: 1,
        revision: current.revision,
        stages: {
          concept: { status: "complete", playbookGenerated: false, aspects: [] },
        },
      },
    });
    const r = await send(t.app, "/api/books/recommended", "GET");
    const map = (await r.json()) as Record<string, string>;
    expect(map[String(id)]).toBe("world");
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/studio.test.ts`
Expected: FAIL — `/api/books/recommended` returns 404 (route not defined) so `map[String(id)]` is undefined.

- [ ] **Step 3: Implement the route**

In `apps/server/src/routes/studio.ts`, add the import for `computeStudioProgress` to the existing `@book-forge/shared` import block (it already imports `bookConceptSchema`, `studioStateSchema`, `computeStudioWarnings`, etc. — add `computeStudioProgress` to that same destructured import).

Then, inside `createStudioRoute`, register this handler. Place it **before** any `r.get("/books/:id/...")` parametric routes so the literal `recommended` segment is matched first (Hono matches in registration order; `:id` would otherwise capture `"recommended"`):

```ts
  r.get("/books/recommended", (c) => {
    const rows = sqlite
      .prepare("SELECT id FROM books")
      .all() as { id: number }[];
    const out: Record<number, string> = {};
    for (const { id } of rows) {
      const concept = repo.loadConcept(id);
      const studioState = repo.loadStudioState(id);
      const progress = computeStudioProgress(concept, studioState);
      out[id] = progress.recommended ?? "chapters";
    }
    return c.json(out);
  });
```

Notes:
- `repo` is the `createStudioRepository(sqlite)` instance already in scope inside `createStudioRoute`. Use it; do not create a second repository.
- Registration order matters. Find where `r.get("/books/:id/concept", ...)` is registered (~line 130) and register `r.get("/books/recommended", ...)` **above** it (anywhere earlier in the function body, e.g. right after `const repo = ...`).
- `computeStudioProgress(concept, studioState)` is the Task 1 function. `recommended` is `StageId | undefined`; `?? "chapters"` gives a sane deep-link target when the whole book is done.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/studio.test.ts`
Expected: PASS (2 new tests + existing studio tests still green).

- [ ] **Step 5: Add the client method**

In `apps/web/src/api/client.ts`, near the existing `getStudioState` / `getStudioWarnings` entries, add a new method to the `api` object:

```ts
  listRecommended: () =>
    req<Record<number, StageId>>("/api/books/recommended"),
```

Ensure `StageId` is imported in `client.ts` from `@book-forge/shared` (the file already imports `StudioState`, `StudioWarning`, etc. from there — add `StageId` to that type import if absent).

- [ ] **Step 6: Verify typecheck**

Run: `pnpm typecheck`
Expected: clean across all packages.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/studio.ts apps/server/src/routes/__tests__/studio.test.ts apps/web/src/api/client.ts
git commit -m "feat: GET /api/books/recommended + api.listRecommended"
```

---

## Task 5: StudioPage — stepper + progress + «Продолжить»

**Files:**
- Modify: `apps/web/src/pages/StudioPage.tsx`
- Test: `apps/web/src/pages/StudioPage.test.tsx` (create if absent; otherwise append)

Context: `StudioPage` already loads `concept`, `studio` (StudioState), `warnings` via `Promise.all` and computes `recommended` with `computeRecommendedNextStage`. It currently renders a `<nav aria-label="Навигация по студии">` with ⚙ Настройки / 📚 Главы links and a stage-card grid. Keep the Settings/Chapters nav (it serves a different purpose — quick access to non-stage pages). Add the stepper + progress block.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/StudioPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StudioPage } from "./StudioPage";
import { api } from "@/api/client";
import { emptyBookConcept, emptyStudioState } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getConcept: vi.fn(),
    getStudioState: vi.fn(),
    getStudioWarnings: vi.fn(),
    patchConcept: vi.fn(),
    refineConceptField: vi.fn(),
  },
}));

const m = vi.mocked(api);

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio"]}>
      <Routes>
        <Route path="/books/:bookId/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StudioPage progress", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows done count and a Продолжить link to the recommended stage", async () => {
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    m.getStudioWarnings.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByText(/Готово 0\/7/));
    const cont = screen.getByRole("link", { name: /Продолжить/ });
    // Empty studio → recommended is "concept" → /books/3/studio
    expect(cont).toHaveAttribute("href", "/books/3/studio");
    // Stepper present
    expect(
      screen.getByRole("navigation", { name: "Этапы книги" }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/pages/StudioPage.test.tsx`
Expected: FAIL — no "Готово 0/7" / no «Продолжить» link / no "Этапы книги" nav yet.

- [ ] **Step 3: Implement**

In `apps/web/src/pages/StudioPage.tsx`:

(a) Add imports:

```tsx
import { StageStepper } from "@/components/studio/StageStepper";
import { stageRoute } from "@/lib/studio-routes";
import { computeStudioProgress } from "@book-forge/shared";
```

(b) After the loading/error guards (where `concept`, `studio`, `warnings` are guaranteed non-null) and near the existing `recommended` computation, add:

```tsx
  const progress = computeStudioProgress(concept, studio);
  const continueStage = progress.recommended ?? "chapters";
```

(c) In the returned JSX, immediately after the existing header `<div>` that holds `<h1>Studio</h1>` and the Settings/Chapters `<nav>`, insert:

```tsx
      <StageStepper
        bookId={bookId}
        concept={concept}
        studioState={studio}
        activeStageId="concept"
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="h-2 flex-1 min-w-[8rem] rounded bg-[var(--color-muted)] overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={7}
          aria-valuenow={progress.doneCount}
        >
          <div
            className="h-full bg-blue-500"
            style={{ width: `${(progress.doneCount / 7) * 100}%` }}
          />
        </div>
        <span className="text-sm text-[var(--color-muted-foreground)]">
          Готово {progress.doneCount}/7
          {progress.recommended
            ? ` · Далее: ${STAGE_LABELS[progress.recommended]}`
            : " · Книга проработана"}
        </span>
        <Link
          to={stageRoute(bookId, continueStage)}
          className="text-sm border border-blue-600 text-blue-600 rounded-md px-3 py-1 hover:bg-blue-600 hover:text-white"
        >
          Продолжить →
        </Link>
      </div>
```

`STAGE_LABELS` and `Link` already exist in `StudioPage.tsx` (the file defines a `STAGE_LABELS: Record<StageId,string>` and imports `Link`). `bookId` is the numeric id already in scope.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/pages/StudioPage.test.tsx`
Expected: PASS. Then full web suite `pnpm --filter @book-forge/web test` — all green (existing StudioPage-dependent tests, if any, still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/StudioPage.tsx apps/web/src/pages/StudioPage.test.tsx
git commit -m "feat(web): StudioPage stepper + progress bar + Продолжить"
```

---

## Task 6: MarkdownStagePage — load concept, embed stepper

**Files:**
- Modify: `apps/web/src/pages/MarkdownStagePage.tsx`

Context: `MarkdownStagePage` currently loads only `api.getStudioState(bookId)` into `studio` and renders a header `<div>` with `<h1>{STAGE_LABELS[stageId]}</h1>` and a `<Link to={/books/:id/studio}>← к Studio</Link>`. The stepper needs `concept` too. `stageId` is one of `world|lore|plot`.

- [ ] **Step 1: Add concept to the load**

In the component, add a `concept` state and load it alongside studio. Replace the existing effect's single fetch:

```tsx
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [error, setError] = useState<string | null>(null);
```

with an added concept state:

```tsx
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [concept, setConcept] = useState<BookConcept | null>(null);
  const [error, setError] = useState<string | null>(null);
```

and change the effect body that does `const s = await api.getStudioState(bookId); if (alive) setStudio(s);` to:

```tsx
        const [s, c] = await Promise.all([
          api.getStudioState(bookId),
          api.getConcept(bookId),
        ]);
        if (alive) {
          setStudio(s);
          setConcept(c);
        }
```

Add `BookConcept` to the `@book-forge/shared` type import. Update the loading guard from `if (!studio)` to `if (!studio || !concept)` (keep the same loading UI).

- [ ] **Step 2: Embed the stepper**

Add import:

```tsx
import { StageStepper } from "@/components/studio/StageStepper";
```

Replace the existing header block:

```tsx
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">{STAGE_LABELS[stageId]}</h1>
        <Link to={`/books/${bookId}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>
```

with:

```tsx
      <StageStepper
        bookId={bookId}
        concept={concept}
        studioState={studio}
        activeStageId={stageId}
      />
      <h1 className="text-3xl font-bold">{STAGE_LABELS[stageId]}</h1>
```

(The `← к Studio` link is intentionally removed — the stepper's "Концепт" segment returns to the dashboard. `Link` may now be unused; if TypeScript/lint flags an unused `Link` import, remove it from the import line.)

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: clean + green. If a `MarkdownStagePage` test exists and mocked only `getStudioState`, add `getConcept: vi.fn().mockResolvedValue(emptyBookConcept())` to its `@/api/client` mock and import `emptyBookConcept` from `@book-forge/shared`. If no such test exists, nothing to update.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/MarkdownStagePage.tsx
git commit -m "feat(web): MarkdownStagePage embeds StageStepper"
```

---

## Task 7: EntityStagePage — load concept, embed stepper

**Files:**
- Modify: `apps/web/src/pages/EntityStagePage.tsx`

Context: same shape as MarkdownStagePage — currently loads studio state only, header has `<h1>{STAGE_LABELS[stageId]}</h1>` + `<Link to={/books/:id/studio}>← к Studio</Link>`. `stageId` is `characters|items`.

- [ ] **Step 1: Add concept to the load**

Mirror Task 6 Step 1 exactly in `EntityStagePage.tsx`: add `const [concept, setConcept] = useState<BookConcept | null>(null);`, load it via `Promise.all` together with the existing `api.getStudioState(bookId)` call, set both, add `BookConcept` to the shared type import, and extend the loading guard to also require `concept`.

If `EntityStagePage` currently does not load studio via a simple `getStudioState` call (inspect the actual effect), keep its existing studio-loading mechanism and only add a parallel `api.getConcept(bookId)` fetch storing into a new `concept` state, gating render on it.

- [ ] **Step 2: Embed the stepper**

Add `import { StageStepper } from "@/components/studio/StageStepper";`. Replace the header block:

```tsx
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">{STAGE_LABELS[stageId]}</h1>
        <Link to={`/books/${bookId}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>
```

with:

```tsx
      <StageStepper
        bookId={bookId}
        concept={concept}
        studioState={studio}
        activeStageId={stageId as StageId}
      />
      <h1 className="text-3xl font-bold">{STAGE_LABELS[stageId]}</h1>
```

`StageId` is already imported in `EntityStagePage.tsx` (it casts `stageId as StageId` elsewhere). Remove the now-unused `Link` import if flagged.

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: clean + green. Update any existing EntityStagePage test's `@/api/client` mock to include `getConcept` returning `emptyBookConcept()` (same as Task 6 Step 3).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/EntityStagePage.tsx
git commit -m "feat(web): EntityStagePage embeds StageStepper"
```

---

## Task 8: ChaptersStagePage + SettingsStagePage — embed stepper

**Files:**
- Modify: `apps/web/src/pages/ChaptersStagePage.tsx`
- Modify: `apps/web/src/pages/SettingsStagePage.tsx`
- Test: `apps/web/src/pages/ChaptersStagePage.test.tsx`, `apps/web/src/pages/SettingsStagePage.test.tsx` (update mocks)

Context: `ChaptersStagePage` loads `getBook` + `listChapters`; `SettingsStagePage` loads `getBook` + `listStyleProfiles`. Neither has concept/studioState. Both have a header `<div>` with an `<h1>` and a `<Link to={/books/:id/studio}>← к Studio</Link>`.

- [ ] **Step 1: ChaptersStagePage — load concept + studio, embed stepper**

Add states and parallel loads. Change the `load()` Promise.all from:

```tsx
      const [b, chs] = await Promise.all([
        api.getBook(id),
        api.listChapters(id),
      ]);
      setBook(b);
      setChapters(chs);
```

to:

```tsx
      const [b, chs, c, s] = await Promise.all([
        api.getBook(id),
        api.listChapters(id),
        api.getConcept(id),
        api.getStudioState(id),
      ]);
      setBook(b);
      setChapters(chs);
      setConcept(c);
      setStudio(s);
```

Add states near the others: `const [concept, setConcept] = useState<BookConcept | null>(null);` and `const [studio, setStudio] = useState<StudioState | null>(null);`. Add `BookConcept, StudioState` to the shared type import. Extend the loading guard `if (!book || chapters === null)` → `if (!book || chapters === null || !concept || !studio)`.

Add `import { StageStepper } from "@/components/studio/StageStepper";`. Replace the header block:

```tsx
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Главы</h1>
        <Link to={`/books/${id}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>
```

with:

```tsx
      <StageStepper
        bookId={id}
        concept={concept}
        studioState={studio}
        activeStageId="chapters"
      />
      <h1 className="text-3xl font-bold">Главы</h1>
```

Remove the now-unused `Link` import only if nothing else in the file uses `Link` (the sortable chapter rows DO use `Link` — so keep the import).

- [ ] **Step 2: SettingsStagePage — load concept + studio, embed inactive stepper, keep «← к Studio»**

In `SettingsStagePage.tsx`, extend `load()`'s Promise.all from `[api.getBook(id), api.listStyleProfiles()]` to also fetch `api.getConcept(id)` and `api.getStudioState(id)`, storing into new `concept` / `studio` states (`BookConcept | null`, `StudioState | null`), add `BookConcept, StudioState` to the shared import, and require them in the `if (!book)` guard → `if (!book || !concept || !studio)`.

Add `import { StageStepper } from "@/components/studio/StageStepper";`. Replace the header block:

```tsx
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Настройки</h1>
        <Link to={`/books/${id}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>
```

with (settings is NOT a stage → no `activeStageId`; keep the explicit back-link):

```tsx
      <StageStepper bookId={id} concept={concept} studioState={studio} />
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Настройки</h1>
        <Link to={`/books/${id}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>
```

(`Link` stays imported — still used here.)

- [ ] **Step 3: Update existing page tests' API mocks**

`ChaptersStagePage.test.tsx`: the `@/api/client` mock currently has `getBook, listChapters, createChapter, updateChapter`. Add `getConcept: vi.fn(), getStudioState: vi.fn()` to the mock object. In each test that renders successfully (the "renders chapter list" and "adds a chapter" tests), add `m.getConcept.mockResolvedValue(emptyBookConcept() as never);` and `m.getStudioState.mockResolvedValue(emptyStudioState() as never);` alongside the existing `m.getBook`/`m.listChapters` mock setup. Import `emptyBookConcept, emptyStudioState` from `@book-forge/shared`. The "non-numeric bookId" test does not need them (guard returns before load). Keep all existing assertions.

`SettingsStagePage.test.tsx`: add `getConcept: vi.fn(), getStudioState: vi.fn()` to the `@/api/client` mock. In the "renders settings…" and "saves without sending premise" tests add `m.getConcept.mockResolvedValue(emptyBookConcept() as never);` and `m.getStudioState.mockResolvedValue(emptyStudioState() as never);`. Import the factories from `@book-forge/shared`. The non-numeric-bookId guard test needs nothing extra.

- [ ] **Step 4: Typecheck + full web suite**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: clean + all green (including the updated Chapters/Settings tests and StageStepper/StudioPage tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ChaptersStagePage.tsx apps/web/src/pages/SettingsStagePage.tsx apps/web/src/pages/ChaptersStagePage.test.tsx apps/web/src/pages/SettingsStagePage.test.tsx
git commit -m "feat(web): ChaptersStagePage & SettingsStagePage embed StageStepper"
```

---

## Task 9: BooksListPage — «Продолжить» deep-link

**Files:**
- Modify: `apps/web/src/pages/BooksListPage.tsx`
- Test: `apps/web/src/pages/BooksListPage.test.tsx` (append)

Context: `BooksListPage` loads `api.listBooks()` into `books`, renders each as a `<li>` containing `<Link to={/books/${b.id}/studio}>`. It already has `navigate` (Task 6 of the previous plan added create→Studio). The list-item title link stays as-is; add a separate «Продолжить →» link per book using the recommended map.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/pages/BooksListPage.test.tsx`:

```tsx
  it("shows a Продолжить link to the recommended stage per book", async () => {
    m.listBooks.mockResolvedValue([
      {
        id: 7,
        title: "Маяк",
        status: "draft",
        createdAt: new Date().toISOString(),
      },
    ] as never);
    m.listRecommended.mockResolvedValue({ 7: "plot" } as never);
    render(
      <MemoryRouter initialEntries={["/books"]}>
        <Routes>
          <Route path="/books" element={<BooksListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const cont = await screen.findByRole("link", { name: /Продолжить/ });
    expect(cont).toHaveAttribute("href", "/books/7/studio/plot");
  });

  it("still renders the list if listRecommended fails", async () => {
    m.listBooks.mockResolvedValue([
      {
        id: 7,
        title: "Маяк",
        status: "draft",
        createdAt: new Date().toISOString(),
      },
    ] as never);
    m.listRecommended.mockRejectedValue(new Error("boom") as never);
    render(
      <MemoryRouter initialEntries={["/books"]}>
        <Routes>
          <Route path="/books" element={<BooksListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Маяк")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Продолжить/ }),
    ).not.toBeInTheDocument();
  });
```

Add `listRecommended: vi.fn()` to the existing `@/api/client` mock object in this test file (it currently mocks `{ listBooks, createBook }`).

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: FAIL — no «Продолжить» link rendered.

- [ ] **Step 3: Implement**

In `apps/web/src/pages/BooksListPage.tsx`:

(a) Imports:

```tsx
import { stageRoute } from "@/lib/studio-routes";
import type { StageId } from "@book-forge/shared";
```

(b) Add state and load the map. Add near the existing `books` state:

```tsx
  const [recommended, setRecommended] = useState<Record<number, StageId>>({});
```

In the existing `load()` (which currently does `setBooks(await api.listBooks());`), change to fetch both and degrade gracefully on recommended failure:

```tsx
  async function load() {
    setError(null);
    try {
      const list = await api.listBooks();
      setBooks(list);
      try {
        setRecommended(await api.listRecommended());
      } catch {
        setRecommended({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
```

(c) In the book `<li>` (the one rendering `<Link to={/books/${b.id}/studio}>` with the title), add a «Продолжить →» link when a recommendation exists for that book. Inside the `<li>`, after the title `<Link>`, add:

```tsx
                {recommended[b.id] ? (
                  <Link
                    to={stageRoute(b.id, recommended[b.id]!)}
                    className="text-xs text-blue-600 underline mt-1 inline-block"
                  >
                    Продолжить →
                  </Link>
                ) : null}
```

(The title `<Link>` is unchanged and still points to `/books/${b.id}/studio`.)

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: PASS (new + existing BooksListPage tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BooksListPage.tsx apps/web/src/pages/BooksListPage.test.tsx
git commit -m "feat(web): BooksListPage Продолжить deep-link to recommended stage"
```

---

## Task 10: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Typecheck all packages**

Run: `pnpm typecheck`
Expected: clean across shared, retrieval, llm, agents, style-engine, server, web.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS across all packages. Pay attention to: shared (`computeStudioProgress`), web (StageStepper, studio-routes, StudioPage, BooksListPage, Chapters/Settings updated), server (`/api/books/recommended`).

- [ ] **Step 3: Manual smoke (document only, no code)**

Confirm by reading the diff that: every Studio page renders `<StageStepper>`; concept segment → `/studio`, chapters → `/studio/chapters`, others → `/studio/{id}`; StudioPage shows progress bar + «Продолжить»; BooksListPage shows per-book «Продолжить» when `listRecommended` resolves and degrades silently when it rejects; no page lost its data-loading guard.

- [ ] **Step 4: Commit (only if Steps 1–2 required a fixup)**

If a cross-cutting fix was needed:

```bash
git add -A
git commit -m "fix(web): wayfinding integration fixups"
```

Otherwise nothing to commit — the feature is complete.

---

## Self-Review

**Spec coverage:**
- §1 `computeStudioProgress` (done rule, concept via recommended, recommended delegation) → Task 1. ✓
- §2 `<StageStepper>` (7 links, icons, free jump, route map, aria-current, doneCount) → Task 3; route map → Task 2. ✓
- §2 embedding in all 5 pages → Tasks 5,6,7,8. ✓ (StudioPage active=concept; Markdown/Entity active=stageId; Chapters active=chapters; Settings inactive + keeps ← к Studio.)
- §3 dashboard progress bar + «Продолжить» → Task 5. ✓
- §4 server `/api/books/recommended` + client `listRecommended` + BooksListPage «Продолжить», graceful degrade, title link unchanged, no X/7 in list → Tasks 4, 9. ✓
- §5 tests (shared matrix, stepper, StudioPage, BooksListPage incl. failure path, server route, regression mocks) → Tasks 1,3,4,5,8,9. ✓
- Out-of-scope respected: no gating, no list X/7, no aspect weighting, no migrations, no STAGE_LABELS refactor (stepper has its own map; existing per-page maps untouched). ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The only conditional instructions ("if a MarkdownStagePage test exists") are explicit branch instructions with concrete actions, not deferrals. ✓

**Type consistency:** `computeStudioProgress(concept: BookConcept, studioState: StudioState): StudioProgress` defined Task 1, consumed identically in Tasks 3 & 5 & 4. `stageRoute(bookId: number, stageId: StageId): string` defined Task 2, consumed Tasks 3,5,9. `api.listRecommended(): Promise<Record<number, StageId>>` defined Task 4, consumed Task 9. `StageStepper` props `{ bookId:number, concept:BookConcept, studioState:StudioState, activeStageId?:StageId }` defined Task 3, used Tasks 5–8 with matching prop names/types. `computeRecommendedNextStage` is called only inside Task 1 (object arg `{concept,studioState}`, returns `StageId|undefined`) — consistent with its real signature in `studio-warnings.ts`.

**Note (registration order):** Task 4 explicitly registers `/books/recommended` before `/books/:id/...` parametric routes — required so `:id` does not capture the literal `recommended`. Called out in the task body.

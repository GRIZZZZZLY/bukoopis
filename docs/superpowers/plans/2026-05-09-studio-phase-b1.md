# Studio Phase B1 — Concept Form (Genre/Tone Multi-Select, no LLM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land an editable Concept form on `/books/:bookId/studio` — multi-select genres (with hierarchy + incompatible warnings), multi-select tones, audience radio, plain premise textareas — saved via existing `PATCH /api/books/:id/concept`. **No LLM in this phase.** Premise puzzle (`concept_refiner` agent) is Phase B2.

**Architecture:** Expand the static `genre-registry.ts` with deeper subgenres + tones; add 3 small presentational React components (`AudiencePicker`, `TonePicker`, `GenrePicker`) plus one container `ConceptForm` that fetches `BookConcept`, manages local edit state, and persists on Save. Mount `ConceptForm` at top of `StudioPage` above the existing stages grid. Keep components stateless where possible — controlled inputs driven by `concept` state in the container.

**Tech Stack:** TypeScript 5.7 strict + noUncheckedIndexedAccess, React 18, Tailwind 4, Zod 4, react-router-dom 7, vitest 2.1 + @testing-library/react 16.

---

## Pre-conditions

- Phase A merged on `main` (commit `94e39cd`).
- `pnpm -r typecheck` and `pnpm -r test` green at start (230 tests).
- `packages/shared/src/genre-registry.ts` already has `GenreDefinition`/`ToneDefinition` types and a 7-genre / 6-tone seed.
- `apps/web/src/api/client.ts` already has `getConcept` / `patchConcept`.
- `apps/web/src/pages/StudioPage.tsx` already fetches `BookConcept` and stores it in state.

## Files to create

| File | Purpose |
|---|---|
| `packages/shared/src/genre-registry.test.ts` | Tests for `getGenreById`/`getToneById`/registry shape after expansion. |
| `apps/web/src/components/studio/concept/AudiencePicker.tsx` | Radio for `ya | adult | all_ages | mg`. |
| `apps/web/src/components/studio/concept/TonePicker.tsx` | Multi-select chip grid backed by `TONES`. |
| `apps/web/src/components/studio/concept/GenrePicker.tsx` | Hierarchical multi-select backed by `GENRES`, surfaces `incompatibleWith` warnings inline. |
| `apps/web/src/components/studio/concept/ConceptForm.tsx` | Container: fetch → edit → save. |
| `apps/web/src/components/studio/concept/__tests__/GenrePicker.test.tsx` | Renders, toggles, emits onChange, surfaces incompatibility. |
| `apps/web/src/components/studio/concept/__tests__/TonePicker.test.tsx` | Renders + toggles. |
| `apps/web/src/components/studio/concept/__tests__/ConceptForm.test.tsx` | Save flow (mocked api). |

## Files to modify

| File | Reason |
|---|---|
| `packages/shared/src/genre-registry.ts` | Expand `GENRES` (≥15 entries with deeper hierarchy) and `TONES` (≥8 entries). Add `getGenreChildren`/`getRootGenres` helpers. |
| `apps/web/src/pages/StudioPage.tsx` | Mount `ConceptForm` above the stages grid; lift refresh of warnings/concept after save. |

## Files NOT to modify

- `apps/server/**` — Phase A endpoint already accepts `BookConcept` body and validates via Zod. No server work in B1.
- `apps/web/src/api/client.ts` — `patchConcept` already exists.
- All schemas in `@book-forge/shared` other than the registry — `BookConcept` is final for Phase B1.
- `packages/agents/**` — no agents in B1.

## Conventions

- Web tests use `vitest` + `@testing-library/react` + `jsdom` (already configured per `apps/web/package.json`).
- Component files are PascalCase; one default export per file is fine but prefer named exports for consistency with existing components (`StageCard`, `WarningsFeed`).
- All user-facing strings in Russian; ID strings (genre/tone keys) stay English.
- Tailwind utility classes preferred; CSS vars `var(--color-border)` etc. continue per Phase A pattern.
- ConceptForm owns the network and dirty-state. Pickers are controlled inputs (no internal state for selected values).

---

## Task 1: Expand genre/tone registry + helpers

**Files:**
- Modify: `packages/shared/src/genre-registry.ts`
- Create: `packages/shared/src/genre-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/genre-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  GENRES,
  TONES,
  getGenreById,
  getToneById,
  getRootGenres,
  getGenreChildren,
} from "./genre-registry.js";

describe("genre-registry expanded seed", () => {
  it("has at least 15 genres covering core trees", () => {
    expect(GENRES.length).toBeGreaterThanOrEqual(15);
    expect(getGenreById("fantasy")).toBeDefined();
    expect(getGenreById("sci_fi")).toBeDefined();
    expect(getGenreById("mystery")).toBeDefined();
    expect(getGenreById("horror")).toBeDefined();
    expect(getGenreById("romance")).toBeDefined();
  });

  it("has at least 8 tones", () => {
    expect(TONES.length).toBeGreaterThanOrEqual(8);
    expect(getToneById("dark")).toBeDefined();
    expect(getToneById("hopeful")).toBeDefined();
  });

  it("getRootGenres returns only genres without parentId", () => {
    const roots = getRootGenres();
    for (const g of roots) expect(g.parentId).toBeUndefined();
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThan(GENRES.length); // because some are children
  });

  it("getGenreChildren returns direct descendants", () => {
    const fantasyKids = getGenreChildren("fantasy");
    expect(fantasyKids.length).toBeGreaterThan(0);
    for (const k of fantasyKids) expect(k.parentId).toBe("fantasy");
  });

  it("getGenreChildren returns empty array for leaf genre", () => {
    const leafId = GENRES.find((g) => getGenreChildren(g.id).length === 0)?.id;
    expect(leafId).toBeDefined();
    if (leafId) expect(getGenreChildren(leafId)).toEqual([]);
  });

  it("incompatibleWith references resolve to existing genres", () => {
    for (const g of GENRES) {
      if (!g.incompatibleWith) continue;
      for (const ref of g.incompatibleWith) {
        expect(getGenreById(ref)).toBeDefined();
      }
    }
  });

  it("parentId references resolve", () => {
    for (const g of GENRES) {
      if (!g.parentId) continue;
      expect(getGenreById(g.parentId)).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/shared test`
Expected: FAIL — `getRootGenres` / `getGenreChildren` not exported AND registry size assertions fail (current seed has 7 genres / 6 tones).

- [ ] **Step 3: Expand the registry + add helpers**

Replace the contents of `packages/shared/src/genre-registry.ts` with:

```ts
export interface GenreDefinition {
  id: string;
  label: string;
  parentId?: string;
  promptHints: string[];
  incompatibleWith?: string[];
}

export interface ToneDefinition {
  id: string;
  label: string;
  promptHints: string[];
}

export const GENRES: readonly GenreDefinition[] = [
  // ─── Fantasy tree ───────────────────────────────────────────
  {
    id: "fantasy",
    label: "Фэнтези",
    promptHints: ["магия как часть мира", "не-современный сеттинг"],
  },
  {
    id: "fantasy.dark_fantasy",
    label: "Тёмное фэнтези",
    parentId: "fantasy",
    promptHints: ["мрак", "моральная серость", "цена силы"],
  },
  {
    id: "fantasy.romantasy",
    label: "Романтэзи",
    parentId: "fantasy",
    promptHints: ["центральная любовная линия", "эмоциональный накал"],
  },
  {
    id: "fantasy.high_fantasy",
    label: "Высокое фэнтези",
    parentId: "fantasy",
    promptHints: ["эпичный масштаб", "выраженная мифология"],
    incompatibleWith: ["sci_fi.hard_sci_fi"],
  },
  {
    id: "fantasy.urban_fantasy",
    label: "Городское фэнтези",
    parentId: "fantasy",
    promptHints: ["современный город", "магия скрыта от обывателей"],
  },
  // ─── Sci-fi tree ────────────────────────────────────────────
  {
    id: "sci_fi",
    label: "Научная фантастика",
    promptHints: ["технологии как двигатель", "будущее или альтернативное настоящее"],
    incompatibleWith: ["fantasy.high_fantasy"],
  },
  {
    id: "sci_fi.hard_sci_fi",
    label: "Твёрдая НФ",
    parentId: "sci_fi",
    promptHints: ["правдоподобная физика", "технические детали"],
    incompatibleWith: ["fantasy"],
  },
  {
    id: "sci_fi.space_opera",
    label: "Космоопера",
    parentId: "sci_fi",
    promptHints: ["масштаб галактики", "героика, политика и звездные флоты"],
  },
  {
    id: "sci_fi.cyberpunk",
    label: "Киберпанк",
    parentId: "sci_fi",
    promptHints: ["high tech / low life", "корпорации", "цифровая идентичность"],
  },
  // ─── Mystery / thriller tree ────────────────────────────────
  {
    id: "mystery",
    label: "Детектив",
    promptHints: ["загадка", "расследование", "ключи и улики"],
  },
  {
    id: "mystery.cozy_mystery",
    label: "Уютный детектив",
    parentId: "mystery",
    promptHints: ["камерное место действия", "минимум насилия"],
  },
  {
    id: "thriller",
    label: "Триллер",
    promptHints: ["напряжение", "опасность", "темп"],
  },
  // ─── Horror ─────────────────────────────────────────────────
  {
    id: "horror",
    label: "Хоррор",
    promptHints: ["страх", "сверхъестественное или психологическое"],
  },
  // ─── Romance tree ──────────────────────────────────────────
  {
    id: "romance",
    label: "Любовный роман",
    promptHints: ["центральная любовная линия", "счастливый или горько-сладкий финал"],
  },
  // ─── Literary ──────────────────────────────────────────────
  {
    id: "literary",
    label: "Литературное",
    promptHints: ["язык", "психологизм", "символика"],
  },
  // ─── Historical ────────────────────────────────────────────
  {
    id: "historical",
    label: "Историческое",
    promptHints: ["реальная эпоха", "достоверность деталей"],
  },
] as const;

export const TONES: readonly ToneDefinition[] = [
  { id: "dark", label: "Мрачный", promptHints: ["напряжение", "потери"] },
  { id: "gritty", label: "Жёсткий", promptHints: ["реализм насилия", "грязь"] },
  { id: "romantic", label: "Романтичный", promptHints: ["чувственность", "тоска"] },
  { id: "comedic", label: "Комедийный", promptHints: ["юмор", "лёгкость"] },
  { id: "hopeful", label: "Светлый", promptHints: ["надежда", "тёплые финалы"] },
  { id: "melancholic", label: "Меланхоличный", promptHints: ["осенняя грусть"] },
  { id: "tense", label: "Напряжённый", promptHints: ["саспенс", "ожидание удара"] },
  { id: "whimsical", label: "Игривый", promptHints: ["сказочность", "лёгкая ирония"] },
  { id: "epic", label: "Эпичный", promptHints: ["масштаб", "патетика"] },
] as const;

const GENRE_INDEX = new Map(GENRES.map((g) => [g.id, g]));
const TONE_INDEX = new Map(TONES.map((t) => [t.id, t]));

export function getGenreById(id: string): GenreDefinition | undefined {
  return GENRE_INDEX.get(id);
}

export function getToneById(id: string): ToneDefinition | undefined {
  return TONE_INDEX.get(id);
}

export function getRootGenres(): GenreDefinition[] {
  return GENRES.filter((g) => g.parentId === undefined);
}

export function getGenreChildren(id: string): GenreDefinition[] {
  return GENRES.filter((g) => g.parentId === id);
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/shared test`
Expected: PASS — 7 new tests in `genre-registry.test.ts` + 43 existing = 50 in shared.

Run: `pnpm --filter @book-forge/shared typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/genre-registry.ts packages/shared/src/genre-registry.test.ts
git commit -m "feat(shared): expand genre/tone registry + getRootGenres/getGenreChildren helpers"
```

---

## Task 2: AudiencePicker component

**Files:**
- Create: `apps/web/src/components/studio/concept/AudiencePicker.tsx`

No tests for this small radio component — it's covered indirectly by `ConceptForm` test.

- [ ] **Step 1: Implement**

```tsx
import type { Audience } from "@book-forge/shared";

const OPTIONS: Array<{ value: Audience; label: string }> = [
  { value: "ya", label: "YA (12–18)" },
  { value: "adult", label: "Adult (18+)" },
  { value: "all_ages", label: "All ages" },
  { value: "mg", label: "Middle grade (8–12)" },
];

interface Props {
  value: Audience;
  onChange: (next: Audience) => void;
}

export function AudiencePicker({ value, onChange }: Props) {
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-label="Целевая аудитория"
    >
      <legend className="text-sm font-medium">Целевая аудитория</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              className={
                "border rounded-md px-3 py-1.5 text-sm cursor-pointer " +
                (checked
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
              }
            >
              <input
                type="radio"
                name="audience"
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/studio/concept/AudiencePicker.tsx
git commit -m "feat(web): AudiencePicker radio component"
```

---

## Task 3: TonePicker component + tests

**Files:**
- Create: `apps/web/src/components/studio/concept/TonePicker.tsx`
- Create: `apps/web/src/components/studio/concept/__tests__/TonePicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/studio/concept/__tests__/TonePicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TonePicker } from "../TonePicker";

describe("TonePicker", () => {
  it("renders a chip per registry tone", () => {
    render(<TonePicker selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Мрачный/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Светлый/ })).toBeInTheDocument();
  });

  it("marks selected chips with aria-pressed=true", () => {
    render(<TonePicker selected={["dark"]} onChange={() => {}} />);
    const dark = screen.getByRole("button", { name: /Мрачный/ });
    expect(dark).toHaveAttribute("aria-pressed", "true");
    const light = screen.getByRole("button", { name: /Светлый/ });
    expect(light).toHaveAttribute("aria-pressed", "false");
  });

  it("toggle adds a tone when not selected", async () => {
    const onChange = vi.fn();
    render(<TonePicker selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Мрачный/ }));
    expect(onChange).toHaveBeenCalledWith(["dark"]);
  });

  it("toggle removes a tone when already selected", async () => {
    const onChange = vi.fn();
    render(<TonePicker selected={["dark", "hopeful"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Мрачный/ }));
    expect(onChange).toHaveBeenCalledWith(["hopeful"]);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/web test`
Expected: FAIL — `TonePicker` not found.

- [ ] **Step 3: Implement `TonePicker.tsx`**

```tsx
import { TONES } from "@book-forge/shared";

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

export function TonePicker({ selected, onChange }: Props) {
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((t) => t !== id));
    else onChange([...selected, id]);
  }

  return (
    <fieldset className="flex flex-col gap-2" aria-label="Тон/настроение">
      <legend className="text-sm font-medium">Тон/настроение</legend>
      <div className="flex flex-wrap gap-2">
        {TONES.map((t) => {
          const isOn = selected.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(t.id)}
              className={
                "border rounded-md px-3 py-1.5 text-sm " +
                (isOn
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — 4 new tests + existing.

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/concept/TonePicker.tsx apps/web/src/components/studio/concept/__tests__/TonePicker.test.tsx
git commit -m "feat(web): TonePicker multi-select chip grid"
```

---

## Task 4: GenrePicker component + tests

**Files:**
- Create: `apps/web/src/components/studio/concept/GenrePicker.tsx`
- Create: `apps/web/src/components/studio/concept/__tests__/GenrePicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/studio/concept/__tests__/GenrePicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenrePicker } from "../GenrePicker";

describe("GenrePicker", () => {
  it("renders root genre groups", () => {
    render(<GenrePicker selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Фэнтези$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Научная фантастика$/ })).toBeInTheDocument();
  });

  it("expanding a root reveals its child genres", async () => {
    render(<GenrePicker selected={[]} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /^Фэнтези$/ }));
    expect(screen.getByRole("button", { name: /Тёмное фэнтези/ })).toBeInTheDocument();
  });

  it("clicking a leaf adds it to selection", async () => {
    const onChange = vi.fn();
    render(<GenrePicker selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /^Фэнтези$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Тёмное фэнтези/ }));
    expect(onChange).toHaveBeenCalledWith(["fantasy.dark_fantasy"]);
  });

  it("clicking a selected leaf removes it", async () => {
    const onChange = vi.fn();
    render(
      <GenrePicker
        selected={["fantasy.dark_fantasy"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Фэнтези$/ }));
    await userEvent.click(screen.getByRole("button", { name: /Тёмное фэнтези/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders incompatibility warning when both incompatible genres selected", () => {
    render(
      <GenrePicker
        selected={["sci_fi.hard_sci_fi", "fantasy"]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByText(/несовместим/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/web test`
Expected: FAIL — `GenrePicker` not found.

- [ ] **Step 3: Implement `GenrePicker.tsx`**

```tsx
import { useState } from "react";
import {
  GENRES,
  getRootGenres,
  getGenreChildren,
  getGenreById,
  type GenreDefinition,
} from "@book-forge/shared";

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

interface IncompatPair {
  a: string;
  b: string;
}

function findIncompatibilities(selected: string[]): IncompatPair[] {
  const seen = new Set<string>();
  const out: IncompatPair[] = [];
  for (const id of selected) {
    const def = getGenreById(id);
    if (!def?.incompatibleWith) continue;
    for (const other of selected) {
      if (other === id) continue;
      if (!def.incompatibleWith.includes(other)) continue;
      const sorted = [id, other].sort();
      const key = sorted.join("␟");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: sorted[0]!, b: sorted[1]! });
    }
  }
  return out;
}

export function GenrePicker({ selected, onChange }: Props) {
  const roots = getRootGenres();
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand any root that has a selected descendant
    const init = new Set<string>();
    for (const id of selected) {
      const def = getGenreById(id);
      if (def?.parentId) init.add(def.parentId);
    }
    return init;
  });

  function toggleSelected(id: string) {
    if (selected.includes(id)) onChange(selected.filter((g) => g !== id));
    else onChange([...selected, id]);
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const incompat = findIncompatibilities(selected);

  function chip(g: GenreDefinition, isLeafLike: boolean) {
    const isOn = selected.includes(g.id);
    return (
      <button
        key={g.id}
        type="button"
        aria-pressed={isOn}
        onClick={() => toggleSelected(g.id)}
        className={
          "border rounded-md px-3 py-1.5 text-sm " +
          (isOn
            ? "bg-blue-600 text-white border-blue-600"
            : "border-[var(--color-border)] hover:bg-[var(--color-muted)]") +
          (isLeafLike ? "" : " font-medium")
        }
      >
        {g.label}
      </button>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3" aria-label="Жанры">
      <legend className="text-sm font-medium">Жанры</legend>

      <div className="flex flex-col gap-2">
        {roots.map((root) => {
          const children = getGenreChildren(root.id);
          const isExpanded = expanded.has(root.id);
          return (
            <div key={root.id} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {chip(root, false)}
                {children.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(root.id)}
                    className="text-xs text-[var(--color-muted-foreground)] underline"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "скрыть подвиды" : "показать подвиды"}
                  </button>
                )}
              </div>
              {isExpanded && children.length > 0 && (
                <div className="ml-4 flex flex-wrap gap-2">
                  {children.map((c) => chip(c, true))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {incompat.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="genre-incompatibilities">
          {incompat.map((p) => (
            <li
              key={`${p.a}__${p.b}`}
              className="text-xs rounded px-2 py-1 bg-amber-50 text-amber-800"
            >
              Жанры "{p.a}" и "{p.b}" помечены как несовместимые в реестре.
            </li>
          ))}
        </ul>
      )}

      {/* Reference, used in Russian: total */}
      <div className="text-xs text-[var(--color-muted-foreground)]">
        Выбрано: {selected.length} из {GENRES.length}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — 5 new tests + existing.

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/concept/GenrePicker.tsx apps/web/src/components/studio/concept/__tests__/GenrePicker.test.tsx
git commit -m "feat(web): GenrePicker with hierarchy + incompatibility warnings"
```

---

## Task 5: ConceptForm container + test

**Files:**
- Create: `apps/web/src/components/studio/concept/ConceptForm.tsx`
- Create: `apps/web/src/components/studio/concept/__tests__/ConceptForm.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/studio/concept/__tests__/ConceptForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptForm } from "../ConceptForm";
import { emptyBookConcept, type BookConcept } from "@book-forge/shared";

describe("ConceptForm", () => {
  it("renders fields preloaded from initialConcept", () => {
    const c: BookConcept = emptyBookConcept();
    c.genres = ["fantasy"];
    c.tones = ["dark"];
    c.audience = "ya";
    c.premise = { logline: "Тестовая премиса" };
    render(
      <ConceptForm
        initialConcept={c}
        onSave={vi.fn().mockResolvedValue(c)}
      />,
    );
    expect(screen.getByDisplayValue("Тестовая премиса")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Фэнтези$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Save button is disabled when nothing changed", () => {
    const c = emptyBookConcept();
    render(<ConceptForm initialConcept={c} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeDisabled();
  });

  it("Save button enables after a change and calls onSave with merged concept", async () => {
    const c = emptyBookConcept();
    const onSave = vi.fn().mockResolvedValue(c);
    render(<ConceptForm initialConcept={c} onSave={onSave} />);
    const logline = screen.getByLabelText(/Логлайн/);
    await userEvent.type(logline, "Г");
    const saveBtn = screen.getByRole("button", { name: /Сохранить/ });
    expect(saveBtn).toBeEnabled();
    await userEvent.click(saveBtn);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const arg = onSave.mock.calls[0]![0] as BookConcept;
    expect(arg.premise.logline).toBe("Г");
  });

  it("renders error when onSave rejects", async () => {
    const c = emptyBookConcept();
    const onSave = vi.fn().mockRejectedValue(new Error("boom"));
    render(<ConceptForm initialConcept={c} onSave={onSave} />);
    await userEvent.type(screen.getByLabelText(/Логлайн/), "x");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @book-forge/web test`
Expected: FAIL — `ConceptForm` not found.

- [ ] **Step 3: Implement `ConceptForm.tsx`**

```tsx
import { useState } from "react";
import type { BookConcept, Audience } from "@book-forge/shared";
import { GenrePicker } from "./GenrePicker";
import { TonePicker } from "./TonePicker";
import { AudiencePicker } from "./AudiencePicker";

interface Props {
  initialConcept: BookConcept;
  onSave: (next: BookConcept) => Promise<BookConcept>;
}

function isEqualConcept(a: BookConcept, b: BookConcept): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ConceptForm({ initialConcept, onSave }: Props) {
  const [draft, setDraft] = useState<BookConcept>(initialConcept);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !isEqualConcept(draft, initialConcept);

  function patchPremise<K extends keyof BookConcept["premise"]>(
    key: K,
    value: BookConcept["premise"][K],
  ) {
    setDraft((d) => ({ ...d, premise: { ...d.premise, [key]: value } }));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const saved = await onSave(draft);
      setDraft(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="concept-heading"
      className="flex flex-col gap-4 border border-[var(--color-border)] rounded-lg p-4"
    >
      <h2 id="concept-heading" className="text-lg font-semibold">
        Концепт
      </h2>

      <GenrePicker
        selected={draft.genres}
        onChange={(next) => setDraft((d) => ({ ...d, genres: next }))}
      />

      <TonePicker
        selected={draft.tones}
        onChange={(next) => setDraft((d) => ({ ...d, tones: next }))}
      />

      <AudiencePicker
        value={draft.audience}
        onChange={(next: Audience) =>
          setDraft((d) => ({ ...d, audience: next }))
        }
      />

      <fieldset className="flex flex-col gap-2" aria-label="Премиса">
        <legend className="text-sm font-medium">Премиса (черновик)</legend>
        <label className="flex flex-col gap-1 text-sm">
          <span>Протагонист</span>
          <input
            type="text"
            value={draft.premise.protagonist ?? ""}
            onChange={(e) => patchPremise("protagonist", e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Конфликт</span>
          <input
            type="text"
            value={draft.premise.conflict ?? ""}
            onChange={(e) => patchPremise("conflict", e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Ставки</span>
          <input
            type="text"
            value={draft.premise.stakes ?? ""}
            onChange={(e) => patchPremise("stakes", e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Логлайн</span>
          <textarea
            value={draft.premise.logline ?? ""}
            onChange={(e) => patchPremise("logline", e.target.value)}
            rows={2}
            className="border border-[var(--color-border)] rounded px-2 py-1"
          />
        </label>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Phase B1: ручной ввод. В Phase B2 эти поля заполнит пазл-рефайнер.
        </p>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className={
            "border rounded-md px-4 py-1.5 text-sm " +
            (dirty && !saving
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] cursor-not-allowed")
          }
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — 4 new tests in ConceptForm.test.tsx; total web tests now 14 (existing) + 4 + 5 (GenrePicker) + 4 (TonePicker) = 27.

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/studio/concept/ConceptForm.tsx apps/web/src/components/studio/concept/__tests__/ConceptForm.test.tsx
git commit -m "feat(web): ConceptForm container with dirty-state Save"
```

---

## Task 6: Mount ConceptForm in StudioPage

**Files:**
- Modify: `apps/web/src/pages/StudioPage.tsx`

- [ ] **Step 1: Edit StudioPage to include ConceptForm**

In `apps/web/src/pages/StudioPage.tsx`, perform these changes:

1. Add import near the existing component imports:
```ts
import { ConceptForm } from "@/components/studio/concept/ConceptForm";
```

2. Add a save handler before the JSX `return`. Place it AFTER the `recommended` constant declaration but BEFORE the `return (...)`:
```ts
  async function handleSaveConcept(next: typeof concept extends null
    ? never
    : BookConcept): Promise<BookConcept> {
    const saved = await api.patchConcept(bookId, next);
    setConcept(saved);
    // Re-fetch warnings because concept changes can flip warning rules.
    setWarnings(await api.getStudioWarnings(bookId));
    return saved;
  }
```

   The conditional type around the parameter is just to make TypeScript happy when `concept` is non-null at this point. Simpler form is also acceptable:
```ts
  async function handleSaveConcept(next: BookConcept): Promise<BookConcept> {
    const saved = await api.patchConcept(bookId, next);
    setConcept(saved);
    setWarnings(await api.getStudioWarnings(bookId));
    return saved;
  }
```
   Use the simpler form.

3. Insert the `<ConceptForm>` element BETWEEN the warnings `<section>` and the stages `<section>`. Place it right after the closing `</section>` that wraps the WarningsFeed and before the opening `<section aria-labelledby="stages-heading">`:

```tsx
      <ConceptForm initialConcept={concept} onSave={handleSaveConcept} />
```

The final return JSX should look (abbreviated):
```tsx
  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-6">
      <div ...> Studio header </div>
      <section ...> Warnings </section>
      <ConceptForm initialConcept={concept} onSave={handleSaveConcept} />
      <section ...> Stages </section>
      <p ...> Phase A footer </p>
    </main>
  );
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @book-forge/web typecheck`
Expected: 0 errors.

Run: `pnpm --filter @book-forge/web test`
Expected: PASS — existing tests still pass; no new test in this task because the page-level integration happens via manual smoke (Task 7).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/StudioPage.tsx
git commit -m "feat(web): mount ConceptForm in StudioPage above stages grid"
```

---

## Task 7: Workspace verification + manual smoke + push

- [ ] **Step 1: Full typecheck**

Run from `d:/PROJECTS/BOOKOPIS`:
```bash
pnpm -r typecheck
```
Expected: PASS for 7 packages.

- [ ] **Step 2: Full test**

Run: `pnpm -r test`
Expected counts:
- shared: previous 43 + 7 (registry) = 50.
- web: previous 14 + 5 (GenrePicker) + 4 (TonePicker) + 4 (ConceptForm) = 27.
- server: 108 (unchanged).
- llm: 65 (unchanged).
- Total: ~250 tests passing.

- [ ] **Step 3: Boot dev**

```bash
pnpm dev
```
Server on `:3001`, web on `:5173`.

- [ ] **Step 4: Smoke in browser**

1. Visit `http://localhost:5173/books`. Create a new book "Studio B1 smoke" if none exists.
2. Navigate to `/books/<id>/studio`.
3. Verify the Concept section renders above the stages grid: GenrePicker (with "показать подвиды" expanders), TonePicker chips, AudiencePicker radios, 4 premise inputs, Save button (disabled).
4. Pick жанр "Фэнтези → Тёмное фэнтези". Pick тон "Мрачный". Switch audience to "YA". Type a logline. Save button should enable.
5. Click "Сохранить". Network tab: expect `PATCH /api/books/<id>/concept` 200 OK.
6. Reload. State persists.
7. Pick incompatible pair: "Твёрдая НФ" + "Фэнтези → Высокое фэнтези". Verify amber-yellow incompatibility note appears under the genre picker.
8. Pick a non-concept stage advancement (skip — not in Phase B1; the stages grid is read-only). Just check that warnings feed still works (no concept-genres-empty warning since we picked genres now).

- [ ] **Step 5: Commit any incidental fixes**

If smoke surfaces a small fix, stage and commit:
```bash
git add -A
git commit -m "fix: incidental Phase B1 fixes after smoke"
```
If nothing needed, skip.

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Done criteria

- [ ] `genre-registry.ts` has ≥15 genres + ≥8 tones, plus `getRootGenres`/`getGenreChildren` exports.
- [ ] Registry has tests covering hierarchy lookups + reference integrity (parentId/incompatibleWith).
- [ ] `AudiencePicker`, `TonePicker`, `GenrePicker`, `ConceptForm` exist as 4 separate files in `apps/web/src/components/studio/concept/`.
- [ ] All 4 components are wired together inside `ConceptForm`.
- [ ] `ConceptForm` test covers: render preloaded values; Save disabled when clean; Save enabled when dirty; onSave called with merged concept; error path renders alert.
- [ ] `GenrePicker` test covers: roots render; expand reveals children; toggle add/remove; incompatibility warning surfaces.
- [ ] `TonePicker` test covers: chips render; aria-pressed reflects selection; toggle add/remove.
- [ ] `StudioPage` mounts `ConceptForm` above the stages grid; save flushes both concept and warnings.
- [ ] `pnpm -r typecheck` and `pnpm -r test` green.
- [ ] Manual smoke confirms: select/save round-trips; incompatibility warning visible.
- [ ] All commits pushed to origin/main.

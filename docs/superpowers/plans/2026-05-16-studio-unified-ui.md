# Studio Unified UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Studio the single UI: delete legacy `BookPage`, split its responsibilities into `/studio/chapters` and `/studio/settings`, redirect `/books/:id` → `/books/:id/studio`, drop the dead "Замысел"/`premise` field.

**Architecture:** Two new focused page components extracted from `BookPage` (chapters list + panels; book settings + delete). `App.tsx` gains static `/studio/chapters` and `/studio/settings` routes plus a redirect wrapper for the old `/books/:id`. `StudioPage` dashboard links to the new routes. `books.premise` column stays in the DB but is never written/read by the UI.

**Tech Stack:** React 18, react-router-dom@7, Vitest + @testing-library/react + userEvent, Tailwind v4, @dnd-kit (existing).

Spec: `docs/superpowers/specs/2026-05-16-studio-unified-ui-design.md`

---

## File Structure

- **Create** `apps/web/src/lib/chapter-cost.ts` — per-chapter USD estimate helper (extracted from `BookPage`).
- **Create** `apps/web/src/pages/ChaptersStagePage.tsx` — chapters list + add + dnd-reorder + Outline/Knowledge/Import/Search panels.
- **Create** `apps/web/src/pages/SettingsStagePage.tsx` — book settings (title/status/style/models/provider) + delete. No premise.
- **Create** tests: `apps/web/src/lib/chapter-cost.test.ts`, `apps/web/src/pages/ChaptersStagePage.test.tsx`, `apps/web/src/pages/SettingsStagePage.test.tsx`, `apps/web/src/pages/BookRedirect.test.tsx`.
- **Modify** `apps/web/src/App.tsx` — redirect wrapper + 2 new routes, drop `BookPage` import.
- **Modify** `apps/web/src/pages/StudioPage.tsx` — header nav buttons, chapters card href, remove "← к книге".
- **Modify** `apps/web/src/pages/BooksListPage.tsx` — navigate to `/studio` after create; list link → `/studio`.
- **Modify** `apps/web/src/pages/ChapterPage.tsx:502` — back-link → `/studio/chapters`.
- **Delete** `apps/web/src/pages/BookPage.tsx` (last, after extraction).

`BookPage.tsx` stays in the repo until Task 8 so earlier tasks can copy from it.

---

## Task 1: Extract per-chapter cost helper

**Files:**
- Create: `apps/web/src/lib/chapter-cost.ts`
- Test: `apps/web/src/lib/chapter-cost.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/chapter-cost.test.ts
import { describe, it, expect } from "vitest";
import { estimatePerChapterUsd } from "./chapter-cost";

describe("estimatePerChapterUsd", () => {
  it("returns a positive number for sonnet/sonnet/sonnet", () => {
    expect(estimatePerChapterUsd("sonnet", "sonnet", "sonnet")).toBeGreaterThan(0);
  });

  it("opus writer costs more than sonnet writer (plot/critic fixed)", () => {
    const opus = estimatePerChapterUsd("opus", "sonnet", "sonnet");
    const sonnet = estimatePerChapterUsd("sonnet", "sonnet", "sonnet");
    expect(opus).toBeGreaterThan(sonnet);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/lib/chapter-cost.test.ts`
Expected: FAIL — cannot resolve `./chapter-cost`.

- [ ] **Step 3: Create the helper**

```ts
// apps/web/src/lib/chapter-cost.ts
import { calculateCost, type ModelChoice } from "@book-forge/shared";

export const MODEL_API_ID: Record<ModelChoice, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
};

// Empirical per-chapter token averages (4k-word RU chapter).
// Writer = ~4500 in / 11000 out; Plot = ~2500 in / 1500 out;
// Critic batch (4 critics) = ~12000 in / 3000 out total.
export const PER_CHAPTER_TOKENS = {
  writer: { input: 4500, output: 11000 },
  plot: { input: 2500, output: 1500 },
  critic: { input: 12000, output: 3000 },
};

export function estimatePerChapterUsd(
  writer: ModelChoice,
  plot: ModelChoice,
  critic: ModelChoice,
): number {
  const w = calculateCost({
    model: MODEL_API_ID[writer],
    inputTokens: PER_CHAPTER_TOKENS.writer.input,
    outputTokens: PER_CHAPTER_TOKENS.writer.output,
  }).totalUsd;
  const p = calculateCost({
    model: MODEL_API_ID[plot],
    inputTokens: PER_CHAPTER_TOKENS.plot.input,
    outputTokens: PER_CHAPTER_TOKENS.plot.output,
  }).totalUsd;
  const cr = calculateCost({
    model: MODEL_API_ID[critic],
    inputTokens: PER_CHAPTER_TOKENS.critic.input,
    outputTokens: PER_CHAPTER_TOKENS.critic.output,
  }).totalUsd;
  return w + p + cr;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/lib/chapter-cost.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chapter-cost.ts apps/web/src/lib/chapter-cost.test.ts
git commit -m "feat(web): extract per-chapter cost helper from BookPage"
```

---

## Task 2: ChaptersStagePage

**Files:**
- Create: `apps/web/src/pages/ChaptersStagePage.tsx`
- Test: `apps/web/src/pages/ChaptersStagePage.test.tsx`

The sortable list components are copied verbatim from `apps/web/src/pages/BookPage.tsx:439-558` (`SortableChapterList`, `SortableChapterItem`) — reproduced in full below so this task is self-contained.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/ChaptersStagePage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ChaptersStagePage } from "./ChaptersStagePage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    listChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: vi.fn(),
  },
}));

// Panels do their own fetching; render them as inert stubs.
vi.mock("@/components/OutlinePanel", () => ({ OutlinePanel: () => <div /> }));
vi.mock("@/components/KnowledgePanel", () => ({ KnowledgePanel: () => <div /> }));
vi.mock("@/components/ImportExportPanel", () => ({ ImportExportPanel: () => <div /> }));
vi.mock("@/components/SearchPanel", () => ({ SearchPanel: () => <div /> }));

const m = vi.mocked(api);

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio/chapters"]}>
      <Routes>
        <Route
          path="/books/:bookId/studio/chapters"
          element={<ChaptersStagePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const book = {
  id: 3,
  title: "Тест",
  status: "draft",
  premise: null,
  styleProfileId: null,
  writerModel: "opus",
  plotModel: "sonnet",
  criticModel: "sonnet",
  writerProvider: "anthropic",
  writerLocalModel: null,
  createdAt: new Date().toISOString(),
};

describe("ChaptersStagePage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders chapter list from api", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listChapters.mockResolvedValue([
      { id: 11, title: "Глава раз", orderIndex: 10, status: "draft" },
    ] as never);
    renderAt();
    await waitFor(() =>
      expect(screen.getByText("Глава раз")).toBeInTheDocument(),
    );
  });

  it("adds a chapter via the form", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listChapters.mockResolvedValue([] as never);
    m.createChapter.mockResolvedValue({} as never);
    renderAt();
    await waitFor(() => screen.getByPlaceholderText("Название главы"));
    await userEvent.type(
      screen.getByPlaceholderText("Название главы"),
      "Новая",
    );
    await userEvent.click(screen.getByRole("button", { name: /Новая глава/ }));
    await waitFor(() =>
      expect(m.createChapter).toHaveBeenCalledWith(3, { title: "Новая" }),
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/pages/ChaptersStagePage.test.tsx`
Expected: FAIL — cannot resolve `./ChaptersStagePage`.

- [ ] **Step 3: Create the page**

```tsx
// apps/web/src/pages/ChaptersStagePage.tsx
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { OutlinePanel } from "@/components/OutlinePanel";
import { ImportExportPanel } from "@/components/ImportExportPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { KnowledgePanel } from "@/components/KnowledgePanel";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import type { Book, Chapter } from "@book-forge/shared";

export function ChaptersStagePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");

  async function load() {
    setError(null);
    try {
      const [b, chs] = await Promise.all([
        api.getBook(id),
        api.listChapters(id),
      ]);
      setBook(b);
      setChapters(chs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onAddChapter(e: FormEvent) {
    e.preventDefault();
    if (!chapterTitle.trim()) return;
    setError(null);
    try {
      await api.createChapter(id, { title: chapterTitle.trim() });
      setChapterTitle("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
  if (!book || chapters === null) {
    return <PageSkeleton label="Главы загружаются" />;
  }

  return (
    <main className="max-w-5xl mx-auto p-8 flex flex-col gap-6">
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Главы</h1>
        <Link to={`/books/${id}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>

      <OutlinePanel book={book} onUpdated={load} />

      <KnowledgePanel bookId={id} />

      <ImportExportPanel bookId={id} onImported={load} />

      <SearchPanel bookId={id} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Главы</h2>

        <form onSubmit={onAddChapter} className="flex gap-2">
          <input
            className="flex-1 border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
            placeholder="Название главы"
            value={chapterTitle}
            onChange={(e) => setChapterTitle(e.target.value)}
          />
          <Button type="submit" disabled={!chapterTitle.trim()}>
            + Новая глава
          </Button>
        </form>

        {chapters.length === 0 ? (
          <p className="text-[var(--color-muted-foreground)]">Глав пока нет.</p>
        ) : (
          <SortableChapterList
            chapters={chapters}
            bookId={id}
            onReordered={(next) => setChapters(next)}
            onPersistError={setError}
          />
        )}
      </section>
    </main>
  );
}

interface SortableChapterListProps {
  chapters: Chapter[];
  bookId: number;
  onReordered: (next: Chapter[]) => void;
  onPersistError: (msg: string) => void;
}

function SortableChapterList({
  chapters,
  bookId,
  onReordered,
  onPersistError,
}: SortableChapterListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = chapters.findIndex((c) => String(c.id) === String(active.id));
    const newIndex = chapters.findIndex((c) => String(c.id) === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(chapters, oldIndex, newIndex);
    const renumbered = reordered.map((c, i) => ({
      ...c,
      orderIndex: (i + 1) * 10,
    }));
    onReordered(renumbered);

    try {
      const changed = renumbered.filter((c) => {
        const prev = chapters.find((p) => p.id === c.id);
        return !prev || prev.orderIndex !== c.orderIndex;
      });
      await Promise.all(
        changed.map((c) => api.updateChapter(c.id, { orderIndex: c.orderIndex })),
      );
      toast.success("Порядок глав обновлён");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onPersistError(msg);
      toast.error("Не удалось переупорядочить", { description: msg });
      onReordered(chapters);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={chapters.map((c) => String(c.id))}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-2" aria-label="Главы (можно перетаскивать)">
          {chapters.map((c) => (
            <SortableChapterItem key={c.id} chapter={c} bookId={bookId} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableChapterItem({
  chapter,
  bookId,
}: {
  chapter: Chapter;
  bookId: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: String(chapter.id) });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="border border-[var(--color-border)] rounded-md p-3 hover:bg-[var(--color-accent)] flex items-center gap-2"
    >
      <button
        type="button"
        aria-label="Перетащить главу"
        className="cursor-grab active:cursor-grabbing text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <Link
        to={`/books/${bookId}/chapters/${chapter.id}`}
        className="block flex-1"
      >
        <div className="flex justify-between items-center">
          <div>
            <span className="text-xs text-[var(--color-muted-foreground)] mr-2">
              #{chapter.orderIndex}
            </span>
            <span className="font-medium">{chapter.title}</span>
          </div>
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {chapter.status}
          </span>
        </div>
      </Link>
    </li>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/pages/ChaptersStagePage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ChaptersStagePage.tsx apps/web/src/pages/ChaptersStagePage.test.tsx
git commit -m "feat(web): ChaptersStagePage — chapters list + panels"
```

---

## Task 3: SettingsStagePage

**Files:**
- Create: `apps/web/src/pages/SettingsStagePage.tsx`
- Test: `apps/web/src/pages/SettingsStagePage.test.tsx`

Settings markup copied from `apps/web/src/pages/BookPage.tsx:198-399` minus the "Замысел"/premise textarea (BookPage.tsx:219-225) and the cost block now sourced from `lib/chapter-cost`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/SettingsStagePage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SettingsStagePage } from "./SettingsStagePage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    listStyleProfiles: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
  },
}));

const m = vi.mocked(api);

const book = {
  id: 3,
  title: "Тест",
  status: "draft",
  premise: "СТАРЫЙ ЗАМЫСЕЛ",
  styleProfileId: null,
  writerModel: "opus",
  plotModel: "sonnet",
  criticModel: "sonnet",
  writerProvider: "anthropic",
  writerLocalModel: null,
  createdAt: new Date().toISOString(),
};

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio/settings"]}>
      <Routes>
        <Route
          path="/books/:bookId/studio/settings"
          element={<SettingsStagePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsStagePage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders settings without a Замысел/premise field", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    expect(screen.queryByText(/Замысел/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("СТАРЫЙ ЗАМЫСЕЛ")).not.toBeInTheDocument();
  });

  it("saves without sending premise", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    m.updateBook.mockResolvedValue(book as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(m.updateBook).toHaveBeenCalled());
    const arg = m.updateBook.mock.calls[0][1] as Record<string, unknown>;
    expect("premise" in arg).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/pages/SettingsStagePage.test.tsx`
Expected: FAIL — cannot resolve `./SettingsStagePage`.

- [ ] **Step 3: Create the page**

```tsx
// apps/web/src/pages/SettingsStagePage.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/AlertDialog";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/api/client";
import { toast } from "@/lib/toast";
import { estimatePerChapterUsd } from "@/lib/chapter-cost";
import type {
  Book,
  BookStatus,
  ModelChoice,
  StyleProfile,
  WriterProvider,
} from "@book-forge/shared";

const STATUSES: BookStatus[] = ["draft", "active", "archived"];
const MODELS: ModelChoice[] = ["sonnet", "opus"];
const PROVIDERS: WriterProvider[] = ["anthropic", "ollama"];

export function SettingsStagePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const id = Number(bookId);
  const navigate = useNavigate();

  const [book, setBook] = useState<Book | null>(null);
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<BookStatus>("draft");
  const [styleProfileId, setStyleProfileId] = useState<number | null>(null);
  const [writerModel, setWriterModel] = useState<ModelChoice>("opus");
  const [plotModel, setPlotModel] = useState<ModelChoice>("sonnet");
  const [criticModel, setCriticModel] = useState<ModelChoice>("sonnet");
  const [writerProvider, setWriterProvider] = useState<WriterProvider>("anthropic");
  const [writerLocalModel, setWriterLocalModel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setError(null);
    try {
      const [b, sp] = await Promise.all([
        api.getBook(id),
        api.listStyleProfiles(),
      ]);
      setBook(b);
      setStyleProfiles(sp);
      setTitle(b.title);
      setStatus(b.status);
      setStyleProfileId(b.styleProfileId);
      setWriterModel(b.writerModel);
      setPlotModel(b.plotModel);
      setCriticModel(b.criticModel);
      setWriterProvider(b.writerProvider);
      setWriterLocalModel(b.writerLocalModel ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateBook(id, {
        title: title.trim() || book!.title,
        status,
        styleProfileId,
        writerModel,
        plotModel,
        criticModel,
        writerProvider,
        writerLocalModel:
          writerProvider === "ollama" && writerLocalModel.trim()
            ? writerLocalModel.trim()
            : null,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDelete() {
    setDeleting(true);
    try {
      await api.deleteBook(id);
      toast.success("Книга удалена");
      navigate("/books");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error("Не удалось удалить", { description: msg });
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <main className="max-w-3xl mx-auto p-8">
        <p role="alert" className="text-sm text-red-600">
          Ошибка: {error}
        </p>
      </main>
    );
  }
  if (!book) {
    return <PageSkeleton label="Настройки книги загружаются" />;
  }

  return (
    <main className="max-w-3xl mx-auto p-8 flex flex-col gap-6">
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Настройки</h1>
        <Link to={`/books/${id}/studio`} className="text-sm underline">
          ← к Studio
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <input
          className="text-2xl font-bold border-b border-[var(--color-border)] py-1 outline-none focus:border-[var(--color-ring)]"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="text-sm font-medium">Статус</label>
        <select
          className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm w-fit"
          value={status}
          onChange={(e) => setStatus(e.target.value as BookStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="text-sm font-medium">Стилевой профиль</label>
        <select
          className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm w-fit"
          value={styleProfileId ?? ""}
          onChange={(e) =>
            setStyleProfileId(
              e.target.value === "" ? null : Number(e.target.value),
            )
          }
        >
          <option value="">— без стиля —</option>
          {styleProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.fingerprint ? " (нет fingerprint)" : ""}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Writer model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={writerModel}
              onChange={(e) => setWriterModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Plot model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={plotModel}
              onChange={(e) => setPlotModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Critic model</span>
            <select
              className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
              value={criticModel}
              onChange={(e) => setCriticModel(e.target.value as ModelChoice)}
            >
              {MODELS.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--color-muted-foreground)]">
          Прогноз ~$
          {writerProvider === "ollama"
            ? estimatePerChapterUsd("sonnet", plotModel, criticModel).toFixed(2)
            : estimatePerChapterUsd(writerModel, plotModel, criticModel).toFixed(
                2,
              )}
          {" "}/ глава при текущих настройках (4k слов; без учёта prompt-кэша
          {writerProvider === "ollama" ? "; Writer бесплатный — локальная модель" : ""}
          ).
        </p>

        <fieldset
          className="border border-[var(--color-border)] rounded-md p-3 flex flex-col gap-2"
          aria-label="Провайдер для Writer"
        >
          <legend className="px-1 text-xs font-medium text-[var(--color-muted-foreground)]">
            Provider для Writer
          </legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {PROVIDERS.map((p) => (
              <label key={p} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="writer-provider"
                  value={p}
                  checked={writerProvider === p}
                  onChange={() => setWriterProvider(p)}
                />
                <span>
                  {p === "anthropic" ? "Cloud (Anthropic)" : "Local (Ollama)"}
                </span>
              </label>
            ))}
          </div>
          {writerProvider === "ollama" && (
            <div className="flex flex-col gap-1">
              <label
                className="text-xs text-[var(--color-muted-foreground)]"
                htmlFor="writer-local-model"
              >
                Тег локальной модели
              </label>
              <input
                id="writer-local-model"
                className="border border-[var(--color-input)] rounded-md px-3 py-2 text-sm"
                value={writerLocalModel}
                onChange={(e) => setWriterLocalModel(e.target.value)}
                placeholder="например, qwen2.5:14b-instruct"
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Сервер должен достигать Ollama по{" "}
                <code>OLLAMA_BASE_URL</code> (по умолчанию{" "}
                <code>http://127.0.0.1:11434</code>). Plot и Critic остаются на
                cloud-моделях.
              </p>
            </div>
          )}
        </fieldset>

        <div className="flex gap-2">
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
            aria-label={`Удалить книгу «${book.title}»`}
          >
            Удалить книгу
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={deleteDialogOpen}
        title={`Удалить «${book.title}»?`}
        description={
          <>
            Будут безвозвратно удалены: книга, её главы, план, канон и история
            стиля. Действие необратимо.
          </>
        }
        confirmText="Удалить навсегда"
        cancelText="Не удалять"
        variant="destructive"
        busy={deleting}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </main>
  );
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/pages/SettingsStagePage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/SettingsStagePage.tsx apps/web/src/pages/SettingsStagePage.test.tsx
git commit -m "feat(web): SettingsStagePage — book settings, no premise"
```

---

## Task 4: Routing — redirect + new routes

**Files:**
- Create: `apps/web/src/pages/BookRedirect.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/pages/BookRedirect.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/BookRedirect.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BookRedirect } from "./BookRedirect";

describe("BookRedirect", () => {
  it("redirects /books/:id to /books/:id/studio", () => {
    render(
      <MemoryRouter initialEntries={["/books/7"]}>
        <Routes>
          <Route path="/books/:bookId" element={<BookRedirect />} />
          <Route
            path="/books/:bookId/studio"
            element={<div>STUDIO DASHBOARD</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("STUDIO DASHBOARD")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/pages/BookRedirect.test.tsx`
Expected: FAIL — cannot resolve `./BookRedirect`.

- [ ] **Step 3: Create the redirect component**

```tsx
// apps/web/src/pages/BookRedirect.tsx
import { Navigate, useParams } from "react-router-dom";

export function BookRedirect() {
  const { bookId } = useParams<{ bookId: string }>();
  return <Navigate to={`/books/${bookId}/studio`} replace />;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/pages/BookRedirect.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Wire routes in App.tsx**

Replace the `import { BookPage }` line and the `/books/:bookId` route. The full new `App.tsx`:

```tsx
// apps/web/src/App.tsx
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router-dom";
import { BooksListPage } from "@/pages/BooksListPage";
import { BookRedirect } from "@/pages/BookRedirect";
import { ChapterPage } from "@/pages/ChapterPage";
import {
  StyleProfilesListPage,
  StyleProfilePage,
} from "@/pages/StyleProfilesPage";
import { UsagePage } from "@/pages/UsagePage";
import { StudioPage } from "@/pages/StudioPage";
import { MarkdownStagePage } from "@/pages/MarkdownStagePage";
import { EntityStagePage } from "@/pages/EntityStagePage";
import { ChaptersStagePage } from "@/pages/ChaptersStagePage";
import { SettingsStagePage } from "@/pages/SettingsStagePage";

function StagePageDispatch() {
  const { stageId } = useParams<{ stageId: string }>();
  if (stageId === "characters" || stageId === "items") {
    return <EntityStagePage />;
  }
  return <MarkdownStagePage />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/books" replace />,
  },
  {
    path: "/books",
    element: <BooksListPage />,
  },
  {
    path: "/books/:bookId",
    element: <BookRedirect />,
  },
  {
    path: "/books/:bookId/studio",
    element: <StudioPage />,
  },
  {
    path: "/books/:bookId/studio/chapters",
    element: <ChaptersStagePage />,
  },
  {
    path: "/books/:bookId/studio/settings",
    element: <SettingsStagePage />,
  },
  {
    path: "/books/:bookId/studio/:stageId",
    element: <StagePageDispatch />,
  },
  {
    path: "/books/:bookId/chapters/:chapterId",
    element: <ChapterPage />,
  },
  {
    path: "/style-profiles",
    element: <StyleProfilesListPage />,
  },
  {
    path: "/style-profiles/:profileId",
    element: <StyleProfilePage />,
  },
  {
    path: "/usage",
    element: <UsagePage />,
  },
  {
    path: "*",
    element: <p className="p-8">Не найдено</p>,
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
```

react-router-dom@7 ranks `/studio/chapters` and `/studio/settings` (static) above `/studio/:stageId` (dynamic) automatically — array order is for readability only.

- [ ] **Step 6: Run web tests, verify green**

Run: `pnpm --filter @book-forge/web test`
Expected: PASS (all suites, including new ones).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/BookRedirect.tsx apps/web/src/pages/BookRedirect.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): redirect /books/:id to Studio + chapters/settings routes"
```

---

## Task 5: StudioPage dashboard navigation

**Files:**
- Modify: `apps/web/src/pages/StudioPage.tsx`

- [ ] **Step 1: Replace the header link with Settings/Chapters nav**

In `apps/web/src/pages/StudioPage.tsx`, replace this block (lines ~92-97):

```tsx
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Studio</h1>
        <Link to={`/books/${bookId}`} className="text-sm underline">
          ← к книге
        </Link>
      </div>
```

with:

```tsx
      <div className="flex justify-between items-baseline">
        <h1 className="text-3xl font-bold">Studio</h1>
        <nav className="flex gap-3 text-sm">
          <Link
            to={`/books/${bookId}/studio/settings`}
            className="underline"
          >
            ⚙ Настройки
          </Link>
          <Link
            to={`/books/${bookId}/studio/chapters`}
            className="underline"
          >
            📚 Главы
          </Link>
        </nav>
      </div>
```

- [ ] **Step 2: Point the chapters stage card at the new route**

In the same file, replace the `href` ternary (lines ~119-128):

```tsx
            const href =
              id === "world" ||
              id === "lore" ||
              id === "characters" ||
              id === "items" ||
              id === "plot"
                ? `/books/${bookId}/studio/${id}`
                : id === "chapters"
                  ? `/books/${bookId}`
                  : undefined;
```

with:

```tsx
            const href =
              id === "world" ||
              id === "lore" ||
              id === "characters" ||
              id === "items" ||
              id === "plot"
                ? `/books/${bookId}/studio/${id}`
                : id === "chapters"
                  ? `/books/${bookId}/studio/chapters`
                  : undefined;
```

- [ ] **Step 3: Run web tests + typecheck**

Run: `pnpm --filter @book-forge/web test && pnpm typecheck`
Expected: PASS. (`Link` is already imported in StudioPage.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/StudioPage.tsx
git commit -m "feat(web): StudioPage links to chapters/settings routes"
```

---

## Task 6: BooksListPage — straight into Studio after create

**Files:**
- Modify: `apps/web/src/pages/BooksListPage.tsx`
- Test: extend behavior in a new `apps/web/src/pages/BooksListPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/BooksListPage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BooksListPage } from "./BooksListPage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: { listBooks: vi.fn(), createBook: vi.fn() },
}));

const m = vi.mocked(api);

describe("BooksListPage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("navigates to Studio after creating a book", async () => {
    m.listBooks.mockResolvedValue([] as never);
    m.createBook.mockResolvedValue({ id: 42, title: "Новая" } as never);
    render(
      <MemoryRouter initialEntries={["/books"]}>
        <Routes>
          <Route path="/books" element={<BooksListPage />} />
          <Route
            path="/books/:bookId/studio"
            element={<div>STUDIO 42</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByLabelText("Название книги"));
    await userEvent.type(screen.getByLabelText("Название книги"), "Новая");
    await userEvent.click(screen.getByRole("button", { name: /Создать/ }));
    await waitFor(() =>
      expect(screen.getByText("STUDIO 42")).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: FAIL — still on list, "STUDIO 42" never appears (create only reloads list).

- [ ] **Step 3: Add navigation + update list link**

In `apps/web/src/pages/BooksListPage.tsx`:

Add `useNavigate` to the router import (line 2):

```tsx
import { Link, useNavigate } from "react-router-dom";
```

Inside `BooksListPage`, after the `useState` declarations, add:

```tsx
  const navigate = useNavigate();
```

Replace `onCreate` body (lines ~28-42) with:

```tsx
  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.createBook({ title: title.trim() });
      navigate(`/books/${created.id}/studio`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }
```

Change the list-item link (line ~136) from `to={`/books/${b.id}`}` to:

```tsx
                <Link to={`/books/${b.id}/studio`} className="block">
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BooksListPage.tsx apps/web/src/pages/BooksListPage.test.tsx
git commit -m "feat(web): create book goes straight to Studio"
```

---

## Task 7: ChapterPage back-link

**Files:**
- Modify: `apps/web/src/pages/ChapterPage.tsx:502`

- [ ] **Step 1: Update the back-link target**

In `apps/web/src/pages/ChapterPage.tsx`, around line 502, change:

```tsx
          <Link to={`/books/${bookId}`} className="text-sm underline">
```

to:

```tsx
          <Link to={`/books/${bookId}/studio/chapters`} className="text-sm underline">
```

(Keep the existing link text/children unchanged.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ChapterPage.tsx
git commit -m "feat(web): chapter back-link points to Studio chapters"
```

---

## Task 8: Delete BookPage + full verification

**Files:**
- Delete: `apps/web/src/pages/BookPage.tsx`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "BookPage" apps/web/src || echo "NO REFERENCES"`
Expected: `NO REFERENCES` (App.tsx already switched to `BookRedirect` in Task 4).

- [ ] **Step 2: Delete the file**

```bash
git rm apps/web/src/pages/BookPage.tsx
```

- [ ] **Step 3: Full typecheck + test sweep**

Run: `pnpm typecheck && pnpm test`
Expected: PASS across all packages. If `apps/server` tests reference `premise` they still pass — server is untouched and still writes `NULL`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(web): delete legacy BookPage — Studio is the only UI"
```

---

## Self-Review

**Spec coverage:**
- Routing/redirect → Task 4. ✓
- StudioPage nav + chapters card → Task 5. ✓
- ChaptersStagePage (list+add+reorder+panels) → Task 2. ✓
- SettingsStagePage (no premise, updateBook without premise) → Task 3. ✓
- BooksListPage navigate-after-create + list link → Task 6. ✓
- ChapterPage back-link → Task 7. ✓
- BookPage deletion + cost util extraction → Task 1 + Task 8. ✓
- `premise` column untouched (no migration, server unchanged) → stated in Task 8 Step 3. ✓
- Tests for each page → Tasks 2,3,4,6. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `Book`, `Chapter`, `ModelChoice`, `BookStatus`, `WriterProvider`, `StyleProfile` from `@book-forge/shared`. `api.getBook/listChapters/createChapter/updateChapter/listStyleProfiles/updateBook/deleteBook/createBook/listBooks` match `apps/web/src/api/client.ts`. `estimatePerChapterUsd(writer, plot, critic)` defined Task 1, consumed Task 3 with identical signature. Panel props (`OutlinePanel book/onUpdated`, `KnowledgePanel bookId`, `ImportExportPanel bookId/onImported`, `SearchPanel bookId`) match prior `BookPage` usage. ✓

**Note:** `updateBook` is called without `premise`; `UpdateBookInput.premise` must be optional (server treats `undefined` as "leave unchanged" — confirmed in `apps/server/src/routes/books.ts` PATCH). If the web `UpdateBookInput` type marks `premise` required, relax it to optional in `@book-forge/shared` as part of Task 3 Step 3 (it is already optional in current code — `BookPage` callers passed it explicitly, not by type requirement).

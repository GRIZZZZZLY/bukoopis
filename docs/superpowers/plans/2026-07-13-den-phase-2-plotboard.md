# Writer's Den Phase 2 — Room 4 «Доска сюжета» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новая страница `/books/:bookId/board` — пробковая доска: заметки `book_notes` как стикеры, красные нити тянутся по хронологии глав от появления нити до её закрытия; открытые нити уходят за правый край.

**Architecture:** Читающая страница (MVP read-only). Сервер: один новый GET-эндпоинт с полным рядом заметки. Web: чистая геометрия в `lib/board.ts` (unit-тесты), страница в идиоме ChaptersStagePage, SVG-слой нитей под стикерами, CSS-секция Board.

**Ключевое решение:** `book_notes.related_note_ids` в схеме есть, но экстрактор всегда пишет `'[]'` (utils/book-notes.ts) — графа связей в данных НЕТ. Поэтому «нить» = временнóй отрезок самой заметки: от `chapter_order_introduced` до `chapter_order_resolved` (NULL = открыта, тянется до края доски). Это работает на реальных данных без изменения экстрактора.

**Spec:** `docs/superpowers/specs/2026-07-12-cozy-writers-den-design.md` §5.4

## Global Constraints

- TS strict + `noUncheckedIndexedAccess`; ESM `.js` суффиксы на сервере; ноль новых npm-зависимостей.
- MVP read-only: страница только читает. Создание/редактирование заметок — вне скоупа.
- `kind` ∈ `thread | foreshadow | arc_delta | theme | mystery` (CHECK в миграции 0013) — ровно эти пять, ничего не выдумывать.
- Никакого `Math.random` в раскладке — позиция детерминирована от id/порядка.
- Новый пункт навигации не должен ломать тесты AppShell/страниц; `parseRoute`/`breadcrumb` расширяются, существующие ветки не трогаются.
- Коммит после каждой задачи; гейт `pnpm typecheck` + соответствующий тестовый пакет.

---

### Task 1: Сервер — GET /api/books/:id/notes

**Files:**
- Create: `packages/shared/src/book-note.ts`
- Modify: `packages/shared/src/index.ts` (re-export)
- Modify: `apps/server/src/routes/books.ts` (новый GET рядом с `/:id/chapters`)
- Test: `apps/server/src/routes/__tests__/books-notes.test.ts`

**Interfaces:**
- Produces: тип `BookNote` в shared; `GET /api/books/:id/notes` → `BookNote[]`, отсортировано `chapter_order_introduced ASC, id ASC`; 404 если книги нет; `[]` если заметок нет.

```ts
export interface BookNote {
  id: number;
  bookId: number;
  kind: "thread" | "foreshadow" | "arc_delta" | "theme" | "mystery";
  introduced: number;        // chapter_order_introduced
  resolved: number | null;   // chapter_order_resolved
  title: string;
  body: string;
  tags: string[];            // распарсенный JSON, [] при ошибке парсинга
  createdAt: string;
}
```

- [ ] **Step 1: Write the failing test**

`apps/server/src/routes/__tests__/books-notes.test.ts`. Хелперы — реальные (`makeTestApp()` синхронный, отдаёт `app`/`cleanup`; `send(app, url, method, body)`; см. `_helpers.ts` и соседний `books-stats.test.ts` как образец создания книги через HTTP). Заметки пишутся только экстрактором, поэтому в тесте вставляем их прямым SQL — открыть БД так же, как это делает `apps/server/src/utils/__tests__/writing-progress.test.ts` (raw better-sqlite3 + реальный мигратор + `bootstrapVirtualTables`), либо, если `TestApp` отдаёт путь к БД, открыть её оттуда. Тесты:

```ts
it("404 for a missing book", async () => {
  const res = await send(t.app, "/api/books/9999/notes", "GET");
  expect(res.status).toBe(404);
});

it("returns empty array when the book has no notes", async () => {
  // создать книгу через POST /api/books
  const res = await send(t.app, `/api/books/${bookId}/notes`, "GET");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

it("returns notes ordered by introduced chapter, with parsed tags", async () => {
  // вставить SQL-ом три заметки: (introduced 3, kind mystery), (introduced 1, kind thread,
  // tags '["a","b"]', resolved 4), (introduced 1, kind theme) — порядок вставки намеренно
  // не совпадает с ожидаемым порядком выдачи
  const notes = await (await send(t.app, `/api/books/${bookId}/notes`, "GET")).json();
  expect(notes.map((n) => n.introduced)).toEqual([1, 1, 3]);
  expect(notes[0].tags).toEqual(["a", "b"]);
  expect(notes[0].resolved).toBe(4);
  expect(notes[2].resolved).toBeNull();
});

it("survives malformed tags json", async () => {
  // заметка с tags = 'not json'
  const notes = await (await send(t.app, `/api/books/${bookId}/notes`, "GET")).json();
  expect(notes.some((n) => Array.isArray(n.tags))).toBe(true);
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/books-notes.test.ts`
Expected: FAIL (404 на существующей книге / модуль типа не найден).

- [ ] **Step 3: Implement**

`packages/shared/src/book-note.ts` — интерфейс выше (+ `import type { NoteKind } from "./episodic-notes.js"` и `kind: NoteKind`, если тип совместим; иначе объявить union локально). Реэкспорт в `packages/shared/src/index.ts` рядом с прочими.

В `apps/server/src/routes/books.ts`, рядом с `GET /:id/chapters`:

```ts
  // Доска сюжета: все заметки книги. Нить = отрезок introduced→resolved.
  r.get("/:id/notes", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite.prepare("SELECT id FROM books WHERE id = ?").get(id);
    if (!book) return notFound(c, "book");
    const rows = sqlite
      .prepare(
        `SELECT id, book_id, kind, chapter_order_introduced, chapter_order_resolved,
                title, body, tags, created_at
         FROM book_notes WHERE book_id = ?
         ORDER BY chapter_order_introduced ASC, id ASC`,
      )
      .all(id) as Array<{
      id: number;
      book_id: number;
      kind: string;
      chapter_order_introduced: number;
      chapter_order_resolved: number | null;
      title: string;
      body: string;
      tags: string | null;
      created_at: string;
    }>;
    return c.json(
      rows.map((r) => ({
        id: r.id,
        bookId: r.book_id,
        kind: r.kind,
        introduced: r.chapter_order_introduced,
        resolved: r.chapter_order_resolved,
        title: r.title,
        body: r.body,
        tags: parseTags(r.tags),
        createdAt: r.created_at,
      })),
    );
  });
```

Хелпер рядом в том же файле (или в `utils/`, если там уже есть подобный):

```ts
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: GREEN + гейт + коммит**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/books-notes.test.ts` → PASS
Run: `pnpm typecheck && pnpm --filter @book-forge/server test` → PASS

```bash
git add packages/shared/src/book-note.ts packages/shared/src/index.ts apps/server/src/routes/books.ts apps/server/src/routes/__tests__/books-notes.test.ts
git commit -m "feat(server): GET /api/books/:id/notes for the plot board"
```

---

### Task 2: Web — геометрия доски + api-метод

**Files:**
- Create: `apps/web/src/lib/board.ts`
- Test: `apps/web/src/lib/__tests__/board.test.ts`
- Modify: `apps/web/src/api/client.ts`

**Interfaces:**
- Produces: `COLUMN_W = 200`, `ROW_H = 132`, `PIN_X = 26`;
  `boardColumns(notes): number[]` — отсортированные уникальные `introduced`;
  `layoutNotes(notes): PlacedNote[]` где `PlacedNote = { note: BookNote; col: number; row: number; x: number; y: number }` (колонка = индекс в `boardColumns`, строка = порядковый номер внутри колонки);
  `threadSpan(note, columns): { x1: number; x2: number; open: boolean }` — координаты нити: от центра стикера до колонки `resolved`; если `resolved` null или его нет среди колонок — `open: true`, тянем до `boardWidth(columns)`;
  `boardWidth(columns): number`, `boardHeight(placed): number`;
  `api.listBookNotes(bookId): Promise<BookNote[]>`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/__tests__/board.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  boardColumns,
  boardHeight,
  boardWidth,
  COLUMN_W,
  layoutNotes,
  ROW_H,
  threadSpan,
} from "../board";
import type { BookNote } from "@book-forge/shared";

function note(id: number, introduced: number, resolved: number | null = null): BookNote {
  return {
    id, bookId: 1, kind: "thread", introduced, resolved,
    title: `n${id}`, body: "", tags: [], createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("board geometry", () => {
  it("columns are unique introduced values, sorted", () => {
    expect(boardColumns([note(1, 3), note(2, 1), note(3, 3)])).toEqual([1, 3]);
  });

  it("empty board has no columns and zero height", () => {
    expect(boardColumns([])).toEqual([]);
    expect(layoutNotes([])).toEqual([]);
    expect(boardHeight([])).toBe(0);
  });

  it("stacks notes of the same chapter into rows of one column", () => {
    const placed = layoutNotes([note(1, 1), note(2, 1), note(3, 2)]);
    expect(placed.map((p) => [p.col, p.row])).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(placed[0]!.x).toBe(0);
    expect(placed[1]!.y).toBe(ROW_H);
    expect(placed[2]!.x).toBe(COLUMN_W);
  });

  it("thread of a resolved note ends at the resolving column", () => {
    const notes = [note(1, 1, 3), note(2, 3)];
    const cols = boardColumns(notes);            // [1, 3]
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(false);
    expect(span.x2).toBeGreaterThan(span.x1);
    expect(span.x2).toBe(COLUMN_W * 1 + COLUMN_W / 2);
  });

  it("open thread runs to the board edge", () => {
    const notes = [note(1, 1), note(2, 2)];
    const cols = boardColumns(notes);
    const span = threadSpan(notes[0]!, cols);
    expect(span.open).toBe(true);
    expect(span.x2).toBe(boardWidth(cols));
  });

  it("thread resolved in an unknown chapter is treated as open", () => {
    const notes = [note(1, 1, 99)];
    const cols = boardColumns(notes);
    expect(threadSpan(notes[0]!, cols).open).toBe(true);
  });

  it("board size grows with columns and tallest stack", () => {
    const notes = [note(1, 1), note(2, 1), note(3, 5)];
    expect(boardWidth(boardColumns(notes))).toBe(COLUMN_W * 2);
    expect(boardHeight(layoutNotes(notes))).toBe(ROW_H * 2);
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @book-forge/web test -- src/lib/__tests__/board.test.ts` → module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/board.ts`:

```ts
import type { BookNote } from "@book-forge/shared";

/** Раскладка пробковой доски: колонка = глава появления заметки,
    строка = позиция в стопке этой главы. Всё детерминировано от данных. */

export const COLUMN_W = 200;
export const ROW_H = 132;
export const PIN_X = 26;

export interface PlacedNote {
  note: BookNote;
  col: number;
  row: number;
  x: number;
  y: number;
}

export function boardColumns(notes: BookNote[]): number[] {
  return [...new Set(notes.map((n) => n.introduced))].sort((a, b) => a - b);
}

export function layoutNotes(notes: BookNote[]): PlacedNote[] {
  const columns = boardColumns(notes);
  const used = new Map<number, number>();
  return notes.map((note) => {
    const col = columns.indexOf(note.introduced);
    const row = used.get(col) ?? 0;
    used.set(col, row + 1);
    return { note, col, row, x: col * COLUMN_W, y: row * ROW_H };
  });
}

export function boardWidth(columns: number[]): number {
  return Math.max(0, columns.length) * COLUMN_W;
}

export function boardHeight(placed: PlacedNote[]): number {
  return placed.reduce((max, p) => Math.max(max, (p.row + 1) * ROW_H), 0);
}

/** Нить заметки: от её колонки до колонки закрытия. Незакрытая (или закрытая
    в главе, которой нет на доске) уходит за правый край. */
export function threadSpan(
  note: BookNote,
  columns: number[],
): { x1: number; x2: number; open: boolean } {
  const from = columns.indexOf(note.introduced);
  const x1 = from * COLUMN_W + COLUMN_W / 2;
  const to = note.resolved === null ? -1 : columns.indexOf(note.resolved);
  if (to < 0) return { x1, x2: boardWidth(columns), open: true };
  return { x1, x2: to * COLUMN_W + COLUMN_W / 2, open: false };
}
```

В `apps/web/src/api/client.ts`, рядом с `listChapters`:

```ts
listBookNotes: (bookId: number) => req<BookNote[]>(`/api/books/${bookId}/notes`),
```

(импорт типа — как импортируются другие shared-типы в этом файле).

- [ ] **Step 4: GREEN + гейт + коммит**

Run: focused test → PASS (7 tests); `pnpm typecheck && pnpm --filter @book-forge/web test` → PASS.

```bash
git add apps/web/src/lib/board.ts apps/web/src/lib/__tests__/board.test.ts apps/web/src/api/client.ts
git commit -m "feat(web): plot board geometry helpers + notes api method"
```

---

### Task 3: Страница доски + роут + навигация

**Files:**
- Create: `apps/web/src/pages/PlotBoardPage.tsx`
- Test: `apps/web/src/pages/PlotBoardPage.test.tsx`
- Modify: `apps/web/src/App.tsx` (роут `/books/:bookId/board`)
- Modify: `apps/web/src/components/shell/AppShell.tsx` (RouteInfo.name, parseRoute, breadcrumb, пункт LeftRail)

**Interfaces:**
- Consumes: `api.getBook`, `api.listBookNotes`, `lib/board.ts`.
- Produces: страница `.route > .page.page-board` с `.board-canvas`, стикерами `.board-note.note-{kind}` и SVG-слоем нитей `.board-threads`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/pages/PlotBoardPage.test.tsx` (паттерн — `ChaptersStagePage.test.tsx`: `vi.mock("@/api/client")`, `vi.mocked(api)`, `renderAt()` с MemoryRouter+Routes, `beforeEach(vi.resetAllMocks)`):

```tsx
it("renders a sticky note per book note", async () => {
  m.getBook.mockResolvedValue({ id: 7, title: "Маяк" } as never);
  m.listBookNotes.mockResolvedValue([
    { id: 1, bookId: 7, kind: "thread", introduced: 1, resolved: 3,
      title: "Письмо без подписи", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
    { id: 2, bookId: 7, kind: "mystery", introduced: 2, resolved: null,
      title: "Кто в башне", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
  ] as never);
  renderAt();
  expect(await screen.findByText("Письмо без подписи")).toBeInTheDocument();
  expect(screen.getByText("Кто в башне")).toBeInTheDocument();
});

it("marks open threads", async () => {
  // те же данные
  renderAt();
  const open = await screen.findByLabelText(/Открытая линия: Кто в башне/);
  expect(open).toBeInTheDocument();
});

it("shows an empty state when there are no notes", async () => {
  m.getBook.mockResolvedValue({ id: 7, title: "Маяк" } as never);
  m.listBookNotes.mockResolvedValue([] as never);
  renderAt();
  expect(await screen.findByText(/Доска пуста/)).toBeInTheDocument();
});
```

- [ ] **Step 2: RED** — модуль страницы не найден.

- [ ] **Step 3: Implement**

`PlotBoardPage.tsx` — идиома ChaptersStagePage (useParams → Number, один `load()` c `Promise.all`, ранние возвраты: невалидный id / error `p[role=alert].card` / `PageSkeleton`). Тело:

```tsx
<div className="route" data-screen-label="Plot board">
  <div className="page page-board">
    <div className="page-head">
      <h1>Доска сюжета</h1>
      <p className="muted page-sub">{book?.title} · {notes.length} заметок</p>
      <Link to={`/books/${id}/studio`} className="btn btn-ghost btn-sm" viewTransition>← В Studio</Link>
    </div>

    {notes.length === 0 ? (
      <div className="card board-empty">
        <p>Доска пуста. Заметки появляются сами, когда агенты памяти разбирают написанные главы.</p>
      </div>
    ) : (
      <div className="board-scroll">
        <div
          className="board-canvas"
          style={{ width: boardWidth(columns) + COLUMN_W / 2, height: boardHeight(placed) + 40 }}
        >
          <svg className="board-threads" aria-hidden="true"
               width={boardWidth(columns) + COLUMN_W / 2} height={boardHeight(placed) + 40}>
            {placed.map((p) => {
              const span = threadSpan(p.note, columns);
              const y = p.y + 24;
              return (
                <path key={p.note.id}
                  className={`thread ${span.open ? "thread-open" : ""}`}
                  d={`M ${span.x1} ${y} C ${span.x1 + 40} ${y + 18}, ${span.x2 - 40} ${y + 18}, ${span.x2} ${y}`} />
              );
            })}
          </svg>

          {placed.map((p) => (
            <article
              key={p.note.id}
              className={`board-note note-${p.note.kind}`}
              style={{ left: p.x, top: p.y }}
              aria-label={
                p.note.resolved === null
                  ? `Открытая линия: ${p.note.title}`
                  : `${p.note.title} · закрыта в главе ${p.note.resolved}`
              }
            >
              <span className="board-pin" aria-hidden="true" />
              <div className="board-note-kind cap-upper mono">{KIND_LABEL[p.note.kind]}</div>
              <h2 className="board-note-title">{p.note.title}</h2>
              <p className="board-note-body">{p.note.body}</p>
              <div className="board-note-foot mono faint">
                гл. {p.note.introduced}
                {p.note.resolved !== null ? ` → ${p.note.resolved}` : " · открыта"}
              </div>
            </article>
          ))}
        </div>
      </div>
    )}
  </div>
</div>
```

`KIND_LABEL: Record<NoteKind, string>` = thread «нить», foreshadow «предвестие», arc_delta «арка», theme «тема», mystery «тайна».

Роут в `App.tsx` рядом со studio-роутами: `{ path: "/books/:bookId/board", element: <PlotBoardPage /> }`.

`AppShell.tsx`: в `RouteInfo["name"]` добавить `"board"`; в `parseRoute` — ветка `if (parts[2] === "board") return { name: "board", bookId };` (ДО существующей проверки chapters/после studio — порядок веток не ломать); в `breadcrumb` — `case "board": return ["Книги", '#'+route.bookId, "Доска"];`; в `items` LeftRail — новый элемент после studio:

```tsx
{
  id: "board",
  label: "Доска",
  to: bookId ? `/books/${bookId}/board` : "/books",
  icon: <PinIcon size={18} aria-hidden="true" />,   // lucide Pin
  active: route.name === "board",
  show: Boolean(bookId),
},
```

Также в `active` у studio-элемента убедиться, что доска не подсвечивает Studio (там `route.name === "studio" || route.name === "chapter"` — «board» туда НЕ добавлять).

- [ ] **Step 4: GREEN + гейт + коммит**

Run: `pnpm --filter @book-forge/web test -- src/pages/PlotBoardPage.test.tsx` → PASS (3)
Run: `pnpm typecheck && pnpm --filter @book-forge/web test` → PASS (все страницы, включая AppShell-зависимые).

```bash
git add apps/web/src/pages/PlotBoardPage.tsx apps/web/src/pages/PlotBoardPage.test.tsx apps/web/src/App.tsx apps/web/src/components/shell/AppShell.tsx
git commit -m "feat(web): plot board page — sticky notes on chapter timeline"
```

---

### Task 4: CSS доски + финал

**Files:**
- Modify: `apps/web/src/styles/library-warm.css`
- Modify: `CLAUDE.md`

- [ ] **Step 1: CSS-секция (после Workshop, перед legacy)**

```css
/* ─── Plot board (Доска сюжета, phase 2) ─────────────────── */

.board-scroll { overflow: auto; padding: 8px 0 24px; }

.board-canvas {
  position: relative;
  border-radius: var(--radius-panel);
  border: 1px solid var(--color-border);
  /* пробка: мелкая крошка */
  background-color: #2A2418;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(217, 164, 74, 0.05) 1px, transparent 1px),
    radial-gradient(circle at 70% 60%, rgba(217, 164, 74, 0.04) 1px, transparent 1px),
    radial-gradient(circle at 45% 85%, rgba(232, 182, 92, 0.03) 1px, transparent 1px);
  background-size: 26px 26px, 34px 34px, 41px 41px;
  padding: 20px;
}

/* Канва — containing block с padding: у абсолютных детей начало координат
   уже в padding-box, поэтому НИКАКИХ дополнительных 20px-сдвигов ни здесь,
   ни у .board-note (иначе двойное смещение). */
.board-threads { position: absolute; top: 0; left: 0; pointer-events: none; }
.thread {
  fill: none;
  stroke: var(--color-ink-red);
  stroke-width: 1.5;
  opacity: 0.55;
}
.thread-open { stroke-dasharray: 5 4; opacity: 0.4; }

.board-note {
  position: absolute;
  width: 176px;
  padding: 14px 12px 10px;
  border-radius: 3px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
  transform: rotate(-0.6deg);
  transition: transform var(--motion-2) var(--ease-in-out);
}
.board-note:nth-child(even) { transform: rotate(0.8deg); }
.board-note:hover { transform: rotate(0deg) translateY(-3px); z-index: 2; }
@media (prefers-reduced-motion: reduce) {
  .board-note, .board-note:hover { transition: none; transform: none; }
}

.board-pin {
  position: absolute; top: -6px; left: 50%;
  width: 10px; height: 10px; margin-left: -5px;
  border-radius: 50%;
  background: var(--color-ink-red);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.55), inset 0 -2px 3px rgba(0, 0, 0, 0.35);
}

.board-note-kind { font-size: 9px; color: var(--color-text-faint); letter-spacing: .1em; }
.board-note-title {
  font-family: var(--font-display); font-size: 13px; font-weight: 500;
  color: var(--color-text-strong); margin: 4px 0 6px; line-height: 1.3;
}
.board-note-body {
  font-family: var(--font-prose); font-size: 11.5px; line-height: 1.45;
  color: var(--color-text-muted);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.board-note-foot { font-size: 9.5px; margin-top: 8px; }

/* тон стикера по типу заметки */
.note-thread    { border-left: 3px solid var(--color-ink-blue); }
.note-foreshadow{ border-left: 3px solid var(--color-ink-amber); }
.note-arc_delta { border-left: 3px solid var(--color-ink-green); }
.note-theme     { border-left: 3px solid var(--color-brass); }
.note-mystery   { border-left: 3px solid var(--color-ink-red); }

.board-empty { padding: 32px; text-align: center; color: var(--color-text-muted); }
```

- [ ] **Step 2: Полный гейт**

Run: `pnpm typecheck && pnpm test` → PASS (весь репо).

- [ ] **Step 3: CLAUDE.md** (после строки про Мастерскую):

```markdown
Комната «Доска сюжета» (phase 2): `/books/:bookId/board` — заметки `book_notes` как стикеры на пробке, колонка = глава появления, красная нить тянется до главы закрытия (открытые — пунктиром за край). Геометрия в [board.ts](apps/web/src/lib/board.ts), данные — `GET /api/books/:id/notes`. Read-only: заметки пишут агенты памяти.
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/library-warm.css CLAUDE.md
git commit -m "feat(web): cork board styling + docs"
```

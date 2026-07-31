# Writer's Den Phase 2 — Room 1 «Библиотека» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить BooksListPage из грида карточек в книжную полку: корешки (толщина = число глав), ляссе-прогресс, полки-доски, призрак «+» для новой книги.

**Architecture:** Серверный агрегат `GET /api/books/stats` (главы/слова/готовые по книгам, один SQL). Web: чистые геометрические функции в `lib/shelf.ts` (unit-тесты), ресценография JSX в BooksListPage с сохранением всех текстов/ролей, на которые завязаны тесты, CSS-секция Bookshelf в library-warm.css. Полка НЕ гейтится atm-классами (это layout комнаты, не декор); только hover-лифт уважает reduced-motion.

**Tech Stack:** Hono + better-sqlite3 (raw SQL), React 18, vitest + RTL, plain CSS в library-warm.css.

**Spec:** `docs/superpowers/specs/2026-07-12-cozy-writers-den-design.md` §5.1
**Base:** ветка feat/atmosphere-phase-1 (этап 1 завершён на de000a2)

## Global Constraints

- TS strict + `noUncheckedIndexedAccess`; ESM (`.js` суффиксы в relative-импортах сервера); ноль новых npm-зависимостей.
- Тесты `BooksListPage.test.tsx` фиксируют (НЕ ломать): `getByRole("button", {name:/Новая книга/})` — ровно ОДНА такая кнопка; `getByLabelText("Название книги")`; `getByRole("button", {name:/Создать/})`; `findByRole("link", {name:/Продолжить/})` с `href="/books/7/studio/plot"` — настоящий `<a>`; `findByRole("heading", {name:"Маяк"})` — заголовок книги остаётся heading. Любой НОВЫЙ api-вызов со страницы требует мок в тестах, иначе они падают.
- `/api/books/stats` объявляется в books-роуте ДО `GET /:id` (иначе "stats" сматчится как id).
- Web-запрос статистики — fail-silent (как `listRecommended`): при ошибке полка рендерится с дефолтной геометрией.
- Никакого `Math.random` в геометрии — детерминированный сид из названия.
- `@/` алиас в новых файлах; в существующих — стиль файла.
- Коммит в конце каждой задачи; прогоны `pnpm typecheck`, `pnpm --filter @book-forge/web test`, `pnpm --filter @book-forge/server test`.

---

### Task 1: Сервер — агрегат статистики книг

**Files:**
- Modify: `apps/server/src/routes/books.ts` (новый `GET /stats` ПЕРЕД `GET /:id`)
- Test: `apps/server/src/routes/__tests__/books-stats.test.ts`

**Interfaces:**
- Produces: `GET /api/books/stats` → `Record<string, { chapters: number; done: number; words: number }>` (ключ — bookId строкой, как JSON-ключи; книги без глав отсутствуют в объекте).

- [ ] **Step 1: Write the failing test**

`apps/server/src/routes/__tests__/books-stats.test.ts` — использовать реальные хелперы `makeTestApp`/`send` (их API смотри в `_helpers.ts`; образец создания книги/главы/версии — соседний тест, напр. `retrieval.test.ts` / `chapters.test.ts`; `docFor(text)`-паттерн оттуда же):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, type TestApp } from "./_helpers.js";

describe("GET /api/books/stats", () => {
  let t: TestApp;
  beforeEach(() => { t = makeTestApp(); });
  afterEach(() => { t.cleanup(); });

  it("returns empty object when there are no chapters", async () => {
    const res = await send(t.app, "/api/books/stats", "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("aggregates chapters, done count and words per book", async () => {
    // создать книгу через POST /api/books, две главы через POST-эндпоинт глав
    // (точные пути/пейлоады скопировать из соседнего теста),
    // одной главе закоммитить версию с текстом из 5 слов и выставить status='final'
    // (PATCH /api/chapters/:id — см. chapters.test.ts)
    // затем:
    const res = await send(t.app, "/api/books/stats", "GET");
    const stats = await res.json();
    const entry = stats[String(bookId)];
    expect(entry.chapters).toBe(2);
    expect(entry.done).toBe(1);
    expect(entry.words).toBe(5);
  });
});
```

Каркас второго теста адаптировать к реальному API создания (это интеграционный тест против настоящих роутов — ассерты выше обязательны, форма создания данных — по образцу соседей).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/books-stats.test.ts`
Expected: FAIL — 404 на /api/books/stats.

- [ ] **Step 3: Implement endpoint**

В `apps/server/src/routes/books.ts`, ВЫШЕ обработчика `r.get("/:id", ...)`:

```ts
  // Полка (Library room): агрегат для геометрии корешков. Книги без глав опущены.
  r.get("/stats", (c) => {
    const rows = sqlite
      .prepare(
        `SELECT c.book_id AS bookId,
                COUNT(*) AS chapters,
                SUM(CASE WHEN c.status = 'final' THEN 1 ELSE 0 END) AS done,
                SUM(COALESCE(v.word_count, 0)) AS words
         FROM chapters c
         LEFT JOIN chapter_versions v ON v.id = c.current_version_id
         GROUP BY c.book_id`,
      )
      .all() as Array<{ bookId: number; chapters: number; done: number; words: number }>;
    const out: Record<string, { chapters: number; done: number; words: number }> = {};
    for (const r of rows) out[String(r.bookId)] = { chapters: r.chapters, done: r.done, words: r.words };
    return c.json(out);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @book-forge/server test -- src/routes/__tests__/books-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Полный прогон + коммит**

Run: `pnpm typecheck && pnpm --filter @book-forge/server test`
Expected: PASS.

```bash
git add apps/server/src/routes/books.ts apps/server/src/routes/__tests__/books-stats.test.ts
git commit -m "feat(server): GET /api/books/stats aggregate for bookshelf geometry"
```

---

### Task 2: Web — геометрия полки + api-метод

**Files:**
- Create: `apps/web/src/lib/shelf.ts`
- Test: `apps/web/src/lib/__tests__/shelf.test.ts`
- Modify: `apps/web/src/api/client.ts` (метод `getBooksStats`)

**Interfaces:**
- Produces: `type BookStats = { chapters: number; done: number; words: number }`; `titleSeed(title): number` (детерминированный хеш); `spineWidth(chapters): number` (46..78px); `spineHeight(chapters, seed): number` (170..234px); `spineTone(seed): 0|1|2|3`; `shelfProgress(done, chapters): number` (0..1); `api.getBooksStats(): Promise<Record<string, BookStats>>`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/__tests__/shelf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  shelfProgress,
  spineHeight,
  spineTone,
  spineWidth,
  titleSeed,
} from "../shelf";

describe("shelf geometry", () => {
  it("titleSeed is deterministic and differs across titles", () => {
    expect(titleSeed("Маяк")).toBe(titleSeed("Маяк"));
    expect(titleSeed("Маяк")).not.toBe(titleSeed("Зима"));
  });

  it("spineWidth grows with chapters and clamps", () => {
    expect(spineWidth(0)).toBe(46);
    expect(spineWidth(5)).toBe(56);
    expect(spineWidth(100)).toBe(78);
    expect(spineWidth(Number.NaN)).toBe(46);
    expect(spineWidth(-3)).toBe(46);
  });

  it("spineHeight stays within the shelf row", () => {
    for (const ch of [0, 1, 12, 24, 60]) {
      for (const seed of [0, 1, 2, 7, 12345]) {
        const h = spineHeight(ch, seed);
        expect(h).toBeGreaterThanOrEqual(170);
        expect(h).toBeLessThanOrEqual(234);
      }
    }
  });

  it("spineTone maps seed to 0..3", () => {
    expect([0, 1, 2, 3]).toContain(spineTone(titleSeed("Маяк")));
    expect(spineTone(7)).toBe(3);
  });

  it("shelfProgress clamps and guards zero chapters", () => {
    expect(shelfProgress(0, 0)).toBe(0);
    expect(shelfProgress(1, 2)).toBe(0.5);
    expect(shelfProgress(5, 2)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/shelf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/shelf.ts`:

```ts
/** Геометрия книжной полки: всё детерминировано от данных книги,
    без Math.random — полка не «прыгает» между рендерами. */

export interface BookStats {
  chapters: number;
  done: number;
  words: number;
}

export function titleSeed(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Толщина корешка: 46px базово, +2px за главу, максимум 78px. */
export function spineWidth(chapters: number): number {
  if (!Number.isFinite(chapters) || chapters < 0) return 46;
  return Math.min(78, 46 + Math.round(chapters) * 2);
}

/** Высота корешка: 170..234px — вписывается в ряд полки 252px. */
export function spineHeight(chapters: number, seed: number): number {
  const ch = Number.isFinite(chapters) && chapters > 0 ? Math.min(chapters, 24) : 0;
  return 170 + ch * 2 + (Math.abs(seed) % 3) * 8;
}

export function spineTone(seed: number): number {
  return Math.abs(seed) % 4;
}

export function shelfProgress(done: number, chapters: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(chapters) || chapters <= 0) return 0;
  return Math.max(0, Math.min(1, done / chapters));
}
```

В `apps/web/src/api/client.ts`, в объект `api` рядом с `listBooks`:

```ts
getBooksStats: () =>
  req<Record<string, { chapters: number; done: number; words: number }>>(
    "/api/books/stats",
  ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/shelf.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Полный прогон + коммит**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

```bash
git add apps/web/src/lib/shelf.ts apps/web/src/lib/__tests__/shelf.test.ts apps/web/src/api/client.ts
git commit -m "feat(web): shelf geometry helpers + books stats api method"
```

---

### Task 3: Web — полка вместо грида (BooksListPage)

**Files:**
- Modify: `apps/web/src/pages/BooksListPage.tsx`
- Modify: `apps/web/src/pages/BooksListPage.test.tsx` (мок `getBooksStats` + новые ассерты)

**Interfaces:**
- Consumes: Task 2 (`shelf.ts`, `api.getBooksStats`).
- Produces: разметка `.bookshelf > .shelf-slot > .shelf-book` (стили — Task 4).

- [ ] **Step 1: Обновить тесты (RED)**

В `BooksListPage.test.tsx`:
1. В `vi.mock("@/api/client", ...)` (или фактический путь мока) добавить `getBooksStats: vi.fn().mockResolvedValue({ "7": { chapters: 12, done: 6, words: 34000 } })` — id `7` подогнать под существующие фикстуры файла.
2. Существующие ассерты НЕ трогать.
3. Добавить тесты:

```tsx
it("renders books as spines on the shelf", async () => {
  renderPage();
  const spine = await screen.findByRole("link", { name: "Маяк" });
  expect(spine.className).toContain("shelf-book");
});

it("shows the ghost slot that opens the create form", async () => {
  renderPage();
  const ghost = await screen.findByRole("button", { name: "Добавить книгу" });
  fireEvent.click(ghost);
  expect(screen.getByLabelText("Название книги")).toBeInTheDocument();
});
```

(`renderPage`/фикстуры — использовать хелперы, уже существующие в этом файле; `role: "link"` у корешка — потому что корневой элемент книги сохраняет `role="link"` + `aria-label={title}`, как у старой карточки.)

Run: `pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: FAIL — новых элементов нет (старые тесты пока зелёные).

- [ ] **Step 2: Переписать разметку списка**

В `BooksListPage.tsx`:

1. Импорты: `import { shelfProgress, spineHeight, spineTone, spineWidth, titleSeed, type BookStats } from "@/lib/shelf";` (путь — в стиле файла).
2. Состояние: `const [stats, setStats] = useState<Record<string, BookStats>>({});` и в загрузке данных, рядом с fail-silent `listRecommended`: `api.getBooksStats().then(setStats).catch(() => {});`
3. Заменить `div.bookgrid` и карточку `.bookcard` на полку. Целевой JSX элемента книги (данные/обработчики — те же, что были у `.bookcard`: navigate по клику/Enter, `rec` из listRecommended):

```tsx
<div className="bookshelf" aria-label="Список книг">
  {books.map((b) => {
    const s = stats[String(b.id)];
    const seed = titleSeed(b.title);
    const progress = shelfProgress(s?.done ?? 0, s?.chapters ?? 0);
    const rec = recommended[b.id];
    return (
      <div className="shelf-slot" key={b.id}>
        <div
          className={`shelf-book spine-tone-${spineTone(seed)}`}
          role="link"
          tabIndex={0}
          aria-label={b.title}
          title={
            s
              ? `${b.title} · ${s.chapters} гл. · ${s.words.toLocaleString("ru-RU")} слов`
              : b.title
          }
          style={{
            width: spineWidth(s?.chapters ?? 0),
            height: spineHeight(s?.chapters ?? 0, seed),
          }}
          onClick={() => navigate(`/books/${b.id}/studio`)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate(`/books/${b.id}/studio`);
          }}
        >
          {progress > 0 && (
            <span
              className="shelf-ribbon"
              style={{ height: `${Math.round(progress * 100)}%` }}
              aria-hidden="true"
            />
          )}
          <h2 className="shelf-title">{b.title}</h2>
          {rec && (
            <Link
              to={`/books/${b.id}/studio/${rec}`}
              className="shelf-continue"
              aria-label="Продолжить"
              title="Продолжить работу"
              onClick={(e) => e.stopPropagation()}
            >
              →
            </Link>
          )}
        </div>
      </div>
    );
  })}
  <div className="shelf-slot">
    <button
      type="button"
      className="shelf-book shelf-book-ghost"
      aria-label="Добавить книгу"
      title="Добавить книгу"
      onClick={() => setCreating(true)}
    >
      +
    </button>
  </div>
</div>
```

4. Удалить более не используемое: разметку `.bookcard*`/`.spine`/`.bookcard-kebab` из JSX этого файла (мета-строка, заглушки «— глав/— слов», kebab-кнопка уходят — их не ассертит ни один тест; заголовок остаётся `h2`, «Продолжить» остаётся `<a>`).
5. Хедер страницы, кнопка «Новая книга», inline-форма создания, empty/loading/error-состояния — БЕЗ изменений (empty-state карточка остаётся, полка рендерится только при `books.length > 0`; ghost-слот — внутри полки).
6. Точечная адаптация под фактический код файла разрешена (имена переменных состояния, обработчики), контракт — тексты/роли/href из Global Constraints.

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm --filter @book-forge/web test -- src/pages/BooksListPage.test.tsx`
Expected: PASS — старые И новые тесты (в jsdom полка без CSS — это нормально).

- [ ] **Step 4: Полный прогон + коммит**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

```bash
git add apps/web/src/pages/BooksListPage.tsx apps/web/src/pages/BooksListPage.test.tsx
git commit -m "feat(web): books list becomes a bookshelf — spines, ribbon progress, ghost slot"
```

---

### Task 4: CSS полки

**Files:**
- Modify: `apps/web/src/styles/library-warm.css` (новая секция после атмосферных, перед legacy aliases; старую секцию BooksListPage (~строки 803-878) НЕ удалять в этой задаче — вычистка в Task 5 после зелёного гейта)

**Interfaces:**
- Consumes: классы из Task 3.

- [ ] **Step 1: Добавить секцию**

```css
/* ─── Bookshelf (Library room, phase 2) ───────────────────── */

:root {
  --shelf-row: 252px;
  --shelf-plank: #2E3A57;
  --shelf-plank-edge: rgba(7, 9, 15, 0.55);
}

/* Доски рисуются фоном с шагом ряда: каждый ряд слотов ровно
   --shelf-row высотой, книги прижаты к низу ряда. */
.bookshelf {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  column-gap: 10px;
  padding: 0 18px;
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0 calc(var(--shelf-row) - 14px),
    var(--shelf-plank) calc(var(--shelf-row) - 14px) calc(var(--shelf-row) - 3px),
    var(--shelf-plank-edge) calc(var(--shelf-row) - 3px) var(--shelf-row)
  );
}

.shelf-slot {
  height: var(--shelf-row);
  display: flex;
  align-items: flex-end;
  padding-bottom: 14px;
}

.shelf-book {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px 4px 2px 2px;
  cursor: pointer;
  box-shadow:
    inset -7px 0 12px rgba(0, 0, 0, 0.38),
    inset 2px 0 3px rgba(255, 255, 255, 0.06),
    0 5px 12px rgba(0, 0, 0, 0.45);
  transition:
    transform var(--motion-2) var(--ease-in-out),
    box-shadow var(--motion-2) var(--ease-in-out);
}
.shelf-book:hover,
.shelf-book:focus-visible {
  transform: translateY(-10px);
  box-shadow:
    inset -7px 0 12px rgba(0, 0, 0, 0.38),
    inset 2px 0 3px rgba(255, 255, 255, 0.06),
    0 14px 22px rgba(0, 0, 0, 0.5);
}
.shelf-book:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .shelf-book,
  .shelf-book:hover,
  .shelf-book:focus-visible {
    transition: none;
    transform: none;
  }
}

/* Тона переплётов: приглушённые чернильные, латунное тиснение заголовка */
.spine-tone-0 { background: linear-gradient(90deg, #2C3046, #232A3E 55%, #1D2334); }
.spine-tone-1 { background: linear-gradient(90deg, #3D2B33, #33242C 55%, #281D24); }
.spine-tone-2 { background: linear-gradient(90deg, #29382F, #223027 55%, #1B2620); }
.spine-tone-3 { background: linear-gradient(90deg, #253347, #1F2C3E 55%, #192433); }

.shelf-title {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--color-brass-hi);
  max-height: 82%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
}

.shelf-ribbon {
  position: absolute;
  top: 0;
  right: 7px;
  width: 4px;
  background: var(--color-ink-red);
  border-radius: 0 0 2px 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

.shelf-continue {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-brass-tint);
  color: var(--color-brass-hi);
  font-size: 12px;
  line-height: 1;
}
.shelf-continue:hover { background: var(--color-brass-glow); }

.shelf-book-ghost {
  width: 46px;
  height: 178px;
  background: transparent;
  border: 1.5px dashed var(--color-border-strong);
  color: var(--color-text-faint);
  font-size: 22px;
  box-shadow: none;
}
.shelf-book-ghost:hover {
  color: var(--color-brass);
  border-color: var(--color-brass-soft);
  box-shadow: none;
}
```

- [ ] **Step 2: Проверка + коммит**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

```bash
git add apps/web/src/styles/library-warm.css
git commit -m "feat(web): bookshelf CSS — planks, spine tones, ribbon, ghost slot"
```

---

### Task 5: Вычистка мёртвого CSS + финальный гейт + доки

**Files:**
- Modify: `apps/web/src/styles/library-warm.css` (удалить секцию BooksListPage `.bookgrid`/`.bookcard*`, ~строки 803-878 — ПРОВЕРИТЬ grep'ом, что классы больше нигде не используются в `apps/web/src`; `.spine`/`.spine-emboss` удалить только если не используются другими страницами — проверить grep)
- Modify: `CLAUDE.md` (строка про полку в Frontend-секции)

- [ ] **Step 1: Grep-проверка и удаление**

Run: `grep -rn "bookgrid\|bookcard" apps/web/src --include="*.tsx"` → должно быть 0 совпадений; только тогда удалить CSS-блок. `grep -rn "className=\"spine\|spine-emboss" apps/web/src --include="*.tsx"` → если 0, удалить и `.spine*`-правила старой секции.

- [ ] **Step 2: Полный гейт**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (все пакеты).

- [ ] **Step 3: CLAUDE.md**

В абзац про атмосферу (Frontend) добавить предложение:

```markdown
Комната «Библиотека» (phase 2): BooksListPage — книжная полка (`.bookshelf`), геометрия корешков в [shelf.ts](apps/web/src/lib/shelf.ts) от `GET /api/books/stats` (агрегат глав/слов/готовых).
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/library-warm.css CLAUDE.md
git commit -m "chore(web): drop dead bookcard CSS, document Library room"
```

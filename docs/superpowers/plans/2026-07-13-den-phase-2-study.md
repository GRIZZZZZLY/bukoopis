# Writer's Den Phase 2 — Room 2 «Кабинет» (ChapterPage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChapterPage из 2-колоночного Tailwind-грида превращается в референсный 3-колоночный «кабинет»: рейл оглавления · рукопись на столе (`.ms-paper`) · рейл критики «письма редактора»; живой статус сохранения в StatusBar; чернильница-автосейв.

**Architecture:** Весь CSS референса УЖЕ в `library-warm.css:852-1097` (`.chapter-grid`, `.outline-*`, `.ms-*`, `.cri-*`) — задача в основном JSX-ресценография. Данные/логика ChapterPage (draft-автосейв, версии, канон, стриминг Writer, hotkeys) НЕ трогаются — меняется только вёрстка вокруг. Новый store `saveStatus` (паттерн focusMode) связывает автосейв главы с глобальным StatusBar.

**Tech Stack:** React 18, TipTap (не трогаем конфигурацию), vitest + RTL, plain CSS в library-warm.css.

**Spec:** `docs/superpowers/specs/2026-07-12-cozy-writers-den-design.md` §5.2
**Reference JSX:** `d:/PROJECTS/BOOKOPIS/book_redisign/extracted/js/chapter.jsx` (читать при реализации: OutlineRail 7-41, Manuscript 58-110, CritiqueRail 131-193)

## Global Constraints

- TS strict + `noUncheckedIndexedAccess`; ноль новых npm-зависимостей; `@/` алиас в новых файлах, стиль файла — в существующих.
- Функциональность ChapterPage сохраняется полностью: input заголовка, preview-баннер версий, MemoryStaleBanner, PlanPanel, Writer/Стоп + WriterCostBadge, live-stream панель, FocusToggle, EditorToolbar (Undo/Redo/kbd/Сохранить), EditorContent + EmptyEditorHint, AutosaveStatus + MemoryStatusBadge, InlineCommandPanel, Сохранить/Восстановить, CanonPanel, список версий, VersionDiff, ConfirmDialog + DiscardOption, Sheet (mobile), hotkeys (mod+s/mod+enter/esc), blocker. Ничего из этого не удалять — только перекладывать в новые колонки/обёртки.
- Прямых тестов ChapterPage нет; existing-тесты не затрагиваются. Новые компоненты (OutlineRail, saveStatus) получают собственные тесты (TDD).
- CSS: использовать существующие классы 852-1097; новые правила — только в атмосферную зону файла, гейт atm-* только для декора (текстура стола, чернильница-анимация), НЕ для layout.
- Мобильный фоллбек: `.chapter-grid` уже `display:grid`; на `< md` рейлы скрываются (CSS media или существующий Sheet-паттерн) — рукопись остаётся работоспособной.
- Коммит после каждой задачи; прогоны `pnpm typecheck && pnpm --filter @book-forge/web test`.

---

### Task 1: saveStatus store + живой StatusBar

**Files:**
- Create: `apps/web/src/lib/saveStatus.ts`
- Test: `apps/web/src/lib/__tests__/saveStatus.test.ts`
- Modify: `apps/web/src/components/shell/AppShell.tsx` (StatusBar, строки ~317-331)
- Modify: `apps/web/src/pages/ChapterPage.tsx` (публикация статуса из debouncedSave-эффектов)

**Interfaces:**
- Produces: `type SaveState = { kind: "idle" | "saving" | "saved" | "error"; at: number | null }`; `reportSave(s: SaveState): void`; `useSaveStatus(): SaveState`; `resetSaveStatus(): void` (вызывается при unmount страницы главы → StatusBar возвращается к idle-виду).

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/__tests__/saveStatus.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return await import("../saveStatus");
}

describe("saveStatus store", () => {
  beforeEach(() => vi.resetModules());

  it("starts idle", async () => {
    const m = await freshModule();
    expect(m.getSaveStatus()).toEqual({ kind: "idle", at: null });
  });

  it("reportSave updates state and notifies", async () => {
    const m = await freshModule();
    let seen = 0;
    m.subscribeSaveStatus(() => seen++);
    m.reportSave({ kind: "saving", at: 123 });
    expect(m.getSaveStatus()).toEqual({ kind: "saving", at: 123 });
    expect(seen).toBe(1);
  });

  it("resetSaveStatus returns to idle", async () => {
    const m = await freshModule();
    m.reportSave({ kind: "saved", at: 5 });
    m.resetSaveStatus();
    expect(m.getSaveStatus()).toEqual({ kind: "idle", at: null });
  });
});
```

- [ ] **Step 2: RED**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/saveStatus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/saveStatus.ts` — точный паттерн `focusMode.ts` (useSyncExternalStore, Set листенеров):

```ts
import { useSyncExternalStore } from "react";

/** Глобальный статус сохранения рукописи: ChapterPage публикует,
    StatusBar в shell показывает. Вне React — как focusMode. */

export type SaveState = {
  kind: "idle" | "saving" | "saved" | "error";
  at: number | null;
};

const IDLE: SaveState = { kind: "idle", at: null };
let state: SaveState = IDLE;
const listeners = new Set<() => void>();

export function getSaveStatus(): SaveState {
  return state;
}

export function reportSave(next: SaveState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function resetSaveStatus(): void {
  reportSave(IDLE);
}

export function subscribeSaveStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSaveStatus(): SaveState {
  return useSyncExternalStore(subscribeSaveStatus, getSaveStatus, () => IDLE);
}
```

- [ ] **Step 4: GREEN**

Run: та же команда. Expected: PASS (3 tests).

- [ ] **Step 5: Подключение**

1. `ChapterPage.tsx`: в эффектах вокруг `debouncedSave` (см. `useDebouncedSave` на ~строке 164 и `AutosaveStatus`-пропсы на ~753 — `debouncedSave.saving`, `debouncedSave.lastSavedAt`, `saveError`) добавить публикацию:

```tsx
useEffect(() => {
  if (saveError) reportSave({ kind: "error", at: Date.now() });
  else if (debouncedSave.saving) reportSave({ kind: "saving", at: Date.now() });
  else if (debouncedSave.lastSavedAt)
    reportSave({ kind: "saved", at: debouncedSave.lastSavedAt });
}, [debouncedSave.saving, debouncedSave.lastSavedAt, saveError]);

useEffect(() => () => resetSaveStatus(), []);
```

(Имена переменных сверить с фактическим кодом — контракт: три источника AutosaveStatus.)

2. `AppShell.tsx` → `StatusBar`: заменить хардкод `сохранено · только что`:

```tsx
function StatusBar() {
  const save = useSaveStatus();
  const label =
    save.kind === "saving" ? "автосохранение…"
    : save.kind === "error" ? "ошибка сохранения"
    : save.kind === "saved" && save.at ? `сохранено · ${relativeTime(save.at)}`
    : "готов к работе";
  const dot =
    save.kind === "error" ? "dot-err" : save.kind === "saving" ? "dot-warn" : "dot-ok";
  return (
    <footer className="statusbar mono" aria-label="Состояние сессии">
      <span className="status-group">
        <span className={`dot ${dot}`} />
        <span>{label}</span>
      </span>
      ...остальное без изменений...
    </footer>
  );
}
```

`relativeTime`: если в codebase уже есть хелпер (grep `relativeTime` — BooksListPage его использует) — импортировать его; иначе локально `const relativeTime = (ts: number) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });`. Классы `dot-warn`/`dot-err`: проверить в library-warm.css (grep `.dot-`); если нет — добавить рядом с `.dot-ok` (`dot-warn` = ink-amber, `dot-err` = ink-red).

- [ ] **Step 6: Полный прогон + коммит**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test` → PASS.

```bash
git add apps/web/src/lib/saveStatus.ts apps/web/src/lib/__tests__/saveStatus.test.ts apps/web/src/components/shell/AppShell.tsx apps/web/src/pages/ChapterPage.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): live save status in shell StatusBar via saveStatus store"
```

---

### Task 2: OutlineRail — оглавление книги слева

**Files:**
- Create: `apps/web/src/components/chapter/OutlineRail.tsx`
- Test: `apps/web/src/components/chapter/__tests__/OutlineRail.test.tsx`

**Interfaces:**
- Consumes: `api.listChapters(bookId)` (существует, `GET /api/books/:id/chapters` → Chapter[] с `id`, `title`, `orderIndex`, `status`).
- Produces: `<OutlineRail bookId={number} activeChapterId={number} collapsed={boolean} />` — `aside.outline-rail` со списком глав (референс chapter.jsx:7-41): `.outline-head` «Оглавление», `ol.outline-list`, `li.outline-item` (+`-active`), внутри `<Link>` на `/books/:bookId/chapters/:id` с `.outline-bar`/`.outline-num`/`.outline-title`; `.outline-foot` — число глав. Fail-silent загрузка.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/chapter/__tests__/OutlineRail.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OutlineRail } from "../OutlineRail";

vi.mock("@/api/client", () => ({
  api: {
    listChapters: vi.fn().mockResolvedValue([
      { id: 1, orderIndex: 0, title: "Начало", status: "final" },
      { id: 2, orderIndex: 1, title: "Туман", status: "draft" },
    ]),
  },
}));

function renderRail(active = 2) {
  return render(
    <MemoryRouter>
      <OutlineRail bookId={7} activeChapterId={active} collapsed={false} />
    </MemoryRouter>,
  );
}

describe("OutlineRail", () => {
  it("lists chapters as links with numbering", async () => {
    renderRail();
    const link = await screen.findByRole("link", { name: /Туман/ });
    expect(link).toHaveAttribute("href", "/books/7/chapters/2");
    expect(screen.getByRole("link", { name: /Начало/ })).toBeInTheDocument();
  });

  it("marks the active chapter", async () => {
    renderRail(2);
    const item = (await screen.findByRole("link", { name: /Туман/ })).closest("li");
    expect(item?.className).toContain("outline-item-active");
  });

  it("renders nothing while collapsed", async () => {
    render(
      <MemoryRouter>
        <OutlineRail bookId={7} activeChapterId={1} collapsed={true} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
```

(Мок-поля Chapter сверить с реальным типом — добавить обязательные поля типа, если TS потребует.)

- [ ] **Step 2: RED** — `pnpm --filter @book-forge/web test -- src/components/chapter/__tests__/OutlineRail.test.tsx` → module not found.

- [ ] **Step 3: Implement**

`OutlineRail.tsx` — по референсу chapter.jsx:7-41, классы из library-warm.css 888-921:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import type { Chapter } from "@book-forge/shared";

export function OutlineRail({
  bookId,
  activeChapterId,
  collapsed,
}: {
  bookId: number;
  activeChapterId: number;
  collapsed: boolean;
}) {
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .listChapters(bookId)
      .then((cs) => {
        if (alive) setChapters(cs);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bookId]);

  if (collapsed) return <aside className="outline-rail outline-rail-collapsed" aria-hidden="true" />;

  return (
    <aside className="outline-rail" aria-label="Оглавление">
      <div className="outline-head cap-upper">Оглавление</div>
      <ol className="outline-list">
        {chapters.map((ch, i) => (
          <li
            key={ch.id}
            className={`outline-item ${ch.id === activeChapterId ? "outline-item-active" : ""}`}
          >
            <Link to={`/books/${bookId}/chapters/${ch.id}`} viewTransition>
              <span className="outline-bar" aria-hidden="true" />
              <span className="outline-num mono">{i + 1}</span>
              <span className="outline-title">{ch.title}</span>
            </Link>
          </li>
        ))}
      </ol>
      <div className="outline-foot faint mono">{chapters.length} гл.</div>
    </aside>
  );
}
```

(Импорт типа Chapter: сверить экспорт `@book-forge/shared`; если пакет не экспортирует — локальный минимальный тип `{ id: number; title: string; status?: string }`. `.outline-rail-collapsed`: если класса нет в CSS — добавить `{ width: 0; overflow: hidden; padding: 0; border: 0; }` в атмосферную зону.)

- [ ] **Step 4: GREEN** — та же команда, 3 tests PASS.

- [ ] **Step 5: Полный прогон + коммит**

```bash
git add apps/web/src/components/chapter apps/web/src/styles/library-warm.css
git commit -m "feat(web): OutlineRail chapter navigation component"
```

---

### Task 3: 3-колоночный chapter-grid + рукопись ms-paper

Самая крупная задача — ресценография `ChapterPage.tsx` (layout-строки ~583-830). Логику не менять.

**Files:**
- Modify: `apps/web/src/pages/ChapterPage.tsx`
- Modify: `apps/web/src/styles/library-warm.css` (мелкие доводки: `.outline-rail-collapsed`, media-фоллбек)

**Interfaces:**
- Consumes: OutlineRail (Task 2), классы `.page-chapter/.chapter-toolbar/.chapter-grid/.chapter-main/.ms-*` (CSS 852-1097 уже есть).

- [ ] **Step 1: Целевой скелет**

Заменить текущий layout (`div.route > main.grid.md:grid-cols-[1fr_360px]`) на:

```tsx
<div className="route page-chapter" data-screen-label="Chapter">
  <div className="chapter-toolbar">
    {/* существующие: «← К главам», кнопка «Панели» (mobile) */}
    <span className="ch-toolbar-spacer" />
    {/* существующие кнопки Writer/Стоп + WriterCostBadge + FocusToggle;
        кнопки скрытия рейлов: */}
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLeftCollapsed(v => !v)}
      aria-pressed={leftCollapsed} title="Оглавление">⌸</button>
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRightCollapsed(v => !v)}
      aria-pressed={rightCollapsed} title="Панели разбора">⌹</button>
  </div>

  <div className={`chapter-grid ${leftCollapsed ? "chapter-grid-noleft" : ""} ${rightCollapsed ? "chapter-grid-noright" : ""}`}>
    <OutlineRail bookId={bookId} activeChapterId={chapterId} collapsed={leftCollapsed} />

    <main className="chapter-main">
      {/* существующие в этом порядке: preview-баннер, MemoryStaleBanner, PlanPanel,
          live-stream панель */}
      <div className="ms-wrap">
        <div className="ms-paper paper-grain">
          <span className="ms-margin" aria-hidden="true" />
          <div className="ms-head">
            <div className="ms-chapter-label cap-upper">Глава {orderLabel}</div>
            {/* существующий title-<input> получает className="ms-title" (убрать инлайн-стили размера) */}
          </div>
          <div className="ms-body">
            {/* существующие EditorToolbar, EditorContent, EmptyEditorHint */}
          </div>
          <div className="ms-footer mono faint">
            {/* существующий AutosaveStatus + MemoryStatusBadge + чернильница (Task 4) */}
          </div>
        </div>
      </div>
      {/* существующие: InlineCommandPanel, кнопки Сохранить/Восстановить */}
    </main>

    <aside className={`cri-rail ${rightCollapsed ? "cri-rail-collapsed" : ""}`} aria-label="Разбор и материалы">
      {/* СЮДА переезжают: CritiquePanel (из центра, ~строка 709) и sidebar
          (SidebarPanels: CanonPanel + список версий, был в aside.hidden.md:flex) */}
    </aside>
  </div>

  {/* без изменений: Sheet (mobile, рендерит те же панели), VersionDiff, ConfirmDialog */}
</div>
```

Правила:
- `orderLabel`: номер главы, если доступен из данных (chapter.orderIndex + 1); иначе просто заголовок «Глава».
- `leftCollapsed`/`rightCollapsed`: новые `useState(false)`; правый по умолчанию раскрыт на десктопе.
- `.cri-rail-collapsed`: добавить CSS `{ width: 0; overflow: hidden; padding: 0; border: 0; }` если отсутствует.
- Мобильный: добавить в CSS `@media (max-width: 900px) { .chapter-grid { grid-template-columns: 0 1fr 0; } .outline-rail, .cri-rail { display: none; } }` — Sheet остаётся мобильным путём к панелям.
- EditorToolbar/AutosaveStatus/CritiquePanel и пр. НЕ редактировать внутренне в этой задаче — только перемещение JSX-вызовов.
- `.paper.relative`-обёртка редактора заменяется на `.ms-paper` (стили бумаги теперь от ms-paper; `maxWidth:680` инлайн у внутреннего div убрать — `.ms-paper` сам ограничивает 720px).

- [ ] **Step 2: Проверка**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test` → PASS (существующие тесты ChapterPage не покрывают — гейт ловит только typecheck/регрессии соседей).

Smoke вручную не требуется от исполнителя (нет браузера) — отметить в отчёте, что визуальная проверка за контроллером.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ChapterPage.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): ChapterPage becomes the Study — 3-column chapter-grid + ms-paper manuscript"
```

---

### Task 4: Критика как «письма редактора» + чернильница

**Files:**
- Modify: `apps/web/src/components/CritiquePanel.tsx` (рестайл под `.cri-*`, замена сырых Tailwind-цветов на токены)
- Create: `apps/web/src/components/atmosphere/InkwellStatus.tsx`
- Test: `apps/web/src/components/atmosphere/__tests__/InkwellStatus.test.tsx`
- Modify: `apps/web/src/pages/ChapterPage.tsx` (вставка InkwellStatus в `.ms-footer`)
- Modify: `apps/web/src/styles/library-warm.css` (чернильница-анимация, atm-гейт)

**Interfaces:**
- Consumes: `useSaveStatus()` (Task 1).
- Produces: `<InkwellStatus />` — SVG-чернильница; при `kind === "saving"` класс `inkwell-drip` (капля, CSS-анимация, гейт `html.atm-full/atm-calm`; в atm-off — статичная иконка); `aria-hidden` (текстовый статус уже даёт AutosaveStatus).

- [ ] **Step 1: Write the failing test (InkwellStatus)**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

async function renderWith(kind: "idle" | "saving" | "saved") {
  vi.resetModules();
  const store = await import("@/lib/saveStatus");
  const { InkwellStatus } = await import("../InkwellStatus");
  store.reportSave({ kind, at: kind === "idle" ? null : 1 });
  return render(<InkwellStatus />);
}

describe("InkwellStatus", () => {
  beforeEach(() => vi.resetModules());

  it("drips while saving", async () => {
    const { container } = await renderWith("saving");
    expect(container.querySelector(".inkwell")?.className).toContain("inkwell-drip");
  });

  it("calm when saved", async () => {
    const { container } = await renderWith("saved");
    expect(container.querySelector(".inkwell")?.className).not.toContain("inkwell-drip");
  });
});
```

- [ ] **Step 2: RED → implement → GREEN**

`InkwellStatus.tsx`:

```tsx
import { useSaveStatus } from "@/lib/saveStatus";

/** Чернильница в подвале рукописи: капля падает при автосейве. Чистый декор. */
export function InkwellStatus() {
  const save = useSaveStatus();
  return (
    <span
      className={`inkwell ${save.kind === "saving" ? "inkwell-drip" : ""}`}
      aria-hidden="true"
    >
      <svg width="14" height="14" viewBox="0 0 14 14">
        <path className="inkwell-body" d="M2 6 h10 v5 a2 2 0 0 1 -2 2 h-6 a2 2 0 0 1 -2 -2 Z" />
        <rect className="inkwell-neck" x="5" y="3" width="4" height="3" rx="1" />
        <circle className="inkwell-drop" cx="7" cy="9" r="1.4" />
      </svg>
    </span>
  );
}
```

CSS (атмосферная зона):

```css
/* ─── Чернильница-автосейв ───────────────────────────────── */
.inkwell { display: inline-flex; opacity: 0.7; }
.inkwell-body, .inkwell-neck { fill: var(--color-text-faint); }
.inkwell-drop { fill: var(--color-ink-blue); opacity: 0; }

@keyframes inkwell-drip {
  0%   { opacity: 0; transform: translateY(-3px); }
  40%  { opacity: 1; }
  100% { opacity: 0; transform: translateY(3px); }
}
html.atm-full .inkwell-drip .inkwell-drop,
html.atm-calm .inkwell-drip .inkwell-drop {
  animation: inkwell-drip 0.9s ease-in infinite;
}
@media (prefers-reduced-motion: reduce) {
  .inkwell-drop { animation: none !important; }
}
```

Вставить `<InkwellStatus />` в `.ms-footer` рядом с AutosaveStatus (ChapterPage).

- [ ] **Step 3: CritiquePanel → письма редактора**

В `CritiquePanel.tsx` — только классы/токены, логика нетронута:
- корневые `section.border...rounded-md.p-4` → `section.cri-card-stack` (новый класс: `display:flex; flex-direction:column; gap:10px;`) — или использовать `.cri-list` если укладывается;
- карточки замечаний → `.cri-card` идиома (`.cri-card-top`, `.cri-card-title`, `.cri-card-body`, `.cri-card-actions`) там, где структура позволяет без изменения данных;
- заменить сырые `bg-red-100/bg-yellow-100/bg-gray-100` (строки ~239-259) на токены: `var(--color-ink-red-tint)`/`var(--color-ink-amber-tint)`/`var(--color-surface-2)` с текстом `var(--color-ink-red)`/`var(--color-ink-amber)`/`var(--color-text-muted)` — через существующие `.sev-*` классы (library-warm.css ~1436), если подходят.
- Точечная адаптация разрешена; поведение (чекбоксы категорий, self-repair, тексты кнопок) не менять.

- [ ] **Step 4: Полный прогон + коммит**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test` → PASS.

```bash
git add apps/web/src/components/CritiquePanel.tsx apps/web/src/components/atmosphere apps/web/src/pages/ChapterPage.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): editor-letters critique styling + inkwell autosave drip"
```

---

### Task 5: Финал — гейт + доки

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1:** `pnpm typecheck && pnpm test` (весь репо) → PASS.
- [ ] **Step 2:** CLAUDE.md, после строки про Библиотеку:

```markdown
Комната «Кабинет» (phase 2): ChapterPage — 3-колоночный `.chapter-grid` (OutlineRail · `.ms-paper` рукопись · cri-rail с критикой и материалами); живой статус сохранения в StatusBar через [saveStatus.ts](apps/web/src/lib/saveStatus.ts), чернильница-автосейв в подвале рукописи.
```

- [ ] **Step 3:**

```bash
git add CLAUDE.md
git commit -m "docs: Study room notes in CLAUDE.md"
```

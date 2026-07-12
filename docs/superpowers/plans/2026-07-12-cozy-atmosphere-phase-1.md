# Cozy Writer's Den — Phase 1 «Атмосфера» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Атмосферный слой «ночного кабинета» поверх Library Warm: палитра «Чернильная ночь», свет лампы/виньетка/текстуры, переходы-перелистывания, фокус-режим, свеча дневной цели слов, пылинки и кот.

**Architecture:** Всё — presentational-слой поверх существующего shell (`.app`/`.topbar`/`.leftrail`). Управление атмосферой — модульный store (`useSyncExternalStore`) + класс `atm-*` на `<html>`; CSS-эффекты гейтятся этими классами. Единственная серверная работа — леджер `writing_days` (миграция 0015) + endpoint `GET /api/writing-progress`; дельта пишется в существующем draft-хендлере.

**Tech Stack:** React 18, react-router-dom ^7 (View Transitions), Tailwind v4 (токены в `@theme static` + plain `:root`), Hono + better-sqlite3, vitest + RTL (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-12-cozy-writers-den-design.md`

## Global Constraints

- TypeScript strict + `noUncheckedIndexedAccess`; ESM only; ноль новых npm-зависимостей.
- Имена цветовых токенов НЕ меняются — только значения, синхронно в ДВУХ файлах: `apps/web/src/index.css` (`@theme static`) и `apps/web/src/styles/library-warm.css` (`:root`).
- Классы атмосферы на `<html>`: `atm-full | atm-calm | atm-off`; localStorage-ключ `bf-atmosphere`; дефолт `full`; `prefers-reduced-motion: reduce` заставляет `full` вести себя как `calm`.
- `atm-off` = вид приложения до этапа 1 (кроме палитры): все атмосферные слои и анимации отключены.
- Декоративные элементы: `aria-hidden="true"` (или `aria-label` для кликабельных), `pointer-events: none` для оверлеев; тексты/роли существующих страниц не менять (тесты завязаны на текст).
- Миграции — hand-written SQL через `pnpm --filter @book-forge/server drizzle:new <name>`; `drizzle:generate` ЗАПРЕЩЁН (снапшоты сломаны с 0008). См. `docs/migrations.md`.
- Коммит в конце каждой задачи. Прогоны: `pnpm typecheck`, `pnpm --filter @book-forge/web test`, `pnpm --filter @book-forge/server test`.

---

### Task 1: Палитра «Чернильная ночь»

**Files:**
- Modify: `apps/web/src/index.css` (блок `@theme static`, строки ~14-68)
- Modify: `apps/web/src/styles/library-warm.css` (блок `:root`, строки ~13-81)

**Interfaces:**
- Produces: новые значения существующих токенов `--color-*`. Радиусы, шрифты, shadow/motion-токены не трогать.

- [ ] **Step 1: Замена значений в обоих файлах**

Полная таблица замен (применить в `@theme static` **и** в `:root` — имена токенов идентичны):

| Токен | Новое значение |
|---|---|
| `--color-bg` | `#131722` |
| `--color-surface-1` | `#1A2030` |
| `--color-surface-2` | `#212A3D` |
| `--color-surface-3` | `#2A3550` |
| `--color-border` | `#303B55` |
| `--color-border-soft` | `#252E45` |
| `--color-border-strong` | `#43507A` |
| `--color-text` | `#E4E1D4` |
| `--color-text-strong` | `#F5F2E6` |
| `--color-text-muted` | `#8B93A8` |
| `--color-text-faint` | `#5F6880` |
| `--color-brass` | `#D9A44A` |
| `--color-brass-soft` | `#B58734` |
| `--color-brass-hi` | `#E8B65C` |
| `--color-ink-red` | `#C4564A` |
| `--color-ink-green` | `#6E9463` |
| `--color-ink-blue` | `#6C8FBF` |
| `--color-ink-amber` | `#CDA24E` |
| `--color-paper` | `#212A3D` |
| `--color-margin-rule` | `#43507A` |
| `--color-overlay` | `rgba(7, 9, 15, 0.72)` |
| `--color-brass-glow` | `rgba(217, 164, 74, 0.18)` |
| `--color-brass-tint` | `rgba(217, 164, 74, 0.10)` |
| `--color-ink-red-tint` | `rgba(196, 86, 74, 0.12)` |
| `--color-ink-green-tint` | `rgba(110, 148, 99, 0.12)` |
| `--color-ink-blue-tint` | `rgba(108, 143, 191, 0.14)` |
| `--color-ink-amber-tint` | `rgba(205, 162, 78, 0.12)` |
| `--color-background` | `#131722` |
| `--color-foreground` | `#E4E1D4` |
| `--color-primary` | `#D9A44A` |
| `--color-primary-foreground` | `#131722` |
| `--color-secondary` | `#212A3D` |
| `--color-secondary-foreground` | `#E4E1D4` |
| `--color-muted` | `#1A2030` |
| `--color-muted-foreground` | `#8B93A8` |
| `--color-accent` | `#2A3550` |
| `--color-accent-foreground` | `#F5F2E6` |
| `--color-destructive` | `#C4564A` |
| `--color-destructive-foreground` | `#F5F2E6` |
| `--color-input` | `#303B55` |
| `--color-ring` | `#D9A44A` |

Внимание: в `library-warm.css` `:root` строки идут в другом порядке и содержат tint-токены рядом с основными — заменять по имени токена, не по позиции. После замены `grep -n "1A1410\|221A14\|2B2118\|342719\|3A2D22\|D49A4E" apps/web/src` должен вернуть 0 совпадений в обоих CSS-файлах (старые значения могут легитимно остаться только в `book_redisign/` — референс не трогать).

- [ ] **Step 2: Проверка**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS (палитра не влияет на тесты — они завязаны на текст/роли).

- [ ] **Step 3: Визуальная проверка**

Run: `pnpm dev`, открыть `http://localhost:5173/books`. Ожидание: сине-чернильный фон, золотые акценты, читаемый текст на всех страницах (`/books`, studio, usage, style-profiles). Проверить контраст чипов/пиллов.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/index.css apps/web/src/styles/library-warm.css
git commit -m "feat(web): Ink Night palette — retoken Library Warm to blue-ink + candle gold"
```

---

### Task 2: Атмосферный store + лампа-переключатель в TopBar

**Files:**
- Create: `apps/web/src/lib/useAtmosphere.ts`
- Test: `apps/web/src/lib/__tests__/useAtmosphere.test.ts`
- Modify: `apps/web/src/components/shell/AppShell.tsx` (TopBar `.topbar-right` + init-эффект в `AppShell`)
- Modify: `apps/web/src/styles/library-warm.css` (стили `.topbar-lamp`)

**Interfaces:**
- Produces: `type AtmosphereMode = "full" | "calm" | "off"`; `useAtmosphere(): AtmosphereMode`; `setAtmosphere(m: AtmosphereMode): void`; `cycleAtmosphere(): void`; `applyAtmosphereClass(): void`; `effectiveMode(m?: AtmosphereMode): AtmosphereMode`. Классы `atm-*` на `document.documentElement`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/__tests__/useAtmosphere.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return await import("../useAtmosphere");
}

describe("useAtmosphere store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("defaults to full and applies atm-full class", async () => {
    const m = await freshModule();
    expect(m.getAtmosphere()).toBe("full");
    m.applyAtmosphereClass();
    expect(document.documentElement.classList.contains("atm-full")).toBe(true);
  });

  it("persists mode to localStorage and swaps html class", async () => {
    const m = await freshModule();
    m.setAtmosphere("calm");
    expect(localStorage.getItem("bf-atmosphere")).toBe("calm");
    expect(document.documentElement.classList.contains("atm-calm")).toBe(true);
    expect(document.documentElement.classList.contains("atm-full")).toBe(false);
  });

  it("restores persisted mode on module init", async () => {
    localStorage.setItem("bf-atmosphere", "off");
    const m = await freshModule();
    expect(m.getAtmosphere()).toBe("off");
  });

  it("cycles full -> calm -> off -> full", async () => {
    const m = await freshModule();
    m.cycleAtmosphere();
    expect(m.getAtmosphere()).toBe("calm");
    m.cycleAtmosphere();
    expect(m.getAtmosphere()).toBe("off");
    m.cycleAtmosphere();
    expect(m.getAtmosphere()).toBe("full");
  });

  it("effectiveMode degrades full to calm under prefers-reduced-motion", async () => {
    const m = await freshModule();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(m.effectiveMode("full")).toBe("calm");
    expect(m.effectiveMode("off")).toBe("off");
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/useAtmosphere.test.ts`
Expected: FAIL — `Cannot find module '../useAtmosphere'`.

- [ ] **Step 3: Write implementation**

`apps/web/src/lib/useAtmosphere.ts`:

```ts
import { useSyncExternalStore } from "react";

/** Атмосфера «кабинета»: full — всё, calm — свет/текстуры без анимаций, off — чистый UI. */
export type AtmosphereMode = "full" | "calm" | "off";

const STORAGE_KEY = "bf-atmosphere";
const CYCLE: AtmosphereMode[] = ["full", "calm", "off"];

function readInitial(): AtmosphereMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "full" || raw === "calm" || raw === "off") return raw;
  } catch {
    /* приватный режим/недоступный storage — дефолт */
  }
  return "full";
}

let mode: AtmosphereMode = readInitial();
const listeners = new Set<() => void>();

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Режим с учётом системного reduce: full деградирует до calm. */
export function effectiveMode(m: AtmosphereMode = mode): AtmosphereMode {
  return m === "full" && reducedMotion() ? "calm" : m;
}

export function applyAtmosphereClass(): void {
  const el = document.documentElement;
  el.classList.remove("atm-full", "atm-calm", "atm-off");
  el.classList.add(`atm-${effectiveMode()}`);
}

export function getAtmosphere(): AtmosphereMode {
  return mode;
}

export function setAtmosphere(next: AtmosphereMode): void {
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  applyAtmosphereClass();
  listeners.forEach((l) => l());
}

export function cycleAtmosphere(): void {
  const i = CYCLE.indexOf(mode);
  setAtmosphere(CYCLE[(i + 1) % CYCLE.length] ?? "full");
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAtmosphere(): AtmosphereMode {
  return useSyncExternalStore(subscribe, getAtmosphere, () => "off" as const);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/useAtmosphere.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Лампа в TopBar + init**

В `apps/web/src/components/shell/AppShell.tsx`:

1. Импорты: добавить `Lamp` в импорт из `lucide-react`; добавить
   `import { applyAtmosphereClass, cycleAtmosphere, useAtmosphere, type AtmosphereMode } from "@/lib/useAtmosphere";`
   (сверить алиас: если в проекте используются относительные импорты — `../../lib/useAtmosphere`).
2. В компоненте `AppShell` добавить init-эффект:

```tsx
useEffect(() => {
  applyAtmosphereClass();
}, []);
```

3. В `TopBar`, в `<div className="topbar-right">` ПЕРЕД кнопкой `.avatar` вставить:

```tsx
<AtmosphereLamp />
```

4. Внизу файла (рядом со `StatusBar`) добавить компонент:

```tsx
/* ─── AtmosphereLamp ────────────────────────────────────── */

const ATM_TITLE: Record<AtmosphereMode, string> = {
  full: "Атмосфера: полная",
  calm: "Атмосфера: спокойная",
  off: "Атмосфера: выкл",
};

function AtmosphereLamp() {
  const mode = useAtmosphere();
  return (
    <button
      type="button"
      className={`topbar-lamp ${mode !== "off" ? "topbar-lamp-on" : ""}`}
      onClick={cycleAtmosphere}
      aria-label={ATM_TITLE[mode]}
      title={`${ATM_TITLE[mode]} · клик переключает`}
    >
      <Lamp size={15} aria-hidden="true" />
    </button>
  );
}
```

5. В `apps/web/src/styles/library-warm.css`, в секцию TopBar (после `.topbar-link`, ~строка 660):

```css
.topbar-lamp {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  border-radius: var(--radius-control);
  color: var(--color-text-faint);
  transition: color var(--motion-2) var(--ease-in-out);
}
.topbar-lamp:hover { color: var(--color-text-muted); }
.topbar-lamp-on { color: var(--color-brass); }
.topbar-lamp-on:hover { color: var(--color-brass-hi); }
```

- [ ] **Step 6: Полный прогон**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS. Существующие тесты страниц не рендерят AppShell — не задеты.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/useAtmosphere.ts apps/web/src/lib/__tests__/useAtmosphere.test.ts apps/web/src/components/shell/AppShell.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): atmosphere store (full/calm/off) + lamp toggle in TopBar"
```

---

### Task 3: Свет лампы, виньетка, текстура панелей (CSS-only)

**Files:**
- Modify: `apps/web/src/styles/library-warm.css` (новая секция в конце файла, ПЕРЕД секцией legacy aliases)

**Interfaces:**
- Consumes: классы `atm-full`/`atm-calm` на `<html>` (Task 2).
- Produces: токены `--glow-lamp`, `--vignette`, `--texture-panel`; слои `.app::before/::after`.

- [ ] **Step 1: Добавить CSS-секцию**

```css
/* ─── Atmosphere: свет лампы, виньетка, текстура ─────────── */

:root {
  --glow-lamp: radial-gradient(
    ellipse 900px 620px at 38% 0%,
    rgba(217, 164, 74, 0.10),
    transparent 70%
  );
  --vignette: radial-gradient(
    ellipse 130% 120% at 50% 45%,
    transparent 62%,
    rgba(7, 9, 15, 0.42) 100%
  );
  /* едва заметные горизонтальные волокна панелей */
  --texture-panel: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Cg fill='%23E8B65C' fill-opacity='0.022'%3E%3Cpath d='M0 71h72v1H0zM0 35h72v1H0z'/%3E%3C/g%3E%3C/svg%3E");
}

/* Тёплое пятно света + виньетка. pointer-events: none — клики проходят.
   z-index 5: поверх статичного контента, ниже topbar (30) и модалок. */
html.atm-full .app::before,
html.atm-calm .app::before {
  content: "";
  position: fixed;
  inset: 0;
  background: var(--glow-lamp);
  pointer-events: none;
  z-index: 5;
}
html.atm-full .app::after,
html.atm-calm .app::after {
  content: "";
  position: fixed;
  inset: 0;
  background: var(--vignette);
  pointer-events: none;
  z-index: 5;
}

html.atm-full .leftrail,
html.atm-calm .leftrail,
html.atm-full .topbar,
html.atm-calm .topbar {
  background-image: var(--texture-panel);
}
```

- [ ] **Step 2: Проверка**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

Run: `pnpm dev` → на `/books` виден тёплый градиент сверху-слева и мягкое затемнение углов; клик по лампе в TopBar: `off` убирает оба слоя; текстура панелей видна при увеличении яркости.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/library-warm.css
git commit -m "feat(web): lamp glow + vignette + panel texture, gated by atm-* classes"
```

---

### Task 4: Переходы-перелистывания (View Transitions API)

**Files:**
- Modify: `apps/web/src/components/shell/AppShell.tsx` (пропы `viewTransition` на Link)
- Modify: `apps/web/src/styles/library-warm.css` (анимации `::view-transition-*`)

**Interfaces:**
- Consumes: `atm-off` класс (Task 2). react-router-dom ^7: проп `viewTransition` на `<Link>` оборачивает навигацию в `document.startViewTransition` (в браузерах без поддержки — обычная навигация, проп безопасен).

- [ ] **Step 1: Пропы на Link**

В `AppShell.tsx` добавить проп `viewTransition` всем `<Link>`: brand-Link (`to="/books"`), два Link в `.topbar-right` (`/style-profiles`, `/usage`), Link в `.leftrail-nav` map и Link в `.leftrail-foot`. Пример:

```tsx
<Link key={it.id} to={it.to} viewTransition
  className={`leftrail-item ${it.active ? "leftrail-item-active" : ""}`}
  ...
```

- [ ] **Step 2: CSS анимаций**

В `library-warm.css`, в атмосферную секцию (после текстуры панелей):

```css
/* ─── Перелистывание страниц (View Transitions) ─────────── */

@keyframes page-out {
  to { opacity: 0; transform: translateY(-10px); }
}
@keyframes page-in {
  from { opacity: 0; transform: translateY(14px); }
}

::view-transition-old(root) {
  animation: page-out 0.22s var(--ease-in-out) both;
}
::view-transition-new(root) {
  animation: page-in 0.26s var(--ease-in-out) both;
}

html.atm-off::view-transition-old(root),
html.atm-off::view-transition-new(root) {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
  }
}
```

- [ ] **Step 3: Проверка**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS (в jsdom `startViewTransition` отсутствует — RRD делает обычную навигацию).

Run: `pnpm dev` → переходы Книги↔Usage мягко «перелистываются» (Chrome/Edge); при `atm-off` — мгновенно.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/shell/AppShell.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): page-turn view transitions on shell navigation"
```

---

### Task 5: Фокус-режим (комната гаснет, остаётся рукопись)

CSS-механика уже в референсе: `.app[data-focus="true"]` (library-warm.css:594) схлопывает grid до одного контента. Задача — включатель.

**Files:**
- Create: `apps/web/src/lib/focusMode.ts`
- Test: `apps/web/src/lib/__tests__/focusMode.test.ts`
- Create: `apps/web/src/components/atmosphere/FocusToggle.tsx`
- Modify: `apps/web/src/components/shell/AppShell.tsx` (`data-focus` из store + Esc)
- Modify: `apps/web/src/pages/ChapterPage.tsx` (кнопка `<FocusToggle />` + сброс при unmount)
- Modify: `apps/web/src/styles/library-warm.css` (spotlight + стиль кнопки)

**Interfaces:**
- Produces: `useFocusMode(): boolean`; `setFocus(v: boolean): void`; `toggleFocus(): void`; компонент `FocusToggle` (кнопка + hotkey Ctrl+Shift+F).

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/__tests__/focusMode.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return await import("../focusMode");
}

describe("focusMode store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("starts unfocused", async () => {
    const m = await freshModule();
    expect(m.isFocused()).toBe(false);
  });

  it("toggleFocus flips state and notifies subscribers", async () => {
    const m = await freshModule();
    const seen: boolean[] = [];
    const unsub = m.subscribeFocus(() => seen.push(m.isFocused()));
    m.toggleFocus();
    m.toggleFocus();
    unsub();
    expect(seen).toEqual([true, false]);
  });

  it("setFocus is idempotent — no notify on same value", async () => {
    const m = await freshModule();
    let calls = 0;
    m.subscribeFocus(() => calls++);
    m.setFocus(false);
    expect(calls).toBe(0);
    m.setFocus(true);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/focusMode.test.ts`
Expected: FAIL — `Cannot find module '../focusMode'`.

- [ ] **Step 3: Write implementation**

`apps/web/src/lib/focusMode.ts`:

```ts
import { useSyncExternalStore } from "react";

/** Фокус-режим: shell гаснет, остаётся рукопись. Живёт вне React —
    AppShell и ChapterPage подключаются к одному состоянию. */

let focused = false;
const listeners = new Set<() => void>();

export function isFocused(): boolean {
  return focused;
}

export function setFocus(v: boolean): void {
  if (focused === v) return;
  focused = v;
  listeners.forEach((l) => l());
}

export function toggleFocus(): void {
  setFocus(!focused);
}

export function subscribeFocus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFocusMode(): boolean {
  return useSyncExternalStore(subscribeFocus, isFocused, () => false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/focusMode.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: FocusToggle + подключение shell/страницы**

`apps/web/src/components/atmosphere/FocusToggle.tsx`:

```tsx
import { useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { setFocus, toggleFocus, useFocusMode } from "@/lib/focusMode";

/** Кнопка фокус-режима + hotkey Ctrl/Cmd+Shift+F. Сбрасывает фокус при unmount. */
export function FocusToggle() {
  const focused = useFocusMode();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggleFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      setFocus(false);
    };
  }, []);

  return (
    <button
      type="button"
      className="btn btn-ghost focus-toggle"
      onClick={toggleFocus}
      aria-pressed={focused}
      title={focused ? "Выйти из фокуса · Esc" : "Фокус-режим · Ctrl+Shift+F"}
    >
      {focused ? (
        <Minimize2 size={14} aria-hidden="true" />
      ) : (
        <Maximize2 size={14} aria-hidden="true" />
      )}
      <span>{focused ? "Вернуть кабинет" : "Фокус"}</span>
    </button>
  );
}
```

(Сверить существующие классы кнопок: если в library-warm.css кнопки называются иначе (`.btn` секция Button ~строка 200) — использовать реальный ghost-вариант.)

В `AppShell.tsx`:

```tsx
import { setFocus, useFocusMode } from "@/lib/focusMode";
// в AppShell():
const focused = useFocusMode();
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setFocus(false);
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);
// корневой div:
<div className="app" data-focus={focused ? "true" : "false"}>
```

В `ChapterPage.tsx`: найти в JSX редакторной секции вызов `<EditorToolbar` (~строка 710-740); непосредственно ПЕРЕД ним (или в его контейнер действий, если toolbar рендерит ряд кнопок) добавить `<FocusToggle />`; импорт — `import { FocusToggle } from "@/components/atmosphere/FocusToggle";`.

В `library-warm.css` (атмосферная секция):

```css
/* Фокус: мягкий свет над рукописью */
html.atm-full .app[data-focus="true"] .main,
html.atm-calm .app[data-focus="true"] .main {
  background:
    radial-gradient(ellipse 760px 540px at 50% 28%, rgba(217, 164, 74, 0.07), transparent 70%),
    var(--color-bg);
}
.focus-toggle span { font-size: 12px; }
```

- [ ] **Step 6: Полный прогон**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

Run: `pnpm dev` → открыть главу, кнопка «Фокус»: topbar/leftrail/statusbar исчезают (grid collapse), Esc возвращает. Уход со страницы главы сбрасывает фокус.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/focusMode.ts apps/web/src/lib/__tests__/focusMode.test.ts apps/web/src/components/atmosphere/FocusToggle.tsx apps/web/src/components/shell/AppShell.tsx apps/web/src/pages/ChapterPage.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): focus mode — shell collapses, spotlight on manuscript"
```

---

### Task 6: Сервер — леджер слов дня + endpoint

Свеча считает ТОЛЬКО ручной набор: положительные дельты `word_count` при автосейве драфта (PUT `/:id/draft`). Агентские версии не учитываются — «дневная цель писателя» про слова, написанные рукой; это осознанное упрощение MVP.

**Files:**
- Create: `apps/server/drizzle/0015_writing_days.sql` (через `drizzle:new`)
- Modify: `apps/server/src/db/schema.ts` (таблица `writingDays` — только для типов/доков)
- Create: `apps/server/src/utils/writing-progress.ts`
- Test: `apps/server/src/utils/__tests__/writing-progress.test.ts`
- Create: `apps/server/src/routes/writing-progress.ts`
- Modify: `apps/server/src/app.ts` (mount)
- Modify: `apps/server/src/routes/chapters.ts` (дельта в PUT `/:id/draft`, строки ~96-124)

**Interfaces:**
- Produces: `recordWritingDelta(sqlite, delta, day?)`, `getWritingProgress(sqlite, day?) → { date, wordsAdded }`, `localDay(d?) → "YYYY-MM-DD"`; HTTP `GET /api/writing-progress?date=YYYY-MM-DD` → `{ "date": "...", "wordsAdded": n }`.

- [ ] **Step 1: Миграция**

Run: `pnpm --filter @book-forge/server drizzle:new writing_days`
Открыть созданный `apps/server/drizzle/0015_writing_days.sql` (номер может отличаться — использовать фактический), вписать:

```sql
CREATE TABLE writing_days (
  date TEXT PRIMARY KEY,
  words_added INTEGER NOT NULL DEFAULT 0
);
```

Run: `pnpm migrate`
Expected: `applied 1 migration` (+ автобэкап в `data/backups/`).

- [ ] **Step 2: schema.ts (документация/типы)**

В `apps/server/src/db/schema.ts` рядом с другими таблицами добавить:

```ts
/** Леджер дневного набора слов (свеча-цель). Пишется из PUT /chapters/:id/draft. */
export const writingDays = sqliteTable("writing_days", {
  date: text("date").primaryKey(),
  wordsAdded: integer("words_added").notNull().default(0),
});
```

- [ ] **Step 3: Write the failing test**

`apps/server/src/utils/__tests__/writing-progress.test.ts` (паттерн тест-БД — как в соседних тестах utils; `makeTestApp` из `../../routes/__tests__/_helpers.js` даёт готовую мигрированную БД — сверить экспортируемую форму TestApp по `_helpers.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, type TestApp } from "../../routes/__tests__/_helpers.js";
import {
  getWritingProgress,
  localDay,
  recordWritingDelta,
} from "../writing-progress.js";

describe("writing-progress ledger", () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });
  afterEach(() => {
    t.close?.();
  });

  it("localDay formats YYYY-MM-DD", () => {
    expect(localDay(new Date(2026, 6, 12))).toBe("2026-07-12");
  });

  it("empty day reads as zero", () => {
    expect(getWritingProgress(t.sqlite, "2026-07-12")).toEqual({
      date: "2026-07-12",
      wordsAdded: 0,
    });
  });

  it("accumulates positive deltas within a day", () => {
    recordWritingDelta(t.sqlite, 120, "2026-07-12");
    recordWritingDelta(t.sqlite, 80, "2026-07-12");
    expect(getWritingProgress(t.sqlite, "2026-07-12").wordsAdded).toBe(200);
  });

  it("ignores zero and negative deltas", () => {
    recordWritingDelta(t.sqlite, 100, "2026-07-12");
    recordWritingDelta(t.sqlite, -40, "2026-07-12");
    recordWritingDelta(t.sqlite, 0, "2026-07-12");
    expect(getWritingProgress(t.sqlite, "2026-07-12").wordsAdded).toBe(100);
  });

  it("days are independent", () => {
    recordWritingDelta(t.sqlite, 100, "2026-07-12");
    recordWritingDelta(t.sqlite, 50, "2026-07-13");
    expect(getWritingProgress(t.sqlite, "2026-07-12").wordsAdded).toBe(100);
    expect(getWritingProgress(t.sqlite, "2026-07-13").wordsAdded).toBe(50);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/writing-progress.test.ts`
Expected: FAIL — `Cannot find module '../writing-progress.js'`.

- [ ] **Step 5: Write implementation**

`apps/server/src/utils/writing-progress.ts`:

```ts
import type { Database as DatabaseType } from "better-sqlite3";

/** Локальная дата сервера YYYY-MM-DD — граница «дня письма». */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Копит положительные дельты слов в writing_days. Ноль/минус игнорируются
    (правки-сокращения не «сжигают» свечу). Fire-and-forget семантика. */
export function recordWritingDelta(
  sqlite: DatabaseType,
  delta: number,
  day: string = localDay(),
): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  sqlite
    .prepare(
      `INSERT INTO writing_days (date, words_added) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET words_added = words_added + excluded.words_added`,
    )
    .run(day, Math.round(delta));
}

export function getWritingProgress(
  sqlite: DatabaseType,
  day: string = localDay(),
): { date: string; wordsAdded: number } {
  const row = sqlite
    .prepare(`SELECT words_added FROM writing_days WHERE date = ?`)
    .get(day) as { words_added: number } | undefined;
  return { date: day, wordsAdded: row?.words_added ?? 0 };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @book-forge/server test -- src/utils/__tests__/writing-progress.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Роут + mount + дельта в draft-хендлере**

`apps/server/src/routes/writing-progress.ts`:

```ts
import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import { getWritingProgress, localDay } from "../utils/writing-progress.js";

export function createWritingProgressRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();
  // Свеча-цель: сколько слов написано руками за день.
  r.get("/writing-progress", (c) => {
    const date = c.req.query("date") ?? localDay();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    }
    return c.json(getWritingProgress(sqlite, date));
  });
  return r;
}
```

В `apps/server/src/app.ts` — импорт + mount рядом с `createUsageRoute`:

```ts
import { createWritingProgressRoute } from "./routes/writing-progress.js";
// ...
app.route("/api", createWritingProgressRoute(sqlite));
```

В `apps/server/src/routes/chapters.ts`, хендлер `r.put("/:id/draft", ...)` (строка ~96): импорт `import { recordWritingDelta } from "../utils/writing-progress.js";` вверху файла; между `sqlite.prepare(...).run(...)` UPSERT-а драфта (строка ~122) и `return c.json(...)` (строка ~123) вставить:

```ts
    // Свеча-цель: прошлое состояние = предыдущий драфт, иначе текущая версия.
    // prevRow читаем ДО UPSERT — поэтому SELECT добавить ПЕРЕД sqlite.prepare(INSERT...):
```

Точная последовательность правки хендлера (итоговый вид тела после `const now = ...`):

```ts
    const prevDraft = sqlite
      .prepare("SELECT word_count FROM chapter_drafts WHERE chapter_id = ?")
      .get(id) as { word_count: number } | undefined;
    let prevCount = prevDraft?.word_count;
    if (prevCount === undefined && ch.current_version_id) {
      const v = sqlite
        .prepare("SELECT word_count FROM chapter_versions WHERE id = ?")
        .get(ch.current_version_id) as { word_count: number } | undefined;
      prevCount = v?.word_count;
    }
    sqlite
      .prepare(
        `INSERT INTO chapter_drafts
           (chapter_id, content_json, content_text, word_count, base_version_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(chapter_id) DO UPDATE SET
           content_json = excluded.content_json,
           content_text = excluded.content_text,
           word_count = excluded.word_count,
           base_version_id = excluded.base_version_id,
           updated_at = excluded.updated_at`,
      )
      .run(id, contentJson, contentText, wordCount, ch.current_version_id, now);
    recordWritingDelta(sqlite, wordCount - (prevCount ?? 0));
    return c.json({ chapterId: id, wordCount, updatedAt: now });
```

- [ ] **Step 8: HTTP smoke-тест endpoint'а**

Дописать в `writing-progress.test.ts`:

```ts
import { send } from "../../routes/__tests__/_helpers.js";

it("GET /api/writing-progress returns zero day and validates date", async () => {
  const res = await send(t.app, "GET", "/api/writing-progress?date=2026-07-12");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ date: "2026-07-12", wordsAdded: 0 });
  const bad = await send(t.app, "GET", "/api/writing-progress?date=nope");
  expect(bad.status).toBe(400);
});
```

(Сигнатуру `send` сверить с `_helpers.ts` — использовать так же, как в `retrieval.test.ts`.)

- [ ] **Step 9: Полный прогон**

Run: `pnpm typecheck && pnpm --filter @book-forge/server test`
Expected: PASS, включая существующие тесты chapters (draft-хендлер менялся).

- [ ] **Step 10: Commit**

```bash
git add apps/server/drizzle apps/server/src/db/schema.ts apps/server/src/utils/writing-progress.ts apps/server/src/utils/__tests__/writing-progress.test.ts apps/server/src/routes/writing-progress.ts apps/server/src/app.ts apps/server/src/routes/chapters.ts
git commit -m "feat(server): writing_days ledger + /api/writing-progress (candle goal)"
```

---

### Task 7: Свеча-цель в TopBar

**Files:**
- Create: `apps/web/src/lib/candle.ts`
- Test: `apps/web/src/lib/__tests__/candle.test.ts`
- Create: `apps/web/src/components/atmosphere/CandleGauge.tsx`
- Test: `apps/web/src/components/atmosphere/__tests__/CandleGauge.test.tsx`
- Modify: `apps/web/src/api/client.ts` (метод `getWritingProgress`)
- Modify: `apps/web/src/components/shell/AppShell.tsx` (вставка в TopBar)
- Modify: `apps/web/src/styles/library-warm.css` (стили `.candle*`)

**Interfaces:**
- Consumes: `GET /api/writing-progress` (Task 6).
- Produces: `candleLevel(words, goal): number` (0..1); `readWordGoal()/saveWordGoal(n)` (localStorage `bf-word-goal`, дефолт 500); `api.getWritingProgress(date?): Promise<{date: string; wordsAdded: number}>`; компонент `CandleGauge`.

- [ ] **Step 1: Write the failing test (логика)**

`apps/web/src/lib/__tests__/candle.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  candleLevel,
  DEFAULT_WORD_GOAL,
  readWordGoal,
  saveWordGoal,
} from "../candle";

describe("candleLevel", () => {
  it("clamps to 0..1", () => {
    expect(candleLevel(0, 500)).toBe(0);
    expect(candleLevel(250, 500)).toBe(0.5);
    expect(candleLevel(700, 500)).toBe(1);
    expect(candleLevel(-10, 500)).toBe(0);
  });
  it("guards nonsense goals", () => {
    expect(candleLevel(100, 0)).toBe(0);
    expect(candleLevel(100, -5)).toBe(0);
    expect(candleLevel(100, Number.NaN)).toBe(0);
  });
});

describe("word goal storage", () => {
  beforeEach(() => localStorage.clear());
  it("defaults to DEFAULT_WORD_GOAL", () => {
    expect(readWordGoal()).toBe(DEFAULT_WORD_GOAL);
  });
  it("persists and restores", () => {
    saveWordGoal(800);
    expect(readWordGoal()).toBe(800);
  });
  it("falls back on junk values", () => {
    localStorage.setItem("bf-word-goal", "-3");
    expect(readWordGoal()).toBe(DEFAULT_WORD_GOAL);
    localStorage.setItem("bf-word-goal", "abc");
    expect(readWordGoal()).toBe(DEFAULT_WORD_GOAL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/candle.test.ts`
Expected: FAIL — `Cannot find module '../candle'`.

- [ ] **Step 3: Write implementation (логика + api-метод)**

`apps/web/src/lib/candle.ts`:

```ts
export const DEFAULT_WORD_GOAL = 500;
const GOAL_KEY = "bf-word-goal";

/** Доля дневной цели, 0..1. Свеча тает по мере прогресса. */
export function candleLevel(words: number, goal: number): number {
  if (!Number.isFinite(words) || !Number.isFinite(goal) || goal <= 0) return 0;
  return Math.max(0, Math.min(1, words / goal));
}

export function readWordGoal(): number {
  try {
    const n = Number(localStorage.getItem(GOAL_KEY));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_WORD_GOAL;
  } catch {
    return DEFAULT_WORD_GOAL;
  }
}

export function saveWordGoal(goal: number): void {
  try {
    localStorage.setItem(GOAL_KEY, String(Math.round(goal)));
  } catch {
    /* ignore */
  }
}
```

В `apps/web/src/api/client.ts`, в объект `api` добавить метод (рядом с usage-методами):

```ts
getWritingProgress: (date?: string) =>
  req<{ date: string; wordsAdded: number }>(
    `/api/writing-progress${date ? `?date=${date}` : ""}`,
  ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/lib/__tests__/candle.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test (компонент)**

`apps/web/src/components/atmosphere/__tests__/CandleGauge.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandleGauge } from "../CandleGauge";

vi.mock("@/api/client", () => ({
  api: {
    getWritingProgress: vi
      .fn()
      .mockResolvedValue({ date: "2026-07-12", wordsAdded: 250 }),
  },
}));

describe("CandleGauge", () => {
  beforeEach(() => localStorage.clear());

  it("shows today's words and goal in accessible label", async () => {
    render(<CandleGauge />);
    const btn = await screen.findByRole("button", {
      name: /слов сегодня: 250 из 500/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("opens goal popover and saves new goal", async () => {
    const user = userEvent.setup();
    render(<CandleGauge />);
    await user.click(
      await screen.findByRole("button", { name: /слов сегодня/i }),
    );
    const input = screen.getByLabelText("Цель на день");
    await user.clear(input);
    await user.type(input, "800");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(localStorage.getItem("bf-word-goal")).toBe("800");
  });
});
```

(Если `@testing-library/user-event` не установлен в web — использовать `fireEvent` из RTL теми же шагами; новых зависимостей не добавлять.)

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/components/atmosphere/__tests__/CandleGauge.test.tsx`
Expected: FAIL — `Cannot find module '../CandleGauge'`.

- [ ] **Step 7: Write implementation (компонент + стили + вставка)**

`apps/web/src/components/atmosphere/CandleGauge.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import {
  candleLevel,
  readWordGoal,
  saveWordGoal,
} from "@/lib/candle";

/** Свеча в TopBar: воск тает по мере дневной цели слов. Клик — поповер с целью. */
export function CandleGauge() {
  const [words, setWords] = useState<number | null>(null);
  const [goal, setGoal] = useState(readWordGoal);
  const [open, setOpen] = useState(false);
  const [draftGoal, setDraftGoal] = useState(String(readWordGoal()));

  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .getWritingProgress()
        .then((p) => {
          if (alive) setWords(p.wordsAdded);
        })
        .catch(() => {
          /* сервер молчит — свеча просто не двигается */
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, []);

  const level = candleLevel(words ?? 0, goal);
  const wax = 4 + Math.round((1 - level) * 12); // 16px в начале дня → 4px огарок
  const flameY = 21 - wax - 3.2;

  const submitGoal = () => {
    const n = Number(draftGoal);
    if (Number.isFinite(n) && n > 0) {
      saveWordGoal(n);
      setGoal(Math.round(n));
    }
    setOpen(false);
  };

  return (
    <div className="candle-wrap">
      <button
        type="button"
        className="candle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Слов сегодня: ${words ?? 0} из ${goal}`}
        title={`Слов сегодня: ${words ?? "…"} / ${goal}`}
      >
        <svg width="12" height="24" viewBox="0 0 12 24" aria-hidden="true">
          <ellipse
            className="candle-flame"
            cx="6"
            cy={flameY}
            rx="2"
            ry="3.2"
          />
          <rect
            className="candle-wax"
            x="3.5"
            y={21 - wax}
            width="5"
            height={wax}
            rx="1.5"
          />
          <rect className="candle-base" x="2" y="21.5" width="8" height="1.5" rx="0.75" />
        </svg>
        <span className="candle-count mono">{words ?? "–"}</span>
      </button>
      {open && (
        <div className="candle-pop" role="dialog" aria-label="Дневная цель">
          <div className="candle-pop-row">
            <span className="strong">{words ?? 0}</span>
            <span className="faint"> / {goal} слов сегодня</span>
          </div>
          <label className="candle-pop-row candle-pop-label">
            Цель на день
            <input
              type="number"
              min={1}
              value={draftGoal}
              onChange={(e) => setDraftGoal(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-primary candle-pop-save" onClick={submitGoal}>
            Сохранить
          </button>
        </div>
      )}
    </div>
  );
}
```

(Сверить имена кнопочных классов с секцией Button в library-warm.css; выравнять `btn btn-primary` под реальные.)

В `AppShell.tsx` → `TopBar` → `.topbar-right`, ПЕРЕД `<AtmosphereLamp />`:

```tsx
<CandleGauge />
```

+ `import { CandleGauge } from "@/components/atmosphere/CandleGauge";`

В `library-warm.css` (атмосферная секция):

```css
/* ─── Свеча-цель ─────────────────────────────────────────── */

.candle-wrap { position: relative; }
.candle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 8px; border-radius: var(--radius-control);
}
.candle:hover { background: var(--color-surface-1); }
.candle-flame { fill: var(--color-brass-hi); transform-origin: center; }
.candle-wax   { fill: var(--color-text-muted); }
.candle-base  { fill: var(--color-border-strong); }
.candle-count { font-size: 11px; color: var(--color-text-muted); }

@keyframes candle-flicker {
  0%, 100% { opacity: 0.95; transform: scaleY(1); }
  46%      { opacity: 0.75; transform: scaleY(0.92); }
  52%      { opacity: 1;    transform: scaleY(1.05); }
}
html.atm-full .candle-flame {
  animation: candle-flicker 2.8s ease-in-out infinite;
}

.candle-pop {
  position: absolute; top: calc(100% + 8px); right: 0;
  min-width: 200px; padding: 12px;
  background: var(--color-surface-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-panel);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  z-index: 40;
  display: flex; flex-direction: column; gap: 8px;
}
.candle-pop-row { font-size: 12.5px; }
.candle-pop-label { display: flex; flex-direction: column; gap: 4px; color: var(--color-text-muted); }
.candle-pop-label input {
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  padding: 5px 8px; color: var(--color-text);
  font-size: 13px;
}
.candle-pop-save { align-self: flex-end; }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @book-forge/web test -- src/components/atmosphere/__tests__/CandleGauge.test.tsx src/lib/__tests__/candle.test.ts`
Expected: PASS.

- [ ] **Step 9: Полный прогон + ручная проверка**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

Run: `pnpm dev` → свеча в TopBar; печать в главе (автосейв) уменьшает воск в течение минуты/при рефокусе окна; клик — поповер, смена цели работает.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/candle.ts apps/web/src/lib/__tests__/candle.test.ts apps/web/src/components/atmosphere apps/web/src/api/client.ts apps/web/src/components/shell/AppShell.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): candle daily word-goal gauge in TopBar"
```

---

### Task 8: Живые детали — пылинки и кот

**Files:**
- Create: `apps/web/src/components/atmosphere/DustLayer.tsx`
- Create: `apps/web/src/components/atmosphere/CatCompanion.tsx`
- Test: `apps/web/src/components/atmosphere/__tests__/liveDetails.test.tsx`
- Modify: `apps/web/src/components/shell/AppShell.tsx` (условный рендер DustLayer, кот в LeftRail)
- Modify: `apps/web/src/styles/library-warm.css` (стили + keyframes)

**Interfaces:**
- Consumes: `useAtmosphere()` (Task 2), `RouteInfo.name` (`parseRoute` в AppShell).
- Produces: `shouldShowDust(mode: AtmosphereMode, routeName: string): boolean` (экспорт из DustLayer.tsx); компоненты `DustLayer`, `CatCompanion`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/atmosphere/__tests__/liveDetails.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { shouldShowDust } from "../DustLayer";
import { CatCompanion } from "../CatCompanion";

describe("shouldShowDust", () => {
  it("only in full atmosphere and never on chapter route", () => {
    expect(shouldShowDust("full", "books")).toBe(true);
    expect(shouldShowDust("full", "chapter")).toBe(false);
    expect(shouldShowDust("calm", "books")).toBe(false);
    expect(shouldShowDust("off", "books")).toBe(false);
  });
});

describe("CatCompanion", () => {
  it("stretches on poke and settles back", () => {
    vi.useFakeTimers();
    render(<CatCompanion />);
    const cat = screen.getByRole("button", { name: "Погладить кота" });
    fireEvent.click(cat);
    expect(cat.className).toContain("cat-stretch");
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(cat.className).not.toContain("cat-stretch");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @book-forge/web test -- src/components/atmosphere/__tests__/liveDetails.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write implementation**

`apps/web/src/components/atmosphere/DustLayer.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { AtmosphereMode } from "@/lib/useAtmosphere";

/** Пылинки видны только в полной атмосфере и не на странице главы
    (бережём ввод в TipTap). */
export function shouldShowDust(mode: AtmosphereMode, routeName: string): boolean {
  return mode === "full" && routeName !== "chapter";
}

const COUNT = 28;

/** Ленивая канва с пылинками в луче света. rAF-цикл, пауза при скрытой вкладке. */
export function DustLayer() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const dust = Array.from({ length: COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.4,
      vx: (Math.random() - 0.5) * 0.00012,
      vy: 0.00003 + Math.random() * 0.00008,
      ph: Math.random() * Math.PI * 2,
    }));

    let raf = 0;
    let running = true;
    const tick = (t: number) => {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of dust) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > 1.02) {
          p.y = -0.02;
          p.x = Math.random();
        }
        if (p.x > 1.02) p.x = -0.02;
        else if (p.x < -0.02) p.x = 1.02;
        const alpha = 0.1 + 0.08 * Math.sin(t / 1400 + p.ph);
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, p.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232, 182, 92, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onVisibility = () => {
      const visible = !document.hidden;
      if (visible && !running) {
        running = true;
        raf = requestAnimationFrame(tick);
      } else if (!visible) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="dust-layer" aria-hidden="true" />;
}
```

`apps/web/src/components/atmosphere/CatCompanion.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useAtmosphere } from "@/lib/useAtmosphere";

/** Кот на «подоконнике» LeftRail. Живёт только в полной атмосфере. */
export function CatCompanion() {
  const mode = useAtmosphere();
  const [stretch, setStretch] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (mode !== "full") return null;

  const poke = () => {
    setStretch(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStretch(false), 1600);
  };

  return (
    <button
      type="button"
      className={`cat ${stretch ? "cat-stretch" : ""}`}
      onClick={poke}
      aria-label="Погладить кота"
      title="Мур"
    >
      <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden="true">
        <path
          className="cat-body"
          d="M4 16 Q3 9 9 8 Q10 3 14 4 L15 2 L17 4 L20 4 L22 2 L23 4 Q26 5 26 8 Q33 9 32 13 Q31 16 27 16 Z"
        />
        <path
          className="cat-tail"
          d="M4 16 Q-1 15 1 11"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
```

В `AppShell.tsx`:

1. Импорты: `import { DustLayer, shouldShowDust } from "@/components/atmosphere/DustLayer";`, `import { CatCompanion } from "@/components/atmosphere/CatCompanion";`, плюс `useAtmosphere` уже импортирован (Task 2).
2. В `AppShell()`: `const atmosphere = useAtmosphere();` и в JSX после `<StatusBar />`:

```tsx
{shouldShowDust(atmosphere, route.name) && <DustLayer />}
```

3. В `LeftRail`, между `</nav>` и блоком `{bookId && (`:

```tsx
<CatCompanion />
```

4. В `library-warm.css` (атмосферная секция):

```css
/* ─── Живые детали ───────────────────────────────────────── */

.dust-layer {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 6;
}

.cat {
  margin-top: auto;
  align-self: center;
  padding: 6px 4px 2px;
  opacity: 0.75;
  transition: opacity var(--motion-2) var(--ease-in-out);
}
.cat:hover { opacity: 1; }
.cat-body { fill: var(--color-surface-3); }
.cat-tail { stroke: var(--color-surface-3); }

@keyframes cat-tail-sway {
  0%, 88%, 100% { transform: rotate(0deg); }
  92%           { transform: rotate(9deg); }
  96%           { transform: rotate(-4deg); }
}
html.atm-full .cat-tail {
  transform-origin: 4px 16px;
  animation: cat-tail-sway 13s ease-in-out infinite;
}
.cat-stretch svg { transform: scaleX(1.08) translateY(-1px); }
.cat svg { transition: transform 0.5s var(--ease-in-out); }
@media (prefers-reduced-motion: reduce) {
  .cat-tail { animation: none; }
}
```

Проверить, что `.leftrail` — flex-колонка (секция LeftRail ~строка 672); если нет — коту добавить обёртку с `margin-top: auto` не нужна, просто вставить перед `.leftrail-foot`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @book-forge/web test -- src/components/atmosphere/__tests__/liveDetails.test.tsx`
Expected: PASS. (jsdom: canvas `getContext` вернёт null — эффект DustLayer тихо выходит; тест компонент не рендерит, только `shouldShowDust`.)

- [ ] **Step 5: Полный прогон + ручная проверка**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test`
Expected: PASS.

Run: `pnpm dev` → пылинки плывут на `/books`, отсутствуют на странице главы и при `calm/off`; кот в LeftRail шевелит хвостом раз в ~13 с, по клику потягивается; вкладка в фоне — CPU близко к нулю (проверить в DevTools Performance).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/atmosphere apps/web/src/components/shell/AppShell.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): dust motes canvas + cat companion (atm-full only)"
```

---

### Task 9: Финальная проверка + документация

**Files:**
- Modify: `CLAUDE.md` (раздел Frontend — 2-3 строки про атмосферу)

**Interfaces:**
- Consumes: всё выше.

- [ ] **Step 1: Полный прогон репозитория**

Run: `pnpm typecheck && pnpm test`
Expected: PASS везде (web + server + packages).

- [ ] **Step 2: Ручной сквозной прогон**

Run: `pnpm dev`. Чек-лист:
- лампа циклит full→calm→off; off = чистый UI без слоёв/анимаций; перезагрузка сохраняет режим;
- переходы-перелистывания в full/calm, мгновенные в off;
- фокус-режим на главе: Ctrl+Shift+F / кнопка / Esc;
- свеча тает после автосейва набранного текста;
- пылинки только в full и не на главе; кот кликается;
- эмуляция `prefers-reduced-motion: reduce` (DevTools → Rendering) глушит все анимации.

- [ ] **Step 3: CLAUDE.md**

В раздел `## Frontend` добавить:

```markdown
Атмосфера «кабинета» (phase 1): классы `atm-full|atm-calm|atm-off` на `<html>` из [useAtmosphere](apps/web/src/lib/useAtmosphere.ts) (localStorage `bf-atmosphere`, лампа в TopBar); декор-слои в конце `library-warm.css`, гейтятся этими классами. Свеча-цель: `GET /api/writing-progress` + леджер `writing_days` (дельты пишет draft-хендлер chapters). Палитра — «Чернильная ночь» (сине-чернильный + золото), токены синхронно в `index.css @theme static` и `library-warm.css :root`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: atmosphere phase 1 notes in CLAUDE.md"
```

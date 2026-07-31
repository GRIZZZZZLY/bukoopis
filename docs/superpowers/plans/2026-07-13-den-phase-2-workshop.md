# Writer's Den Phase 2 — Room 3 «Мастерская» (Studio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studio превращается в мастерскую: этапы — инструменты на верстаке (иконки: колба/глобус/свиток/портреты/сундук/карта/стопка), карточки этапов — чертежи/кальки (blueprint-сетка), фон — верстак (atm-гейт).

**Architecture:** Точечная надстройка поверх готового порта: замена иконок в StageCard + две CSS-подсекции (чертёж-карточки — постоянные; верстак-фон — декор, atm-гейт). Логика/маршруты/тексты не меняются.

**Spec:** `docs/superpowers/specs/2026-07-12-cozy-writers-den-design.md` §5.3

## Global Constraints

- Тестовые инварианты (НЕ ломать): `nav[aria-label="Этапы книги"]` с 7 ссылками; `aria-current="step"` на активной; `Готово N/7`; `getByLabelText("Готово N из 7")`; link «Продолжить»; href-схема карточек.
- StageStepper НЕ трогаем (его глифы — статусные, не этапные).
- Ноль новых зависимостей; иконки — lucide-react (уже в проекте).
- Чертёжная сетка — постоянный стиль карточек; верстак-фон — только `html.atm-full/.atm-calm`.
- Коммит после задачи; гейт `pnpm typecheck && pnpm --filter @book-forge/web test`.

---

### Task 1: Иконки-инструменты + чертёжные карточки

**Files:**
- Modify: `apps/web/src/components/studio/StageCard.tsx` (map иконок)
- Modify: `apps/web/src/styles/library-warm.css` (атмосферная зона — новая секция «Workshop»)

- [ ] **Step 1: Иконки**

В StageCard.tsx заменить значения map'а иконок этапов (map найти в файле — текущие Feather/Map/Layers/Users/Box/ListChecks/BookOpen):

| Этап | Было | Станет (lucide) |
|---|---|---|
| concept | Feather | FlaskConical |
| world | Map | Globe |
| lore | Layers | Scroll |
| characters | Users | Users (остаётся — «портреты») |
| items | Box | Package |
| plot | ListChecks | Map |
| chapters | BookOpen | BookCopy |

Импорты lucide обновить; ничего больше в компоненте не менять.

- [ ] **Step 2: CSS «чертежи»**

В library-warm.css (атмосферная зона, после Bookshelf-секции):

```css
/* ─── Workshop (Мастерская, phase 2) ─────────────────────── */

/* Карточки-чертежи: тонкая blueprint-сетка поверх поверхности */
.stagecard {
  background-image:
    linear-gradient(var(--color-ink-blue-tint) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-ink-blue-tint) 1px, transparent 1px);
  background-size: 22px 22px;
  background-position: -1px -1px;
}
.stagecard-icon {
  border-style: dashed;
}
.stagecard-complete {
  background-image:
    linear-gradient(rgba(110, 148, 99, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(110, 148, 99, 0.06) 1px, transparent 1px);
}
```

- [ ] **Step 3: Гейт + коммит**

Run: `pnpm typecheck && pnpm --filter @book-forge/web test` → PASS (иконки тесты не ассертят).

```bash
git add apps/web/src/components/studio/StageCard.tsx apps/web/src/styles/library-warm.css
git commit -m "feat(web): workshop tools — stage icons as instruments + blueprint cards"
```

---

### Task 2: Верстак-фон + доки + финал

**Files:**
- Modify: `apps/web/src/styles/library-warm.css`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Верстак-фон (декор, atm-гейт)**

В секцию Workshop добавить:

```css
/* Верстак: горизонтальные волокна столешницы под контентом Studio */
html.atm-full .page-studio,
html.atm-calm .page-studio {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='40'%3E%3Cg fill='%23E8B65C' fill-opacity='0.016'%3E%3Cpath d='M0 12h160v2H0zM0 30h160v1H0z'/%3E%3C/g%3E%3Cg fill='%23131722' fill-opacity='0.25'%3E%3Cpath d='M0 39h160v1H0z'/%3E%3C/g%3E%3C/svg%3E");
}
```

- [ ] **Step 2: Полный гейт**

Run: `pnpm typecheck && pnpm test` → PASS (весь репо).

- [ ] **Step 3: CLAUDE.md**

После строки про Кабинет добавить:

```markdown
Комната «Мастерская» (phase 2): Studio — карточки-чертежи (blueprint-сетка на `.stagecard`), иконки этапов — инструменты (колба/глобус/свиток/портреты/сундук/карта/стопка), верстак-фон `.page-studio` под atm-гейтом.
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/library-warm.css CLAUDE.md
git commit -m "feat(web): workshop bench background + docs"
```

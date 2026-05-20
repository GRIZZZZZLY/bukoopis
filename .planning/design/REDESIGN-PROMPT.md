# BOOKOPIS — Full Redesign Prompt (Library Warm, Dark-Only)

> Paste this entire document into Claude (or any design-capable model) as a single prompt. It covers the design system, every current route, every panel, every state, and every interaction. Output target: production React + TypeScript + Tailwind v4 components matching the **current** project structure (`apps/web/src/`).

---

## 1. Mission

Redesign **BOOKOPIS** — an AI-assisted novel-writing tool — for a writer who uses it 4–8 hours per day. Goal: make daily use *physically pleasant*. Minimize friction, maximize calm focus, reward long sessions. **Dark theme only** (no light mode, no toggle). Russian UI copy preserved. Motion is quiet, purposeful, never decorative.

The product is a multi-agent pipeline (plot, writer, critique, style_extractor, summarizer, canon_fact_extractor, episodic_note_extractor, meta_summarize, reranker) wrapped in a **Studio-first UI**. A book is *forged* through a 7-stage pipeline (Концепт → Мир → Лор → Персонажи → Предметы → Сюжет → Главы), then chapters are written/critiqued/revised one by one. Backend is built — **only the frontend (`apps/web/src/`) is in scope**.

---

## 2. Current architecture you must respect

- **Studio is the only entry point.** Legacy `BookPage` was removed; `/books/:bookId` now redirects to `/books/:bookId/studio`.
- **One shared `<StageStepper>`** renders on every Studio surface (dashboard + every sub-page) with status per stage (done/current/todo/skipped), `aria-current="step"` on the active segment, accessible counter `N/7`.
- **Single source of progress** in `@book-forge/shared`: `computeStudioProgress(concept, studioState)` powers the stepper, the dashboard progress bar, and the server `GET /api/books/recommended` batch endpoint.
- **No `tailwind.config.{ts,js}`.** Tailwind v4 CSS-first: all design tokens live in `apps/web/src/index.css` inside the `@theme` block as CSS variables (`--color-*`, `--radius-*`, `--font-*`, …). The redesign **must** express its token layer there.
- **shadcn/ui is source-in-repo** under `apps/web/src/components/ui/`. Only `Button`, `ConfirmDialog` (AlertDialog), `Skeleton`/`PageSkeleton` are currently scaffolded. Copy in further primitives as needed, restyled to the system. Do **not** add a component library.
- **No new heavy runtime deps.** Motion = CSS/Tailwind transitions only. Existing libs may be relied on: `react-router-dom@7`, `lucide-react`, `@dnd-kit/*` (chapter reorder), `@tiptap/*` (editor), `better-sqlite3` server-side. Do **not** add `framer-motion`, `cmdk`, `recharts`, `react-hotkeys-hook`, etc. — implement shortcuts/animations/charts with plain React + CSS.
- **Offline-first.** No CDN. Fonts must be self-hosted under `apps/web/public/fonts/` (Cyrillic + Latin subsets, `font-display: swap`) or fall back to a system stack.
- **Russian UI only.**
- **Tests stay green; typecheck clean.** This redesign changes visual + layout + IA only — never routes, data flow, business logic, or component contracts. Tests are updated solely for unavoidable DOM/label changes, never weakened.
- **Accessibility already partially in place** — preserve and extend it: `role="alert"` errors, `role="progressbar"` with `aria-valuemin/max/now` + `aria-label`, `<nav aria-label>`, `aria-current="step"`, `aria-label` on icon-only controls, `prefers-reduced-motion` honored.

---

## 3. Design Concept — "Library Warm"

Think: an editor's mahogany desk under a brass lamp at 1 a.m. Warm dark, paper-textured manuscript zone, serif body for prose, sans for chrome, brass accents, red-ink revisions. Bookish, authorial, not retro, never skeuomorphic.

### 3.1 Color tokens (CSS variables, dark-only)

Express in `apps/web/src/index.css` inside `@theme`. Keep names short and semantic. Sample below; finalize during Phase 0.

```css
@theme {
  /* surfaces */
  --color-bg:           #1A1410;   /* app shell, espresso */
  --color-surface-1:    #221A14;   /* cards, panels */
  --color-surface-2:    #2B2118;   /* elevated, manuscript paper zone */
  --color-surface-3:    #342719;   /* hover/active raise */
  --color-overlay:      rgba(10,7,5,0.72);   /* modal/sheet scrim, backdrop-blur(16px) */

  /* borders */
  --color-border:       #3A2D22;
  --color-border-soft:  #2E241B;
  --color-border-strong:#54402F;

  /* text */
  --color-text:         #EDE4D3;
  --color-text-strong:  #FBF5E6;
  --color-text-muted:   #9C8B73;
  --color-text-faint:   #6E5F4D;

  /* accents */
  --color-brass:        #D49A4E;   /* primary accent: CTAs, focus, links, recommended stage */
  --color-brass-soft:   #B07F33;
  --color-brass-glow:   rgba(212,154,78,0.18);

  --color-ink-red:      #C44536;   /* critique edits, deletions, errors */
  --color-ink-green:    #6A8E4E;   /* additions, success */
  --color-ink-blue:     #5B7A99;   /* info, citations */
  --color-ink-amber:    #C9A24A;   /* warnings, in_progress, pending */

  /* manuscript */
  --color-paper:        #2B2118;
  --color-margin-rule:  #3A2D22;   /* hairline at left margin of paper */

  /* shadows (warm) */
  --shadow-sm:    0 1px 2px rgba(0,0,0,0.35);
  --shadow-md:    0 6px 16px rgba(0,0,0,0.45), 0 0 0 1px var(--color-border-soft);
  --shadow-lg:    0 24px 48px rgba(0,0,0,0.55), 0 0 0 1px var(--color-border-soft);
  --shadow-glow:  0 0 0 3px var(--color-brass-glow);   /* focus ring */
}
```

Paper grain: ship a small inline SVG noise as a CSS `background-image` data-URL on the manuscript surface, `opacity: 0.5; mix-blend-mode: overlay; pointer-events: none`. No external image.

**Refactor target:** the codebase currently has a few hardcoded `bg-blue-*` / `border-blue-*` highlights in studio components (StageCard recommended ring, StageStepper active segment, the dashboard «Продолжить» CTA, BooksListPage create-button outline). Replace **all** of them with `--color-brass` / `--color-brass-glow`. After redesign no raw `*-blue-*` / `*-amber-*` / `*-red-*` Tailwind classes should remain in studio components — everything via tokens.

### 3.2 Typography

| Role | Family | Size / LH | Weight | Use |
|---|---|---|---|---|
| Manuscript prose | `Lora` (or `Source Serif 4`) | 18 / 1.75 | 400 / 600 italic | chapter body |
| Chapter & page heading | `Fraunces` | 28 / 1.2 | 500, optical-size 36 | H1 titles |
| UI body | `Inter` | 14 / 1.5 | 400 / 500 | panels, lists, controls |
| UI heading | `Inter` | 20 / 1.3 | 600, tight tracking | section headings |
| Caption / meta | `Inter` | 12 / 1.4 | 500, +0.02em | labels, status |
| Mono | `JetBrains Mono` | 12 / 1.5 | 400 | tokens, ids, costs, version meta |

Self-host all four families under `apps/web/public/fonts/`. Cyrillic + Latin subsets. `font-display: swap`. `font-feature-settings: "ss01","cv05"` on Inter for sharper digits. If a font cannot be vendored, fall back to a robust system stack of the same character (e.g. `ui-serif, Georgia` for Fraunces fallback).

### 3.3 Spacing, radii, geometry

- 4-px base. Allowed: `4 8 12 16 20 24 32 40 56 72 96`.
- Radii: `6` controls, `10` cards, `14` panels/sheets, `20` page shells.
- Borders: `1px` hairline default; never thicker except `2px` brass focus.
- Page max-width: `1440`. Manuscript column: `680`. LeftRail: `60` (icon) / `260` (expanded). Inspector/Critique rail: `400`. Studio sub-pages use the existing `max-w-5xl mx-auto` / `max-w-3xl` containers — re-tune to the system rather than expanding.

### 3.4 Motion system

All transitions ≤ 240 ms. Easing: `cubic-bezier(0.22, 0.9, 0.32, 1)` for enter/exit; `cubic-bezier(0.4, 0, 0.6, 1)` for hover. No bounce. No scale > 1.02. No rotation. **No animation library** — pure CSS transitions + a handful of CSS `@keyframes`.

| Token | Duration | Use |
|---|---|---|
| `--motion-1` | 80 ms | hover color, caret |
| `--motion-2` | 160 ms | small reveals, dropdowns, tooltips |
| `--motion-3` | 200 ms | panels, sheets, page transitions, progress fill |
| `--motion-4` | 320 ms | chapter open, drop-cap fade |

Special motions (CSS-only):
- **Page turn** on chapter navigation: 320 ms `translateX(8px) → 0` + opacity fade on outgoing, incoming `translateX(-8px) → 0`. Never literal flip.
- **AI streaming**: streamed text fades in over 80 ms per chunk; caret = blinking brass underscore at insertion point.
- **Critic verdict reveal**: 200 ms `opacity 0→1` + `translateY(4px→0)`, staggered 40 ms per item via CSS `animation-delay`.
- **Drop-cap on chapter open**: serif drop-cap fades from 0 → 1 over 320 ms after first paragraph mounts.
- **Progress bar fill**: width transition `--motion-3`.
- **Loading**: skeletons pulse `opacity 0.4 ↔ 0.7` at 1.4 s; never spin.
- Honor `prefers-reduced-motion: reduce` — fall back to opacity-only, 80 ms.

---

## 4. Component Primitives

Restyle existing primitives in `apps/web/src/components/ui/` to match this concept. **Match exported APIs** (do not break consumers); replace internals.

### 4.1 Button (exists)

Variants: `primary`, `secondary`, `ghost`, `destructive` (existing) + `link`.
Sizes: `sm (28px)`, `md (32px)`, `lg (40px)`.

- `primary`: `bg: var(--color-brass)`, text `#1A1410`, hover `#E1A858`, active `#B07F33`, focus ring `var(--shadow-glow)`.
- `secondary`: `bg: var(--color-surface-2)`, border `var(--color-border)`, hover `bg: var(--color-surface-3)`.
- `ghost`: transparent, hover `bg: var(--color-surface-2)`.
- `destructive`: keep existing API; visual = transparent bg, `border: var(--color-ink-red)`, `text: var(--color-ink-red)`, hover fills.
- `link`: brass underline-on-hover, no padding.

States: `default | hover | active | focus | disabled (opacity 0.4) | loading (inline spinner, brass)`.

### 4.2 ConfirmDialog (exists, named `AlertDialog`)

Center modal, max-w 440. Title 18/600 cream, body 14 muted, footer right-aligned buttons. Destructive uses `destructive` Button. Backdrop = `var(--color-overlay)` + `backdrop-blur(16px)`. Keep existing prop API (`open/title/description/confirmText/cancelText/variant/busy/onConfirm/onCancel`).

### 4.3 Skeleton / PageSkeleton (exists)

Solid `var(--color-surface-2)` rect with subtle warm shimmer (linear-gradient sweep, 1.6 s CSS). Match target component shape exactly. Keep `label` prop semantics for SR-only text.

### 4.4 New primitives to scaffold (copy-in, restyled)

- **Card** — `bg: var(--color-surface-1)`, radius 10, padding 16/20, hover lifts to `surface-2` + `shadow-md`.
- **Sheet** (right slide-over, 480/640) — backdrop overlay + blur; CSS-transition enter 200 / exit 160; Esc closes.
- **Tabs** — underline tabs, brass animated underline (CSS-only).
- **Tooltip** — small dark pill, brass border 1 px, mono 12 px, `--motion-2`.
- **Toast** — top-right stack, brass left-border for info, `ink-red` for error, `ink-green` for success; auto-dismiss 4 s; slide-in from right (CSS). The existing `@/lib/toast` API must keep working.
- **Kbd** — small mono pill, `bg: var(--color-surface-3)`, border `--color-border`, 12 px mono, +0.02 tracking.
- **Pill / Tag** — rounded-full, 12 px caption, brass-soft border for "agent", muted border for status.
- **ProgressBar** — 2 px height, brass fill on `surface-2` track, `--motion-3` width transition. (Already used on StudioPage dashboard — generalize.)
- **Diagnostic dot** — 6 px circle in gutter: `ink-red` (issue), `ink-amber` (suggestion), `ink-blue` (note).

**Optional, Phase 4 only** (DEFER unless time allows): a **CommandPalette** (Cmd/Ctrl-K). Implement with plain React + fuzzy filter — **do not** introduce `cmdk`.

---

## 5. Global Shell (new)

Add three pieces of persistent chrome that wrap all routes inside `App.tsx`:

**TopBar** (56 px, sticky):

- Left: brass wordmark "Bookopis" in Fraunces 18, then breadcrumb derived from route (`Книги / <BookTitle> / Studio / <Stage>` or `… / Глава 4`). Use ` / ` separator in muted.
- Center: on Chapter route — chapter title (Fraunces 16, italic muted `Гл. 4 ·` prefix then bold cream title), inline-editable on click.
- Right: `Cmd-K` Kbd hint (Phase 4), Style-profile selector pill, link `Использование`, avatar dot.
- Background `var(--color-bg)`, bottom border `--color-border-soft` only after scroll > 4 px (CSS transition).

**LeftRail** (60 px icon-only nav, optional 260 px expanded):

- Items: books list, current book Studio, style profiles, usage, settings.
- Active = brass left-bar (3 px) + cream icon. Tooltips on hover. Tooltip uses `Kbd` chip if a shortcut exists.

**StatusBar** (24 px bottom, mono 12):

- Live tokens used this session · current backend (`api` / `subscription` — both come from `/api/usage`) · current agent · cost · network state.
- Hides on Chapter route in focus mode.

Route transitions: 200 ms opacity + 8 px lift via CSS keyframe on `<RouterProvider>`'s outlet container.

Keyboard (plain React listeners — no `react-hotkeys-hook`):

- `Cmd/Ctrl-K` — Command palette (Phase 4)
- `Cmd-S` — manual save (auto-save is default)
- `Cmd-/` — toggle CritiqueRail (Chapter route)
- `Cmd-\\` — toggle LeftRail
- `Cmd-Shift-F` — focus mode (hide all chrome)
- `Cmd-Enter` — run primary AI action on current selection / chapter
- `Esc` — close sheets/dialogs/palette

---

## 6. Routes — Every Screen, Every State

Routes are fixed by `apps/web/src/App.tsx` and **must not change**. For each: redesign visual + layout + IA only.

### 6.1 `/books` — BooksListPage

Header: "Ваши книги" (Fraunces 28) + muted subtitle ("12 книг · последняя правка 2 ч. назад") + `+ Новая книга` primary button right of the title.

**Grid of book cards** (3 cols ≥ 1280, 2 cols ≥ 768, 1 col mobile). Each card 320×220:

- Top: faux spine — 12 px brass gradient strip, embossed title in tiny mono.
- Body (paper surface): book title (Fraunces 22), genre/audience meta (Inter 12 muted), chapter & word count in mono.
- Bottom row: relative `updatedAt` + status pill (`черновик` ink-amber / `активна` ink-blue / `архив` muted).
- A separate **«Продолжить →»** link (existing) when the recommended-stage map has an entry for this book — render below the title, mono 12, brass underline. Already wired via `api.listRecommended()` + `stageRoute()`; degrade silently if it fails (covered by tests — don't break the fallback).
- Hover: lift `shadow-md`, brass border. Focus: brass ring. Kebab menu: переименовать, дублировать, архивировать, удалить.

**Empty state** (real, hit on first launch): centered max-w 440. Line illustration of an open book with brass bookmark. Headline "Здесь будет ваша первая книга". Muted body. Primary "Создать книгу" button.

**Loading**: 6 skeleton cards.
**Error**: card-shaped block with `ink-red` left bar, body, retry ghost.
**Create**: keep the inline title input that exists (immediate `createBook` → `navigate('/books/${id}/studio')` is already wired). If a richer "create with options" dialog is desired, route it through an optional `ConfirmDialog`-shaped composer that still posts to `api.createBook({ title })` — no schema change.

### 6.2 `/books/:bookId` — BookRedirect

No UI — just `<Navigate to=/books/:bookId/studio replace />`. Redesign nothing.

### 6.3 `/books/:bookId/studio` — StudioPage (workshop home, **highest design priority after Chapter editor**)

Single-column dashboard inside `max-w-5xl mx-auto p-8 flex flex-col gap-6`. Sections in order:

1. **Header** — `<h1>Studio</h1>` + a quick `<nav aria-label="Навигация по студии">` with two links: `⚙ Настройки` → `/studio/settings`, `📚 Главы` → `/studio/chapters`. Keep this nav (it serves different purposes than the stepper).
2. **`<StageStepper activeStageId="concept">`** — the 7-stage rail with `N/7` counter, icons (`✓` done, `▶` current, `●` todo, `↷` skipped), `aria-current="step"` on active. Restyle from current `bg-blue-50/border-blue-500` highlight to `--color-brass` / `--shadow-glow`.
3. **Progress block** — accessible progress bar (`role="progressbar"` with `aria-valuemin=0`, `aria-valuemax=7`, `aria-valuenow={doneCount}`, `aria-label="Прогресс книги"`), text «Готово N/7 · Далее: <Stage>» (or «Книга проработана» when all done), and a **«Продолжить →»** primary button linking to `stageRoute(bookId, recommended ?? 'chapters')`. Brass.
4. **WarningsFeed** — soft alert list (existing `<WarningsFeed warnings={…} />`). Each warning: severity dot (`ink-amber` / `ink-red`), title, body, optional link to the offending stage.
5. **ConceptForm** — the canonical concept editor (existing). Inline form with refine-via-LLM micro-actions per field (`protagonist`, `conflict`, `stakes`, `logline`). Treat as the hero composition: large multi-line inputs on paper surface, brass refine buttons inline, mono diagnostic meta below each field.
6. **Stage-card grid** (`grid-cols-2 md:grid-cols-4`) — existing `<StageCard>` per `STAGE_IDS`. Each card: title in Fraunces 18, status icon, sub-text "<status>" (muted), `recommended` highlight = brass border + faint brass glow. Click → `stageRoute(bookId, id)`. Restyle the card per system; keep its existing props (`stageId, label, status, recommended, href`).

States: loading = central skeleton block with stepper placeholder + progress placeholder. Error (top-level fetch fail) = `role="alert"` block as today. Bad-`bookId` guard already returns "Книга не найдена" — keep, restyle.

### 6.4 `/books/:bookId/studio/world` · `/lore` · `/plot` — MarkdownStagePage

Aspect-engine workspace for markdown stages (world / lore / plot). Layout: full stepper on top (`activeStageId={stageId}`), then `<h1>{STAGE_LABELS[stageId]}</h1>`, then the runner.

- If the stage has no aspects yet → render **`<PlaybookRunner>`**: generate a playbook of aspects (LLM). UI = big primary CTA "Сгенерировать план аспектов", an optional draft textarea, status indicators while streaming. Use brass for the CTA + shimmer top edge on the streaming state.
- Once aspects exist → render **`<AspectRunner>`**: list of aspects (sortable cards), each with generation status (pending/generating/reviewing/accepted/skipped), variants, accept/refine. Per aspect: title + small status pill + body markdown preview + actions (`Принять`, `Перегенерировать`, `Доработать`, `Пропустить`). Use `--ink-green` for accepted, `--ink-amber` for pending, `--ink-red` for issues.
- Streaming generation: card top edge shows a brass shimmer keyframe; body fills as tokens arrive (fade-in per chunk).
- Sticky footer summary: progress (X из Y аспектов приняты) + "Завершить стадию" primary (sets `stages[stageId].status = "complete"`).

States: loading studio = central skeleton; error = inline `role="alert"`; non-markdown `stageId` → existing `Navigate` back to `/studio`. Bad-`bookId` → render "Книга не найдена" via the same guard pattern used on Chapters/Settings.

### 6.5 `/books/:bookId/studio/characters` · `/items` — EntityStagePage

Same shell as MarkdownStagePage but the inner runner is **`<EntityStageRunner>`**: aspect cards whose payload is an `entity_set` (candidate entities). Each candidate card: kind icon (`characters` → person, `items` → object), proposed profile (name, traits), accept/reject/merge controls. Accepted candidates materialize into the canon `characters`/`items` tables (already wired server-side). Visualize materialized rows distinctly (mono id pill + paper-warm row).

### 6.6 `/books/:bookId/studio/chapters` — ChaptersStagePage

Layout: stepper (`activeStageId="chapters"`), `<h1>Главы</h1>`, then panels in order:

- **`<OutlinePanel book onUpdated>`** — keep as-is (book outline JSON editor); restyle into a Card with paper surface, sticky header "План книги".
- **`<KnowledgePanel bookId>`** — knowledge / canon viewer. Cards similar to a fact list (subject bold, predicate muted, object). Filter chips by entity type. Read-only or edit-on-click per the panel's existing API.
- **`<ImportExportPanel bookId onImported>`** — two columns: import drop-zone (brass dashed border on drag-over) with supported-formats list (`txt md docx fb2`); export with format radios + options (include critique notes / canon / plan).
- **`<SearchPanel bookId>`** — hybrid corpus search. Field + facets + result list with chapter→excerpt cards; clicking a result deep-links to `/books/:bookId/chapters/:chapterId`.
- **Chapter list** (existing): heading "Список глав" + add-form (`+ Новая глава`) + dnd-reorder list (`@dnd-kit`). Each row: grip handle (`GripVertical`), `#${orderIndex}` mono, chapter title, status pill, link to `/books/:bookId/chapters/:id`. Optimistic reorder via `api.updateChapter(id, { orderIndex })`. Toast on success/failure. Restyle to a paper-warm row with brass left-bar on hover and a 1 px hairline divider between rows.

Keep all current behaviour: `Number.isFinite(bookId)` guard first ("Книга не найдена"), then error, then skeleton, then content.

### 6.7 `/books/:bookId/studio/settings` — SettingsStagePage

Layout: `<StageStepper>` (no `activeStageId` — settings is not a stage; segments still clickable) + a kept `← к Studio` Link, then `<h1>Настройки</h1>`.

Sections:

- Identity — title (inline editable, large Fraunces input), status select (`черновик / активна / архив`), style-profile select.
- Models — three selects (writer / plot / critic — `sonnet` / `opus`). Show the running per-chapter cost estimate via existing `estimatePerChapterUsd` in `apps/web/src/lib/chapter-cost.ts`. Use mono digits.
- Provider — radio group `anthropic` / `ollama`; if `ollama`, reveal a local-model tag input. Keep the existing copy explaining Plot/Critic remain on cloud models.
- Danger zone — `Удалить книгу` destructive Button → existing `ConfirmDialog` flow (`navigate('/books')` on success). The dialog gets a Library-Warm restyle.

**Hard preserve:** the form must NOT submit a `premise` field to `api.updateBook` (the legacy column is intentionally dead — covered by a test that asserts `"premise" in arg === false`). Don't reintroduce a "Замысел" textarea.

### 6.8 `/books/:bookId/chapters/:chapterId` — ChapterPage (manuscript)

**The most-used screen. Make it the calmest screen.**

Layout: **OutlineRail (left, 240, collapsible)** | **Manuscript (center, fluid, max content width 680)** | **CritiqueRail (right, 400, collapsible)**. Both rails collapse with `Cmd-\\` / `Cmd-/`. Focus mode (`Cmd-Shift-F`) hides both rails + TopBar; manuscript centers, StatusBar dims.

**Manuscript area**:

- Background `var(--color-paper)` + SVG paper-grain overlay at `opacity: 0.5; mix-blend-mode: overlay; pointer-events: none`.
- 1 px hairline left margin rule (`var(--color-margin-rule)`).
- Chapter title block: italic muted "Глава 4" + Fraunces 32 title (inline-editable, brass caret on edit).
- First paragraph: drop-cap (Fraunces 56, brass, line-height 0.9, float-left margin 6/8) — fades in on first mount via `--motion-4`.
- Body: Lora 18 / 1.75, color `var(--color-text)`. Paragraph spacing 16. No indent.
- Selection highlight: `rgba(212,154,78,0.15)`.
- Word/character/token counter discreet bottom-left of manuscript (mono 12, faint).
- **InlineCommandPanel**: brass pill above selection (existing) → expanded action menu (Переписать · Сократить · Развернуть · Перевести · Своя инструкция…). Popover with text input + run.
- **AI streaming** into manuscript: brass underscore caret; streamed text fades in 80 ms per chunk; Esc pauses (dashed underline on streamed range until accepted).
- **VersionDiff overlay** (existing): additions get `--color-ink-green` underline + soft tint, deletions get `--color-ink-red` strike + soft tint. Floating toolbar at top: `Принять всё` brass, `Отклонить всё` ghost, `Принять выбранное`, `Показать только изменения`. Per-hunk inline `✓`/`✕` chips on hover.

**OutlineRail (left)**: compact chapter list; current chapter highlighted with brass left-bar; mini word-count bars under each. Footer: `Cmd-P` jump-to-chapter mini search.

**CritiqueRail (right)** — **`<CritiquePanel>`** (existing):

- Sticky header — critic verdict dots (logic/prose/canon) coloured by verdict.
- Tabs — `Все · Сюжет · Стиль · Канон · Факты`.
- Verdict cards — severity dot, title, agent badge (mono pill with agent name e.g. `style_extractor`), excerpt, `Перейти` link that scrolls and flashes the cited passage. Actions: `Применить правку`, `Игнорировать`, `Создать задачу`.
- Streaming: brass shimmer top edge on receiving cards.
- Footer — `Запросить новый разбор` brass + agent picker dropdown.

**Top back-link** "← К главам" → `/books/:bookId/studio/chapters` (already wired). Keep the wording.

**SearchPanel** invoked by `Cmd-F`: slides down from TopBar (48 px). Field, prev/next, count, regex toggle, replace. Matches highlighted brass inline.

**States** explicitly: loading, empty chapter ("Начните писать…" placeholder + hint card "`Cmd-Enter` — попросить ИИ начать главу"), saving ("Сохранено · только что" / "Сохранение…" in StatusBar), conflict (`ink-amber` ribbon, merge/discard/reload), streaming long (StatusBar progress + cancel), offline (muted ribbon).

### 6.9 `/style-profiles` — StyleProfilesListPage

Header: "Профили стиля" + `+ Новый профиль`.

Grid of profile cards (book-card sized). Each card:

- Top: brass-line **trait chart** (mini parallel-bar) on 6 axes (тон, темп, лексика, образность, диалоги, ритм). Draw on mount via CSS `stroke-dashoffset` keyframe (no chart lib).
- Title (Fraunces 22), source meta ("извлечён из «<Book>», гл. 1–3"), chip list of source chapters.
- Bottom: usage count ("используется в N книгах").

Empty: "Профили стиля помогают модели писать в едином голосе. Извлеките из готового текста или создайте вручную." + primary CTA.

### 6.10 `/style-profiles/:profileId` — StyleProfilePage

Two-column: **Profile editor (left, fluid)** | **Source samples (right, 360)**.

- Editor: name, description, full-size trait chart (CSS/SVG drawn by hand, brass strokes on `surface-2`), 6 trait sliders below (0–100 mono value), example phrases editor (multi-line, paper surface), forbidden constructs list.
- Source samples: list of source-chapter excerpts (italic, paper surface, citation link) + `Переизвлечь` brass button at top.
- Footer: `Сохранить` primary, `Удалить` destructive ghost.

### 6.11 `/usage` — UsagePage

Header + range picker (today / 7д / 30д / custom) + backend filter pill (`api` / `subscription` — both real routes per `STRUCTURED_AGENT_NAMES` split).

Three stat cards in a row: total tokens, total cost, sessions. Mono digits; Δ vs previous period in `ink-green`/`ink-red`.

Below: two **custom-built** charts side by side — *Tokens by agent* (horizontal bar) and *Cost over time* (line). Hand-rolled SVG + CSS; **no `recharts`**. Bars grow from left 320 ms; line draws via `stroke-dashoffset` 320 ms. Tooltips via the new Tooltip primitive.

Detailed table: datetime, agent, backend, model, input tokens, output tokens, cost, status. Mono numerics. Sortable. Sticky header. Row hover paper-warm.

Empty state when no usage: muted centered hint.

### 6.12 `*` — Not found

Centered max-w 440. Fraunces 28 "Страница потерялась". Body "Возможно, её перенесли в другую главу." Primary `На главную`. Small brass bookmark illustration.

---

## 7. Cross-cutting states

For every page, design and implement explicitly:

| State | Treatment |
|---|---|
| Loading | Skeletons matching final layout; no spinners except inline-in-buttons. |
| Empty | Quiet illustration + headline + body + 1 primary action. |
| Error (recoverable) | Inline `ink-red` left-bar block, retry ghost button, mono error code small. |
| Error (page-level) | `ErrorBoundary` fallback: centered card, "Что-то сломалось", reload button, expandable details (mono, scrollable). |
| Streaming AI | Brass shimmer top edge on receiving card; per-token fade-in; cancel control; StatusBar progress. |
| Optimistic action | Apply immediately, show Toast with `Отменить` (5 s window). |
| Destructive | `ConfirmDialog` with destructive Button; require typing book/chapter title for irreversible deletes. |
| Offline | Muted top ribbon + "записи копятся локально" indicator in StatusBar. |
| Conflict | `ink-amber` ribbon with merge/discard/reload. |
| Bad URL (`!Number.isFinite(bookId)`) | Existing "Книга не найдена" `role="alert"` block — restyle, don't remove. |

---

## 8. Accessibility (preserve + raise)

- Contrast: body text ≥ 4.5:1 against every surface; `--color-text-muted` ≥ 4.5:1 against `--color-bg` (verify and nudge if not).
- Focus rings: brass 2 px + 3 px brass-soft glow on every interactive element. Never `outline: none` without replacement.
- Keyboard: every action reachable; visible focus order matches DOM.
- ARIA: dialogs with `role="dialog"` + `aria-modal`, sheets with `aria-labelledby`, live region for AI streaming + Toast announcements. Preserve existing `aria-current="step"` on StageStepper, `role="progressbar"` with name + value on the dashboard.
- Hit targets ≥ 32 px (40 px on touch).
- `prefers-reduced-motion` honored everywhere.
- Screen-reader-only labels for icon-only buttons (already present on the drag handle, the kebab menus, etc.).

---

## 9. Implementation notes (must follow)

- Stack: React 18, react-router-dom@7, Tailwind v4 CSS-first, TypeScript strict (`noUncheckedIndexedAccess`). **Do NOT add `framer-motion`, `cmdk`, `recharts`, `react-hotkeys-hook`, Radix, or any UI library.** Motion = pure CSS. Charts = hand-rolled SVG. Shortcuts = a small custom `useHotkey` hook (React + `keydown` listener).
- Tokens live in `apps/web/src/index.css` `@theme` only. **There is no `tailwind.config.{ts,js}` — do not create one.** All `bg-*` / `text-*` / `border-*` classes you use must reference token variables (e.g. `bg-[var(--color-brass)]`) or Tailwind's @theme-driven utilities.
- Self-host fonts under `apps/web/public/fonts/`; subset Cyrillic + Latin; `font-display: swap`. Provide system-stack fallbacks per family.
- File structure: keep existing module names and exported APIs. Refactor internals. Co-locate optional `*.stories.tsx` examples for visual review (do not introduce Storybook as a dep — just plain `.tsx` files mountable from a dev-only route).
- Persist user prefs (rail collapse, focus mode, inspector tab, theme has no toggle — but rail/focus state yes) in `localStorage`.
- All copy in Russian.
- The only allowed new utility code: `useHotkey`, a small `cn()` classnames helper if not already present, and per-page `*.test.tsx` updates when DOM/labels shift.

---

## 10. Deliverables

For each route and panel in §6, produce:

1. **Final React component** (TS, Tailwind v4 + CSS-var tokens), wired to the existing data hooks in `apps/web/src/api/` and the existing components. If a hook is missing, stub it with `// TODO: connect to <existing-source>` and a typed interface — never invent business logic.
2. **All states** rendered via prop or local-story file: `default · loading · empty · error · streaming · disabled · offline · conflict` where applicable.
3. **Keyboard shortcuts** wired and discoverable (Command Palette is Phase 4 — until then list them in a help dialog).
4. **Restyled primitives** in `components/ui/` matching §4.
5. **Updated `apps/web/src/index.css` `@theme` block** with the full token system from §3.
6. **A motion-tokens stylesheet** (e.g. `apps/web/src/styles/motion.css`) defining `--motion-1..4`, keyframes (`shimmer`, `page-turn`, `drop-cap`, `stagger`), and `@media (prefers-reduced-motion: reduce)` overrides.
7. **One global stylesheet** (`apps/web/src/styles/library-warm.css`) defining the paper-grain SVG background and base typography.

Match these **existing** component contracts — do not break their public props:
`Button`, `ConfirmDialog` (AlertDialog), `Skeleton`, `PageSkeleton`, `StageStepper`, `StageCard`, `WarningsFeed`, `ConceptForm`, `OutlinePanel`, `KnowledgePanel`, `ImportExportPanel`, `SearchPanel`, `PlaybookRunner`, `AspectRunner`, `EntityStageRunner`, `CritiquePanel`, `InlineCommandPanel`, `VersionDiff`, `BookRedirect`.

**Components that were removed** and must NOT be reintroduced: `BookPage` (legacy), `PlanPanel` (replaced by MarkdownStagePage `plot`), `CanonPanel` (replaced by EntityStagePage `characters`/`items` + KnowledgePanel).

---

## 11. Quality bar

Before considering any screen done:

- [ ] Looks calm at 2 a.m. on an OLED display — no glow, no eye strain.
- [ ] First paint < 200 ms (skeletons appear instantly; real content fades in).
- [ ] Every interactive element has hover + focus + active feedback.
- [ ] Every async action has loading + success + error path designed.
- [ ] Keyboard-only flow completes the screen's main task end-to-end.
- [ ] Manuscript reading is comfortable for 2 hours straight (read-test it).
- [ ] Animations fade gracefully under `prefers-reduced-motion`.
- [ ] Russian copy is natural — never translated-from-English-feeling.
- [ ] Nothing scales > 1.02 on hover; nothing bounces; nothing strobes.
- [ ] `pnpm typecheck` clean across all 7 packages. `pnpm test` green (shared, web, server suites). No new heavy deps in `apps/web/package.json`. No `tailwind.config.*` file.
- [ ] Pre-existing aria (`aria-current`, `role="progressbar"`, `role="alert"`, `<nav aria-label>`, icon-button labels) preserved and improved.

---

## 12. Phasing (build in this order)

**Phase 0 — Design tokens + primitives.** `@theme` block, motion stylesheet, library-warm stylesheet, fonts self-hosted, restyle `Button` / `ConfirmDialog` / `Skeleton`, scaffold Card / Sheet / Tabs / Tooltip / Toast / Kbd / Pill / ProgressBar / Diagnostic dot. Replace every hardcoded studio `*-blue-*` with brass.

**Phase 1 — Core flow.** Global Shell (TopBar / LeftRail / StatusBar) + BooksListPage + StudioPage dashboard (StageStepper + progress + ConceptForm + WarningsFeed + StageCard grid).

**Phase 2 — Stage workspaces.** MarkdownStagePage (PlaybookRunner + AspectRunner) and EntityStagePage (EntityStageRunner) under the Library-Warm system.

**Phase 3 — ChaptersStagePage (panels + chapter rack)** and **ChapterPage** (the manuscript — highest care).

**Phase 4 — Periphery.** SettingsStagePage, StyleProfilesPage(s), UsagePage (custom SVG charts), Not-found, ErrorBoundary, optional CommandPalette.

For each phase: implement the real components, keep `pnpm typecheck` clean and `pnpm test` green (adjust tests only for unavoidable label/DOM changes), and summarize before → after.

Build the redesign now. Start with **Phase 0**.

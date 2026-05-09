# BOOKOPIS — Full Redesign Prompt (Library Warm, Dark-Only)

> Paste this entire document into Claude (or any design-capable model) as a single prompt. It covers the design system, every route, every panel, every state, and every interaction. Output target: production React + TypeScript + Tailwind CSS components matching the existing project structure (`apps/web/src/`).

---

## 1. Mission

Redesign **BOOKOPIS** — an AI-assisted novel-writing tool — for a writer who uses it 4–8 hours per day. Goal: make daily use *physically pleasant*. Minimize friction, maximize calm focus, reward long sessions. Single dark theme only (no light mode). Russian UI copy preserved. Animations are quiet, purposeful, never decorative.

The product is a multi-agent pipeline (writer, editor, critic, style_extractor, summarizer, etc.) wrapped in a manuscript-first UI. Users plan, write, critique, and revise novels chapter by chapter. Backend is already built — only the frontend (`apps/web/src/`) is in scope.

---

## 2. Design Concept — "Library Warm"

Think: an editor's mahogany desk under a brass lamp at 1 a.m. Warm dark, paper-textured manuscript zone, serif body for prose, sans for chrome, brass accents, red-ink revisions. Bookish, authorial, not retro. Subtle, never skeuomorphic.

### 2.1 Color Tokens (CSS variables, dark-only)

```css
:root {
  /* surfaces */
  --bg:           #1A1410;   /* app shell, espresso */
  --surface-1:    #221A14;   /* cards, panels */
  --surface-2:    #2B2118;   /* elevated, manuscript paper zone */
  --surface-3:    #342719;   /* hover/active raise */
  --overlay:      rgba(10,7,5,0.72);   /* modal/sheet scrim, backdrop-blur(16px) */

  /* borders */
  --border:       #3A2D22;
  --border-soft:  #2E241B;
  --border-strong:#54402F;

  /* text */
  --text:         #EDE4D3;   /* warm cream, body */
  --text-strong:  #FBF5E6;
  --text-muted:   #9C8B73;
  --text-faint:   #6E5F4D;

  /* accents */
  --brass:        #D49A4E;   /* primary accent: CTAs, focus, links */
  --brass-soft:   #B07F33;
  --brass-glow:   rgba(212,154,78,0.18);

  --ink-red:      #C44536;   /* critic edits, deletions, errors */
  --ink-green:    #6A8E4E;   /* additions, success */
  --ink-blue:     #5B7A99;   /* info, citations */
  --ink-amber:    #C9A24A;   /* warnings, pending */

  /* manuscript-specific */
  --paper:        #2B2118;
  --paper-grain:  url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.92  0 0 0 0 0.86  0 0 0 0 0.74  0 0 0 0.025 0"/></filter><rect width="100%" height="100%" filter="url(%23n)"/></svg>');
  --margin-rule:  #3A2D22;   /* hairline at left margin of paper */

  /* shadows (warm) */
  --shadow-sm:    0 1px 2px rgba(0,0,0,0.35);
  --shadow-md:    0 6px 16px rgba(0,0,0,0.45), 0 0 0 1px var(--border-soft);
  --shadow-lg:    0 24px 48px rgba(0,0,0,0.55), 0 0 0 1px var(--border-soft);
  --shadow-glow:  0 0 0 3px var(--brass-glow);   /* focus ring */
}
```

### 2.2 Typography

| Role | Family | Size / LH | Weight | Use |
|---|---|---|---|---|
| Manuscript prose | `Lora` (or `Source Serif 4`) | 18 / 1.75 | 400 / 600 italic | chapter body, scene text |
| Chapter heading | `Fraunces` | 28 / 1.2 | 500, optical-size 36 | chapter titles |
| UI body | `Inter` | 14 / 1.5 | 400 / 500 | panels, lists, controls |
| UI heading | `Inter` | 20 / 1.3 | 600, tight tracking | page titles |
| Caption / meta | `Inter` | 12 / 1.4 | 500, +0.02em | labels, status |
| Mono | `JetBrains Mono` | 12 / 1.5 | 400 | tokens, ids, costs |

Self-host all four families. Provide Cyrillic subsets. `font-feature-settings: "ss01","cv05"` on Inter for sharper digits.

### 2.3 Spacing, Radii, Geometry

- 4-px base. Allowed: `4 8 12 16 20 24 32 40 56 72 96`.
- Radii: `6` controls, `10` cards, `14` panels/sheets, `20` page shells.
- Borders: `1px` hairline default; never thicker except `2px` brass focus.
- Page max-width: `1440`. Manuscript column: `680`. Sidebar: `260`. Inspector: `360`.

### 2.4 Animation System

All transitions ≤ 240 ms. Easing: `cubic-bezier(0.22, 0.9, 0.32, 1)` for enter/exit; `cubic-bezier(0.4, 0, 0.6, 1)` for hover. No bounce. No scale > 1.02. No rotation.

| Token | Duration | Use |
|---|---|---|
| `motion-1` | 80 ms | hover color, cursor caret |
| `motion-2` | 160 ms | small reveals, dropdowns, tooltips |
| `motion-3` | 200 ms | panels, sheets, page transitions |
| `motion-4` | 320 ms | chapter open page-turn, drop-cap fade |

Special motions:
- **Page turn** on chapter navigation: subtle 320 ms `translateX(8px) → 0` + opacity fade on outgoing, incoming `translateX(-8px) → 0`. Never literal page flip.
- **AI streaming**: each new token fades in over 80 ms via opacity 0 → 1; caret = blinking brass underscore at insertion point.
- **Critic verdict reveal**: 200 ms `opacity 0→1` + `translateY(4px → 0)`, staggered 40 ms per item.
- **Drop-cap on chapter open**: serif drop-cap fades from 0 to 1 over 320 ms after first paragraph mounts.
- **Loading**: skeletons pulse `opacity 0.4↔0.7` at 1.4 s; never spin.
- Honor `prefers-reduced-motion` — fall back to opacity-only, 80 ms.

---

## 3. Component Primitives

Rebuild each existing primitive in `apps/web/src/components/ui/` to match this concept. Match exported APIs; replace internals.

### 3.1 Button

Variants: `primary`, `secondary`, `ghost`, `ink-red` (destructive), `link`.
Sizes: `sm (28px)`, `md (32px)`, `lg (40px)`.

- `primary`: `bg: var(--brass)`, `text: #1A1410`, hover `bg: #E1A858`, active `bg: #B07F33`, focus ring `var(--shadow-glow)`.
- `secondary`: `bg: var(--surface-2)`, `border: var(--border)`, `text: var(--text)`, hover `bg: var(--surface-3)`.
- `ghost`: transparent, hover `bg: var(--surface-2)`.
- `ink-red`: `bg: transparent`, `border: var(--ink-red)`, `text: var(--ink-red)`, hover fills.
- `link`: brass underline-on-hover, no padding.

States: `default | hover | active | focus | disabled (opacity 0.4) | loading (spinner inline, brass)`.

### 3.2 Sheet (slide-over)

Slides from right, width 480 (md) / 640 (lg). Backdrop = `var(--overlay)` + `backdrop-blur(16px)`. Enter 200 ms, exit 160 ms. Drag-handle on left edge for resize. Esc closes.

### 3.3 Tabs

Underline tabs. Inactive: `var(--text-muted)`. Active: `var(--text-strong)` + 2-px brass underline that slides between tabs (`motion-2`).

### 3.4 AlertDialog

Center modal, max-w 440. Title 18/600 cream, body 14 muted, footer right-aligned buttons. Destructive uses `ink-red` button. Backdrop blur.

### 3.5 Skeleton

Solid `var(--surface-2)` rect with subtle warm shimmer (linear-gradient sweep, 1.6 s). Match target component shape exactly.

### 3.6 New primitives to add

- **Card**: `bg: var(--surface-1)`, radius 10, `padding: 16/20`, hover lifts to `--surface-2` + `--shadow-md`.
- **Tooltip**: small dark pill, brass border 1 px, mono 12 px, `motion-2`.
- **Toast** (top-right stack): brass left-border accent for info, `ink-red` for error, `ink-green` for success. Auto-dismiss 4 s. Slide-in from right.
- **CommandPalette** (Cmd/Ctrl-K): centered, 560 wide, glass surface, fuzzy search, sectioned results, brass highlight on selection.
- **Kbd**: small mono pill `bg: var(--surface-3)`, `border: var(--border)`, `12px` mono, +0.02 tracking.
- **Pill / Tag**: rounded-full 20, 12 px caption, brass-soft border for "agent", muted border for "status".
- **ProgressBar**: 2 px height, brass fill on `--surface-2` track, `motion-3` width transition.
- **Diagnostic dot**: 6 px circle in gutter — `--ink-red` (issue), `--ink-amber` (suggestion), `--ink-blue` (note).

---

## 4. Global Shell

Persistent **TopBar** (56 px, sticky):

- Left: brass wordmark "Bookopis" in Fraunces 18, then breadcrumb (`Книги / <BookTitle> / Глава 4`) using ` / ` separator in muted.
- Center: nothing on most pages; on Chapter route — chapter title (Fraunces 16, italic muted prefix `Гл. 4 ·` then bold cream title), inline-editable on click.
- Right: `Cmd-K` Kbd hint, `Профиль стиля` selector pill, `Использование` link, avatar dot.
- Background `var(--bg)`, bottom border `--border-soft` only after scroll > 4 px (animate in).

**LeftRail** (60 px, icon-only nav, optional collapse): book list, current book, style profiles, usage, settings. Active = brass left-bar (3 px) + cream icon. Tooltips on hover.

**StatusBar** (24 px bottom, mono 12): live tokens used this session · current backend (`api` / `subscription`) · current agent · cost · network state. Hides on Chapter route in focus mode.

Page transitions between routes: 200 ms opacity + 8 px lift. Shared layout for `Books → Book → Chapter` (title morphs into TopBar breadcrumb).

Keyboard:
- `Cmd/Ctrl-K` — Command palette
- `Cmd-S` — manual save (auto-save is default)
- `Cmd-/` — toggle inspector / critique panel
- `Cmd-\\` — toggle left rail
- `Cmd-Shift-F` — focus mode (hide all chrome)
- `Cmd-Enter` — run primary AI action on current selection / chapter
- `Esc` — close sheets/dialogs/palette

---

## 5. Routes — Every Screen, Every State

### 5.1 `/books` — BooksListPage

**Default**: page title "Ваши книги" (28/Fraunces) + subtitle muted "12 книг · последняя правка 2 ч. назад". Right of title: `+ Новая книга` primary button.

Below: **grid of book cards** (3 cols ≥ 1280, 2 cols ≥ 768, 1 col mobile). Each card 320×220:
- Top: faux spine — 12 px tall brass gradient strip, with embossed title in tiny mono.
- Body (paper texture surface): book title (Fraunces 22), author/genre meta (Inter 12 muted), chapter count + word count in mono.
- Bottom row: last-edited relative time + tag pills (genre, status: `черновик` amber / `редактируется` blue / `готова` green).
- Hover: lift `--shadow-md`, brass border.
- Focus: brass ring.
- Right-click / kebab: rename, duplicate, archive, delete.

**Empty state**: centered, max-w 440. Quiet line illustration of an open book with brass bookmark. Headline "Здесь будет ваша первая книга". Body muted. Primary button "Создать книгу".

**Loading**: 6 skeleton cards, paper-shimmer.

**Error**: card-shaped error block with `ink-red` left bar, body, retry ghost button.

**Create dialog** (AlertDialog): name, genre, optional style profile dropdown, target word count (slider). `Создать` primary.

### 5.2 `/books/:bookId` — BookPage

Three-pane layout: **Outline (left, 280)** | **Workspace (center, fluid)** | **Inspector (right, 360, collapsible)**.

**Workspace** is tabbed (Tabs primitive): `Обзор · План · Канон · Знания · Импорт/Экспорт`.

- **Обзор** tab: book hero block — title (Fraunces 32), author + genre + style profile pills, three stat cards (всего слов / глав / последняя правка) using mono digits and brass underline tick on hover. Below: vertical chapter timeline — each entry = round dot on a 1 px vertical rule, chapter number + title, word count, updated relative, status pill, and `→` to open. Hover row highlights paper-warm. Drag to reorder (handle appears on hover, smooth reorder `motion-3`).
- **План** tab: hosts `PlanPanel`. Two columns: structured plot beats (sortable cards) on left; AI suggestions queue on right. Cards have a brass `Принять` and ghost `Отклонить`. Empty: "Создайте план: используйте `Cmd-Enter` или кнопку «Сгенерировать план»."
- **Канон** tab: hosts `CanonPanel`. List of canon facts + entities. Each fact = card with subject (bold), predicate (muted), object, source chapter link. Filter chips at top by entity type. New-fact composer at bottom (sticky, paper surface). Conflict warnings render with `ink-red` left bar.
- **Знания** tab: hosts `KnowledgePanel`. Search field + category facets (locations, characters, lore). Cards similar to Canon but read-only with edit-on-click. Empty: helpful onboarding tip.
- **Импорт/Экспорт** tab: hosts `ImportExportPanel`. Two-column layout. Left: import drop-zone (drag rectangle, paper texture, brass dashed border on drag-over), supported formats list (txt, md, docx, fb2). Right: export — format radios, options (include critique notes? canon? plan?), `Экспортировать` primary with progress bar that fills brass during job.

**Outline panel (left)** — `OutlinePanel`:
- Sticky header "Главы" + search field + `+` button.
- Scrollable nested tree: parts → chapters → scenes. Active chapter highlighted with brass left-bar + paper-warm bg.
- Drag-and-drop reorder; ghost preview while dragging.
- Right-click: rename, insert chapter above/below, mark draft/done, delete (confirm dialog).
- Empty: "Нет глав. Добавьте первую — `Cmd-N`."

**Inspector panel (right)**:
- Tabs: `Метаданные · Стиль · История`.
- `Метаданные`: editable fields (title, subtitle, author, genre, audience, language).
- `Стиль`: linked style profile chip (clickable → Style Profile page), traits visualization (small radar chart in brass on `--surface-2`), `Извлечь из главы` brass button.
- `История`: chronological list of revisions, each with diff thumbnail (mini VersionDiff), restore button.

**Loading**: shell renders, panels show skeletons matching their layouts.
**Error per panel**: `ink-red` thin left-bar inside the panel only — never blow up the page.

### 5.3 `/books/:bookId/chapters/:chapterId` — ChapterPage

**The most-used screen. Make it the calmest screen.**

Layout: **OutlineRail (left, 240, collapsible)** | **Manuscript (center, fluid, max content width 680)** | **CritiqueRail (right, 400, collapsible)**. Both rails collapse with `Cmd-\\` / `Cmd-/`. Focus mode (`Cmd-Shift-F`) hides both rails + TopBar; manuscript centers, status bar dims.

**Manuscript area**:
- Background `var(--paper)` with `var(--paper-grain)` overlay at `opacity: 0.5; mix-blend-mode: overlay; pointer-events: none`.
- 1 px hairline left margin rule (`var(--margin-rule)`) at column edge — like a writer's notebook.
- Chapter title block at top: small italic muted "Глава 4" + Fraunces 32 title (inline-editable, blue caret only on edit).
- First paragraph: drop-cap (Fraunces 56, brass, line-height 0.9, float-left margin 6/8) — fades in on first mount.
- Body: Lora 18 / 1.75, color `var(--text)`. Paragraph spacing 16. Indents off (use spacing).
- Block selection highlight: `rgba(212,154,78,0.15)`.
- Word/character/token counter discreet bottom-left of manuscript (mono, 12, faint).
- **InlineCommandPanel** (`InlineCommandPanel`): triggered by selection + `Cmd-Enter` or floating brass pill that appears 12 px above selection after 220 ms idle. Pill = "Что сделать?" with mono Kbd. Click expands to compact action menu: "Переписать · Сократить · Развернуть · Перевести · Своя инструкция…". Opens a small popover with text input + run button.
- **AI streaming** into manuscript: brass underscore caret blinks at insertion. Streamed text fades in 80 ms per chunk. Stream can be paused (Esc) — leaves a faint dashed underline on streamed range until accepted.
- **Diff overlay** (`VersionDiff`): when reviewing AI revision — additions get `--ink-green` underline + soft tint, deletions get `--ink-red` strike + soft tint. Toolbar floats at top of diff: `Принять всё` brass, `Отклонить всё` ghost, `Принять выбранное`, `Показать только изменения`. Per-hunk inline `✓`/`✕` chips on hover.

**OutlineRail (left)**:
- Compact `OutlinePanel` showing chapters; current chapter highlighted; mini word-count bars under each.
- Above: current chapter scene list — clicking a scene scrolls manuscript smoothly (`motion-3`).
- Footer: jump-to-chapter mini search (`Cmd-P`).

**CritiqueRail (right)** — `CritiquePanel`:
- Sticky header: critic verdict summary line — three small dots (logic, prose, canon) coloured by verdict (`ink-green`/`ink-amber`/`ink-red`).
- Tabs: `Все · Сюжет · Стиль · Канон · Факты`.
- Verdict cards (1 per critic finding): severity dot + title + agent badge (mono pill with agent name, e.g. `style_extractor`) + body excerpt + `Перейти` link that scrolls + flashes the cited passage. Card actions: `Применить правку`, `Игнорировать`, `Создать задачу`.
- Footer: `Запросить новый разбор` brass button + agent picker dropdown (which agent runs).
- Streaming critique state: card appears with brass shimmer top edge, body fills as tokens arrive.

**SearchPanel** (`SearchPanel`) — invoked by `Cmd-F`: slides down from TopBar 48 px tall. Field, prev/next, count, regex toggle, replace expand. Match highlights inline manuscript with brass tint; current match darker.

**States**:
- *Loading*: paper area renders empty with one centered serif loader pulse + chapter title skeleton.
- *Empty chapter*: drop-cap area shows a faint placeholder "Начните писать…" (italic muted). Hint card below: "`Cmd-Enter` — попросить ИИ начать главу".
- *Saving*: small mono "Сохранено · только что" / "Сохранение…" in status bar; never modal.
- *Conflict* (e.g. chapter edited elsewhere): top inline ribbon `ink-amber` left bar with merge/discard/reload actions.
- *Streaming long*: progress bar in status bar showing token count + cancel button.
- *Network down*: muted top ribbon "Офлайн — изменения сохраняются локально".

### 5.4 `/style-profiles` — StyleProfilesListPage

Header: "Профили стиля" + `+ Новый профиль`.

Grid of profile cards (similar size to book cards). Each card:
- Top: a small brass-line **trait chart** (mini radar / parallel-bar) showing 6 axes (тон, темп, лексика, образность, диалоги, ритм). Animated draw on mount (240 ms strokeDashoffset).
- Title (Fraunces 22), source meta ("извлечён из «Стальные ливни», гл. 1–3"), chip list of source chapters.
- Bottom: usage count, "используется в N книгах".

Empty: "Профили стиля помогают модели писать в едином голосе. Извлеките из готового текста или создайте вручную."

### 5.5 `/style-profiles/:profileId` — StyleProfilePage

Two-column: **Profile editor (left, fluid)** | **Source samples (right, 360)**.

- Editor: name, description, large radar chart (full size, brass strokes on `surface-2`), trait sliders below (each 0–100 with mono value), example phrases editor (multi-line, paper background), forbidden constructs list.
- Source samples: list of source-chapter excerpts with a `Переизвлечь` brass button at top. Excerpt cards = compact paper surface, italic, with citation link.
- Footer: `Сохранить` primary, `Удалить` ink-red ghost.

### 5.6 `/usage` — UsagePage

Header + range picker (today / 7д / 30д / custom) + backend filter pill.

Three stat cards in a row: total tokens, total cost, sessions. Mono digits, +Δ vs previous period in `ink-green`/`ink-red`.

Below: two charts side-by-side — *Tokens by agent* (horizontal bar, brass scale) and *Cost over time* (line, brass on warm grid). Both use Recharts or visx; warm dark theme; tooltips = our Tooltip primitive. Animate on mount: bars grow from left 320 ms, line draws strokeDashoffset 320 ms.

Below charts: detailed table — datetime, agent, backend, model, input tokens, output tokens, cost, status. Mono for numeric columns. Sortable. Sticky header. Row hover paper-warm.

Empty state when no usage: muted centered hint.

### 5.7 `*` — Not found

Centered max-w 440. Fraunces 28 "Страница потерялась". Body "Возможно, её перенесли в другую главу." Primary `На главную` button. Tiny brass bookmark illustration.

---

## 6. Cross-cutting States

For every page, design and implement these explicitly:

| State | Treatment |
|---|---|
| Loading | Skeletons matching final layout; no spinners except inside buttons. |
| Empty | Quiet illustration + headline + body + 1 primary action. |
| Error (recoverable) | Inline `ink-red` left-bar block, retry ghost button, mono error code small. |
| Error (page-level) | `ErrorBoundary` fallback: centered card, headline "Что-то сломалось", body with reload button, expandable details (mono, scrollable). |
| Auth required | Redirect; show toast "Войдите, чтобы продолжить". |
| Streaming AI | Brass shimmer top edge on receiving card; per-token fade-in; cancel control; status bar progress. |
| Optimistic action | Apply immediately, show toast with `Отменить` button (5 s window). |
| Destructive | AlertDialog with `ink-red` button; require typing chapter name for irreversible book deletes. |
| Offline | Top muted ribbon + writes queued locally indicator in status bar. |
| Conflict | `ink-amber` ribbon with merge/discard/reload. |

---

## 7. Accessibility

- Color contrast: text ≥ 4.5:1 against any surface; `--text-muted` ≥ 4.5:1 against `--bg` (verify; nudge if not).
- Focus rings: brass 2 px + 3 px brass-soft glow on every interactive element. Never `outline: none` without replacement.
- Keyboard: every action reachable; visible focus order matches DOM.
- ARIA: dialogs with `role="dialog"` + `aria-modal`, sheets with `aria-labelledby`, live region for AI streaming + toast announcements.
- Hit targets ≥ 32 px (40 px on touch).
- Respect `prefers-reduced-motion`.
- Screen-reader-only labels for icon-only buttons.

---

## 8. Implementation Notes

- Stack: keep existing — React 19 + TypeScript + Tailwind + Vite. No new heavy deps unless justified.
- Add: `framer-motion` (or use CSS where sufficient), `@radix-ui/*` primitives if not already (Dialog, Tooltip, Tabs, Popover, ScrollArea), `cmdk` for command palette, `recharts` for usage charts, `react-hotkeys-hook` for shortcuts.
- Tailwind: extend theme with the tokens above. Generate semantic utility classes (`bg-surface-1`, `text-muted`, `border-border`, etc.). Replace raw hex usage everywhere.
- Self-host fonts under `apps/web/public/fonts/` with `font-display: swap`. Subset Cyrillic + Latin.
- Component file structure: keep existing module names; refactor internals; co-locate `*.stories.tsx` examples for visual review.
- Persist user prefs (rail collapse, focus mode, inspector tab) in `localStorage`.
- Animations: prefer CSS for hover/focus, framer-motion only for layout/page transitions and drag-reorder.
- All copy in Russian; no English UI strings.

---

## 9. Deliverables

For each route and each panel listed in Sections 4–5, produce:

1. **Final React component** (TS, Tailwind), wired to the existing data hooks/stores in `apps/web/src/lib/`. If a hook is missing, stub it with `// TODO: connect to <existing-source>` and a typed interface — never invent business logic.
2. **All states** rendered via prop or storybook story: `default · loading · empty · error · streaming · disabled · offline · conflict` where applicable.
3. **Keyboard shortcuts** wired and discoverable in Command Palette.
4. **Updated primitives** in `components/ui/` matching Section 3.
5. **Tailwind theme extension** in `tailwind.config.ts` and CSS tokens file.
6. **Animation helper module** exposing `motion-1..4` tokens for both CSS and framer-motion.
7. **One global stylesheet** (`apps/web/src/styles/library-warm.css`) defining tokens, paper grain SVG, base typography.

Match existing component contracts: `Sheet`, `Tabs`, `AlertDialog`, `Skeleton`, `Button`, `ErrorBoundary`, `OutlinePanel`, `PlanPanel`, `CanonPanel`, `KnowledgePanel`, `CritiquePanel`, `InlineCommandPanel`, `SearchPanel`, `ImportExportPanel`, `VersionDiff`. Do not break their public props.

---

## 10. Quality Bar

Before considering any screen done:

- [ ] Looks calm at 2 a.m. on an OLED display — no glow, no eye strain.
- [ ] Loads under 200 ms (skeletons appear instantly; real content fades in).
- [ ] Every interactive element has hover + focus + active visual feedback.
- [ ] Every async action has loading + success + error path designed.
- [ ] Keyboard-only flow can complete the screen's main task end-to-end.
- [ ] Manuscript reading is comfortable for 2 hours straight (test it).
- [ ] Animations fade gracefully under `prefers-reduced-motion`.
- [ ] Russian copy is natural — never translated-from-English-feeling.
- [ ] Nothing scales > 1.02 on hover; nothing bounces; nothing strobes.

Build the redesign now. Start with the design tokens + global stylesheet + primitives (Section 3), then `ChapterPage` (highest-leverage daily screen), then radiate outward to `BookPage`, `BooksListPage`, style profiles, usage, error/empty states, and finally polish.

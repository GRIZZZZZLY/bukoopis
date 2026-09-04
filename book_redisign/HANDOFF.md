# Bookopis · Library Warm — Handoff for Claude Code

This package gives a developer agent everything needed to wire the redesign into the real `apps/web/src/` codebase.

## What you have

- `Bookopis.html` — single-file interactive design canvas with all routes (open in browser).
- `index.html` + `src/*.jsx` + `styles/library-warm.css` — unbundled source. Mirrors the file layout you'll port to.
- `design-canvas.jsx` / `tweaks-panel.jsx` — review-tool scaffolds; **do not port**.

## Routes covered (matches Section 5 of the spec)

| ID | Route | Source |
|---|---|---|
| 01 | `/books/:bookId/chapters/:chapterId` (flagship) | `src/screen-chapter.jsx` → `<ChapterPage>` |
| 02 | …same with diff overlay + bottom command bar | `<ChapterPage showDiff aiSurface="bottombar">` |
| 03 | Focus mode (`Cmd-Shift-F`) | `src/screens-extra.jsx` → `<FocusMode>` |
| 04 | Command palette (`Cmd-K`) | `<CommandPalette>` |
| 05–09 | `/books/:bookId` — Обзор / План / Канон / Знания / Импорт-Экспорт | `src/screens.jsx` → `<BookPage tab=…>` |
| 10 | `/books` | `<BooksList>` |
| 11 | `/style-profiles` | `<StyleProfilesList>` |
| 12 | `/usage` | `<UsagePage>` |
| 13 | Cross-cutting states (loading / empty / error / conflict / offline / toast / destructive) | `<ErrorAndStates>` |
| 14 | `*` (404) | `<NotFound>` |
| 15 | Primitives kit | `<Toolkit>` |

## Tweak axes baked into ChapterPage

`<ChapterPage>` accepts:

- `aiSurface`: `"pill"` (floating brass pill above selection) | `"bottombar"` (sticky AI command bar) | `"gutter"` (left-margin action stack)
- `serif`: `"lora"` | `"sourceserif"` | `"fraunces"` — manuscript body face
- `grain`: `"off"` | `"subtle"` | `"strong"` — paper grain via `--grain-opacity`
- `showDiff`: `boolean` — toggles in-place addition/deletion underline overlay

## Port plan

### 1 · Tokens & global stylesheet

Copy `styles/library-warm.css` verbatim to `apps/web/src/styles/library-warm.css`.
Import once at app root. Tokens are CSS variables; no Tailwind plugin required.

If you want Tailwind utilities (`bg-surface-1`, `text-muted`, etc.), extend `tailwind.config.ts`:

```ts
// tailwind.config.ts (excerpt)
export default {
  darkMode: 'class', // we are dark-only; a stable class avoids OS flips
  theme: {
    extend: {
      colors: {
        bg:           'var(--bg)',
        'surface-1':  'var(--surface-1)',
        'surface-2':  'var(--surface-2)',
        'surface-3':  'var(--surface-3)',
        border:       'var(--border)',
        'border-soft':'var(--border-soft)',
        'border-strong':'var(--border-strong)',
        text:         'var(--text)',
        'text-strong':'var(--text-strong)',
        muted:        'var(--text-muted)',
        faint:        'var(--text-faint)',
        brass:        'var(--brass)',
        'brass-soft': 'var(--brass-soft)',
        'ink-red':    'var(--ink-red)',
        'ink-green':  'var(--ink-green)',
        'ink-blue':   'var(--ink-blue)',
        'ink-amber':  'var(--ink-amber)',
        paper:        'var(--paper)',
      },
      fontFamily: {
        prose:   ['Lora', 'Source Serif 4', 'Georgia', 'serif'],
        display: ['Fraunces', 'Lora', 'Georgia', 'serif'],
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { sm: '6px', DEFAULT: '10px', lg: '14px', xl: '20px' },
      boxShadow: {
        sm:   'var(--shadow-sm)',
        md:   'var(--shadow-md)',
        lg:   'var(--shadow-lg)',
        glow: 'var(--shadow-glow)',
      },
      transitionTimingFunction: {
        warm: 'cubic-bezier(0.22, 0.9, 0.32, 1)',
        soft: 'cubic-bezier(0.4, 0, 0.6, 1)',
      },
    },
  },
};
```

### 2 · Self-host fonts

Drop subsets under `apps/web/public/fonts/` (Cyrillic + Latin). The CSS already declares the families; replace the Google Fonts CDN `<link>` with `@font-face` declarations using `font-display: swap`.

Required cuts:
- Fraunces 400, 500, 600 (variable, opsz 9–144 ideal)
- Lora 400, 500, 600 + italic 400, 500
- Source Serif 4 400, 500, 600 + italic 400
- Inter 400, 500, 600, 700
- JetBrains Mono 400, 500

### 3 · Primitives → `apps/web/src/components/ui/`

| Existing module | Replace internals with | From this package |
|---|---|---|
| `Button` | `.lw-btn` class — see `library-warm.css` § buttons | preserve `variant`, `size` props |
| `Tabs` | `.lw-tabs` / `.lw-tab` with sliding underline | preserve API |
| `Sheet` | port: 480/640 width, `--overlay` backdrop, `motion-3` enter / `motion-2` exit | radix-ui Dialog under the hood |
| `AlertDialog` | center modal, `--overlay` backdrop, brass title, ink-red destructive button | radix-ui AlertDialog |
| `Skeleton` | `.lw-skel` warm shimmer (1.6 s gradient sweep) | exact CSS in stylesheet |
| `ErrorBoundary` | render the `<ErrorAndStates>` "page-level" card | mono error code + reload + expandable details |

New primitives to add (see `src/lw-shell.jsx` for prop shapes):

- `Card` — `.lw-card` (hover lifts to `--surface-2` + `--shadow-md`)
- `Tooltip` — small dark pill, brass border, mono 12, `motion-2`
- `Toast` — top-right stack, brass left-bar accent (`data-tone="error"|"success"`), 4 s auto-dismiss
- `CommandPalette` — see `<CommandPalette>` — wire with `cmdk`
- `Kbd` — `.lw-kbd`
- `Pill` / `Tag` — `.lw-pill[data-tone]`
- `ProgressBar` — `.lw-progress`
- `DiagnosticDot` — `.lw-dot[data-tone]`

### 4 · Panel modules

These existing panels render as the named React components — keep their public props.

- `OutlinePanel` → see `<OutlineRail>` (chapter route) and `<BookOutlinePanel>` (book route)
- `PlanPanel` → `<PlanTab>`
- `CanonPanel` → `<CanonTab>`
- `KnowledgePanel` → `<KnowledgeTab>`
- `CritiquePanel` → `<CritiqueRail>` + `<CritiqueCard>` — wire severity dots, agent pills, scroll-and-flash on "Перейти →"
- `InlineCommandPanel` → render whichever AI surface the team picks (`pill` / `bottombar` / `gutter`); keep selection-bound trigger + 220 ms idle delay
- `SearchPanel` → top ribbon (`Cmd-F`), 48 px tall, brass match highlights
- `ImportExportPanel` → `<ImportExportTab>`
- `VersionDiff` → manuscript body in `<Manuscript showDiff>`; per-hunk `✓`/`✕` chips, top toolbar (`Принять всё` / `Отклонить всё` / `Принять выбранное` / `Только изменения`)

### 5 · Shell

- `<TopBar>` — 56 px sticky, brass wordmark + breadcrumb (` / ` separator), right-side cluster (`Cmd-K` Kbd, style profile pill, usage link, avatar dot). Bottom border appears on scroll > 4 px (animate in).
- `<LeftRail>` — 60 px icon-only nav, brass left-bar on active. Tooltips on hover.
- `<StatusBar>` — 24 px mono, hides on focus mode.

### 6 · Keyboard

Wire via `react-hotkeys-hook`; surface every shortcut inside the Command Palette:

| Key | Action |
|---|---|
| `Cmd/Ctrl-K` | Command palette |
| `Cmd-S` | Manual save (auto-save default) |
| `Cmd-/` | Toggle inspector / critique |
| `Cmd-\` | Toggle left rail |
| `Cmd-Shift-F` | Focus mode |
| `Cmd-Enter` | Run primary AI action on selection |
| `Cmd-F` | SearchPanel |
| `Cmd-N` | New chapter (in book route) |
| `Cmd-P` | Jump-to-chapter (chapter route) |
| `Esc` | Close sheet / dialog / palette |

### 7 · Animation tokens

Expose `motion-1..4` from a JS module so framer-motion and CSS share durations:

```ts
// apps/web/src/lib/motion.ts
export const motion = {
  m1: { duration: 0.08, ease: [0.4, 0, 0.6, 1] },
  m2: { duration: 0.16, ease: [0.22, 0.9, 0.32, 1] },
  m3: { duration: 0.2,  ease: [0.22, 0.9, 0.32, 1] },
  m4: { duration: 0.32, ease: [0.22, 0.9, 0.32, 1] },
};
```

Special motions to wire:
- **Page turn** between chapters: outgoing `translateX(0 → 8px) + fadeOut`, incoming `translateX(-8px → 0) + fadeIn`, 320 ms.
- **AI streaming**: per-token opacity 0→1 over 80 ms, brass underscore caret blinking.
- **Critic verdict reveal**: opacity 0→1 + `translateY(4 → 0)`, 200 ms, stagger 40 ms.
- **Drop-cap**: fade 0→1 over 320 ms after first paragraph mounts.
- **Loading**: `lwShimmer` keyframes (already in stylesheet) at 1.6 s.
- Honor `prefers-reduced-motion` — fall back to opacity-only, 80 ms.

### 8 · State to persist (`localStorage`)

- Rail collapse (left, right)
- Focus mode flag
- Inspector active tab
- Chapter scroll position per chapter id
- Range picker preference on `/usage`

### 9 · Russian copy guarantees

All strings in this package are native Russian — preserve verbatim. Notable ones to keep:

- "Запросить новый разбор", "Принять", "Отклонить", "Игнорировать"
- "Сохранено · только что" / "Сохранение…"
- "Офлайн — изменения сохраняются локально"
- "Здесь будет ваша первая книга" (empty state)
- "Страница потерялась" / "Возможно, её перенесли в другую главу" (404)
- Status pills: "черновик" / "редактируется" / "готова"

### 10 · Quality bar — verify before merging

- [ ] OLED-comfortable at 2 a.m. — no glow, no eye strain
- [ ] Skeletons appear instantly; real content fades in
- [ ] Every interactive element has hover + focus + active feedback
- [ ] Every async action has loading + success + error path
- [ ] Keyboard-only flow can complete each screen's main task
- [ ] 2-hour reading session test on the manuscript
- [ ] `prefers-reduced-motion` falls back gracefully
- [ ] No scale > 1.02, no bounce, no strobe
- [ ] Russian copy reads naturally

---

## File map

```
Bookopis.html                          ← single-file canvas (open in browser)
index.html                             ← unbundled entry
styles/library-warm.css                ← copy verbatim → apps/web/src/styles/
src/lw-shell.jsx                       ← TopBar, LeftRail, StatusBar, Tabs, Skel, Card, Pill, Kbd, Dot, Mono, Btn, Icon, Radar
src/screen-chapter.jsx                 ← ChapterPage + OutlineRail + Manuscript + CritiqueRail + CritiqueCard
src/screens.jsx                        ← BooksList, BookPage (5 tabs), StyleProfilesList, UsagePage, NotFound, ErrorAndStates, BookOutlinePanel, Inspector, BookOverview, PlanTab, CanonTab, KnowledgeTab, ImportExportTab
src/screens-extra.jsx                  ← CommandPalette, FocusMode, Toolkit
HANDOFF.md                             ← this file
```

## Demo content note

Manuscript body uses a public-domain Bulgakov excerpt ("Мастер и Маргарита", chapter 1) as filler — replace with whatever the user's draft contains. Critique cards reference that text by line; rewire to the real critic agents' output schema when porting `<CritiqueRail>`.

# Redesign Prompt — «Кузница книг» (book-forge), dark-only, full IA + UX

> Paste the section below into the `frontend-design` skill (or claude.ai design). It is self-contained. It encodes the current codebase state, the locked product constraints, and the agreed design direction.

---

## ROLE & GOAL

You are redesigning **book-forge** — a single-user, local-first, **Russian-language** AI-assisted novel-writing tool. Deliver a **complete visual + layout + information-architecture redesign**, **dark-theme only**, built around a **restrained "forge / кузница книг" metaphor**: the app is a smith's workshop where a writer *forges* a book stage by stage with AI as the bellows.

This is a **professional working instrument**, not a game. The forge identity must read as *craft, heat, iron, focus* — never as costume or skeuomorphic toy. Readability and long writing sessions win every tradeoff.

Work **inside the existing repo**. Produce a **design system first**, then **restyle the real pages/components**, phase by phase, as runnable code.

## HARD CONSTRAINTS (do not violate)

- **Stack is fixed:** React 18 + Vite 6 + **Tailwind v4 CSS-first**. There is **no `tailwind.config.js`** — all design tokens live in `apps/web/src/index.css` inside the `@theme` block (CSS variables `--color-*`, etc.). The redesign's token layer **must** be expressed there.
- **shadcn/ui is source-in-repo.** Currently only `Button` is scaffolded (`apps/web/src/components/ui/`). Copy in more primitives **as needed**, restyled to the system. Do not add a component library.
- **No new heavy dependencies.** No CSS-in-JS, no animation libs, no icon megapacks, no font-loading services. Motion = CSS/Tailwind transitions only. Icons: keep the existing `lucide-react`.
- **Offline-first:** no Google Fonts / CDN. Use system font stacks or fonts already vendored; if a display face is desired, specify a robust system-serif stack, not a downloaded webfont.
- **Dark-only.** One excellent dark palette. Do **not** build a light theme or a theme toggle.
- **Visual + layout + IA only.** Do **not** change routes, data flow, API calls, business logic, or component contracts. No functional regressions. The full test suite (`pnpm test`) and `pnpm typecheck` must stay green; update tests **only** for unavoidable DOM/label changes, never to weaken assertions.
- **Russian UI.** All visible copy in Russian. Forge lexicon allowed but restrained (e.g. «Выковать главу», «Горн», «Заготовка», «Закалка») — never at the expense of clarity.
- **Accessibility is already partially in place — preserve and extend it:** `role="alert"` error blocks, `role="progressbar"` with `aria-valuemin/max/now` + `aria-label`, `<nav aria-label>`, `aria-current="step"` on the active stepper segment, `aria-label` on icon-only controls, `prefers-reduced-motion` respected. Keep all of these; raise contrast and focus-visibility, don't lower it.

## DESIGN DIRECTION (agreed)

**Metaphor intensity — restrained.** Allowed: charcoal/iron dark surfaces, a single hot **ember accent** (heated-iron orange→amber) for primary action / progress / "live" states, subtle forge micro-motifs (spark glyph for completion, anvil/hammer only as small iconography, faint metal grain at most in hero/empty states). Forbidden: literal flames, animated sparks raining, glowing-coal textures behind text, fantasy ornamentation.

**Palette — dark-only, one system.** Build a layered neutral ramp evoking *cold forged iron in a dark smithy*: near-black base → graphite surfaces → steel borders → bright steel text. One **ember** accent ramp (the only saturated hue; reserve for primary CTA, in-progress/generation, the progress bar fill, the recommended stage). Optional: a cool "quench" secondary (deep teal/blue) used sparingly for informational/neutral emphasis so ember stays special. Define semantic tokens (success/warn/danger) tuned for the dark base. Express everything as `@theme` CSS variables; refactor existing hard-coded `bg-blue-*` studio highlights onto the new ember token (the codebase currently mixes `var(--color-*)` and raw `blue-*` — unify).

**Typography.** A **display serif for H1–H2** (book/forged character — robust system-serif stack, no webfont), a clean **grotesque sans for UI/body**, a **mono** for technical/metering labels (token counts, model ids, cost). Contrast = "craft vs instrument". Define a deliberate type scale + line-heights tuned for long-form reading and dense tool chrome.

**Motion — minimal, functional only.** Hover/focus/active, stage-transition fades, an **ember glow/pulse on the progress bar and the primary "Продолжить/Выковать" CTA**, a brief spark accent when a stage completes. **No** ambient/background animation. All motion gated behind `prefers-reduced-motion: reduce`. Keep transitions ≤200ms.

**Density.** Calm but information-dense (this is a power tool used for hours). Generous reading column for prose surfaces; tighter, scannable chrome for dashboards/lists.

## INFORMATION ARCHITECTURE & UX (in scope — redesign, don't just reskin)

Rethink hierarchy, layout, empty/loading/error states, and navigation **without changing routes**. The current routes & surfaces:

- `/books` — **BooksListPage**: create-book input → goes straight to Studio; book cards (title, date, status) each with a «Продолжить →» deep-link to the recommended stage; links to Style Profiles & Usage. Redesign the empty state ("forge your first book"), the card as a "billet/заготовка on the anvil", and the create affordance.
- `/books/:id` → redirects to `/books/:id/studio` (no UI).
- `/books/:id/studio` — **StudioPage dashboard**: the workshop home. Contains: a quick-nav (⚙ Настройки / 📚 Главы), the shared **StageStepper** (7 stages: Концепт→Мир→Лор→Персонажи→Предметы→Сюжет→Главы, with done/current/todo/skipped states), a **progress bar + «Готово N/7 · Далее: …» + «Продолжить»** CTA, the **ConceptForm**, a **WarningsFeed**, and a **stage-card grid**. This is the hero of the redesign — make it feel like standing at the forge with the work plan laid out.
- `/books/:id/studio/:stageId` — **MarkdownStagePage** (world/lore/plot) and **EntityStagePage** (characters/items): a `StageStepper` header + the stage workspace (`PlaybookRunner` → `AspectRunner` / `EntityStageRunner` — aspect generation, variants, accept/refine). Design the aspect/variant review UI as the core craft loop.
- `/books/:id/studio/chapters` — **ChaptersStagePage**: `StageStepper` + panels (OutlinePanel, KnowledgePanel, ImportExportPanel, SearchPanel) + chapter list with add + drag-reorder. The "rack of forged chapters".
- `/books/:id/studio/settings` — **SettingsStagePage**: `StageStepper` (no active segment) + back-to-Studio + book settings (title/status/style profile/writer·plot·critic models/provider/cost estimate) + destructive "delete book" with `ConfirmDialog`.
- `/books/:id/chapters/:chapterId` — **ChapterPage**: the writing forge — TipTap editor surface, plot→writer→critique loop, `CritiquePanel`, model/cost metering, dirty-tracking, mobile-responsive. The longest-session screen: prioritize the prose column, calm chrome, ember only for "generating/forging" state.
- `/style-profiles`, `/style-profiles/:id` — **StyleProfilesPage(s)**.
- `/usage` — **UsagePage**: LLM cost dashboard (per-route/day, totals). Mono numerics, restrained data-viz on the dark base.

Shared components to systematize: **StageStepper, StageCard, WarningsFeed, ConfirmDialog (AlertDialog), Skeleton/PageSkeleton, Button**, panels. Define them as design-system components with documented states (default/hover/focus/active/disabled/loading/error/empty), then apply.

## DELIVERABLE — PHASED, AS CODE IN THE REPO

**Phase 0 — Design System** (foundational, do first):
- Rewrite `apps/web/src/index.css` `@theme`: full dark token set (neutral iron ramp, ember accent ramp, optional quench secondary, semantic states, radius/shadow/elevation, focus-ring, typography variables). Document each token's intent in comments.
- Type scale + font stacks (display-serif / sans / mono) as tokens.
- Restyle the shadcn `Button` and scaffold + style the primitives the pages need (e.g. card, input/select/textarea, dialog, badge/chip, progress, tabs/segmented) — copy-in pattern, dark-forge styled, all states.
- A short living **design-system reference page or doc** (a route is NOT required; a `docs/design/SYSTEM.md` + optionally a `/design` dev-only preview is fine) showing tokens, type scale, and component states.

**Phase 1 — Core flow:** BooksListPage → StudioPage dashboard (StageStepper, progress, ConceptForm, WarningsFeed, stage-card grid). This sets the visual language; get it right before fanning out.

**Phase 2 — Stage workspaces:** MarkdownStagePage + EntityStagePage (PlaybookRunner/AspectRunner/EntityStageRunner, variant review loop).

**Phase 3 — ChaptersStagePage** (panels + chapter rack + reorder) and **ChapterPage** (editor/critique — highest care: long-session legibility, ember = forging state only).

**Phase 4 — Periphery:** SettingsStagePage, StyleProfilesPage(s), UsagePage, ConfirmDialog/Skeleton/error & empty states everywhere.

For **each phase**: implement the real components, keep `pnpm typecheck` clean and `pnpm test` green (adjust tests only for unavoidable label/DOM changes, never weaken them), and summarize what changed + screenshots/ASCII of before→after.

## ACCEPTANCE CRITERIA

- One coherent dark forge identity across **every** route above; ember used scarcely and meaningfully (primary action / progress / generating / recommended).
- `@theme` is the single source of design tokens; **zero** stray raw `bg-blue-*`/hard-coded colors left in studio components — all on tokens.
- Display-serif headings + sans body + mono metrics applied consistently; long-form prose surfaces are comfortable for 1h+ sessions.
- All pre-existing a11y preserved and improved: visible focus rings on the dark base, contrast ≥ WCAG AA for text, `prefers-reduced-motion` honored, stepper `aria-current`, progressbar accessible name, `role="alert"` errors.
- IA improvements: clearer hierarchy, purposeful empty/loading/error states, the StudioPage dashboard legibly communicates "where you are / what's next" at a glance.
- No route/data/logic change; full test suite + typecheck green; Russian copy throughout; no new heavy deps; offline-first (no external fonts/CDN).
- Restrained metaphor: a designer would call it "a focused dark craft tool with a forge soul", not "a themed skin".

## ANTI-GOALS

Light theme or theme toggle · webfonts/CDN · animation libraries or ambient spark/flame animation · skeuomorphic coal/metal textures behind text · fantasy ornamentation · changing routes, API, or business logic · weakening tests to pass · generic dashboard "AI SaaS" look · ember everywhere (it must stay rare and hot).

---

### Notes for whoever runs this prompt

- Repo: `d:\PROJECTS\BOOKOPIS`, web app under `apps/web/`. Tokens: `apps/web/src/index.css` (`@theme`). Pages: `apps/web/src/pages/`. Shared studio components: `apps/web/src/components/studio/`. shadcn primitives: `apps/web/src/components/ui/`.
- Recent UI work already landed on `main`: Studio is the only UI (legacy BookPage removed), the shared `StageStepper`, dashboard progress + «Продолжить», per-book resume. Build the redesign **on top of this current structure** — it is the IA baseline to refine, not replace.
- Suggested workflow: brainstorm the design-system spec → write it to `docs/design/SYSTEM.md` → implement Phase 0 → review → proceed phase by phase, each phase its own reviewed change set.

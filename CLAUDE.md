# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`book-forge` — single-user, local-first AI-assisted novel-writing tool. Russian-language MVP. pnpm workspaces monorepo, Node 22 LTS, ESM only, TypeScript strict (`noUncheckedIndexedAccess`).

## Commands

Run from repo root unless noted.

```bash
pnpm install
pnpm migrate                # apply SQLite migrations to data/db.sqlite
pnpm dev                    # server :3001 + web :5173 in parallel
pnpm dev:server             # server only
pnpm dev:web                # web only
pnpm typecheck              # tsc across all packages
pnpm test                   # vitest across all packages
pnpm build
```

Single test file:

```bash
pnpm --filter @book-forge/server test -- src/routes/__tests__/studio.test.ts
pnpm --filter @book-forge/web test -- src/components/studio/concept/__tests__/ConceptForm.test.tsx
```

Migrations are **hand-written plain SQL** — this is the official process, not a stopgap. Drizzle-kit snapshots are out of sync since 0008 and `drizzle:generate` emits a wrong diff; do NOT use it. The runtime migrator reads `meta/_journal.json` + `.sql` files (not snapshots). Scaffold a new one with `pnpm --filter @book-forge/server drizzle:new <name>` (creates the `.sql` + appends the journal entry), edit the SQL, update `schema.ts` for docs/types, then `pnpm migrate`. `pnpm migrate` auto-backs-up the DB (`VACUUM INTO` → `data/backups/`, last 10). Full process: [docs/migrations.md](docs/migrations.md).

Env: `apps/server/.env` holds `ANTHROPIC_API_KEY` (gitignored). Server reads `PORT`, `DB_PATH`. Web reads `VITE_API_BASE_URL`.

## Architecture

Workspace layout: `apps/{server,web}` + `packages/{shared,agents,llm,retrieval,style-engine}`. Inter-package imports go through `workspace:*` and the package `exports` field — never reach into `src/` of another package.

**Server** ([apps/server/src/app.ts](apps/server/src/app.ts)): Hono app with one db connection (`better-sqlite3`, WAL, optional `sqlite-vec`). Routes mounted under `/api`: `health`, `books`, `chapters`, `plot`, `retrieval`, `import-export`, `entities`, `critique`, `inline`, `style`, `usage`, `canon-extraction`, `studio`. Bootstrap in [apps/server/src/index.ts](apps/server/src/index.ts) calls `registerAllAgentContracts()` + `registerStyleExtractorContract()` + `assertAllStructuredAgentsHaveContracts()` BEFORE `createApp()` so `dispatchStructured` can resolve every agent.

**LLM dispatcher** ([packages/llm](packages/llm/src/)): every structured-output agent registers an `AgentStructuredContract` (input schema, output schema, system prompt, MCP spec). `dispatchStructured({ agentName, payload, model })` routes to Anthropic API or `claude-agent-sdk` mcp_submit_tool backend. Two backends: subscription (default, mcp_submit_tool) and direct API. Adding an agent = add to `AGENT_NAMES`/`STRUCTURED_AGENT_NAMES` ([packages/llm/src/types.ts](packages/llm/src/types.ts)) + write contract in `packages/agents/src/...` + register in [packages/agents/src/bootstrap.ts](packages/agents/src/bootstrap.ts).

**Studio workflow** (`/books/:id/studio`): 7-stage pipeline replacing the old title→outline→chapter flow. Stages = concept, world, lore, characters, items, plot, chapters. World/lore use markdown payloads; characters/items use `entity_set` and materialize into canon tables (`characters`, `items`). State stored in `books.studio_state` JSON with optimistic locking via `revision` counter (PATCH requires `expectedRevision`, returns 409 on mismatch). Hard invariants in [packages/shared/src/studio-invariants.ts](packages/shared/src/studio-invariants.ts) run before every persist; soft warnings in `studio-warnings.ts`. Two-layer aspect engine: `StageAdapter<TPayload>` (renderVariant/renderFinal/payloadSchema) + `AspectRunner` / `EntityStageRunner` orchestrators. Plot/writer/critique routes pull `loadStudioContext` ([apps/server/src/utils/studio-context.ts](apps/server/src/utils/studio-context.ts)) so agents see concept + accepted world/lore aspects.

**Memory layers** (memory-upgrade, 2026-05-14): chapter generation context is assembled from layered sources beyond `loadStudioContext`. All extractors are fire-and-forget, triggered from [triggerVersionSummary](apps/server/src/utils/summary-trigger.ts) after a chapter version is saved; all fail silently (never break the save). Hand-written migrations `0011`–`0013` (+ `_journal.json` entries — runtime `migrate()` reads journal tags, snapshots still broken since 0008).
- **Retrieval** ([utils/chapter-retrieval.ts](apps/server/src/utils/chapter-retrieval.ts)): `gatherRetrievedChunks` wraps `hybridSearch`, top-k prior-chapter chunks into Writer/Plot prompts. `beforeChapterOrder = currentOrder-1` prevents self-leak.
- **Rolling window** ([utils/rolling-context.ts](apps/server/src/utils/rolling-context.ts)): `loadRollingChapterContext` = last 3 chapters verbatim + one `book_meta_summaries` rollup for everything older (bounded prompt regardless of length). Replaced `loadPreviousChaptersSummary`.
- **Temporal canon facts** ([utils/book-facts.ts](apps/server/src/utils/book-facts.ts)): `book_facts` time-scoped (`valid_from/valid_to_chapter` + `superseded_by`). `loadActiveFacts`/`renderActiveFactsPrompt` feed Writer `characterContext` + Canon-Guard `bookContext`.
- **Episodic notes** ([utils/book-notes.ts](apps/server/src/utils/book-notes.ts)): `book_notes` (thread/foreshadow/arc/theme/mystery), embedded on write into `book_notes_vec` (sqlite-vec) with JS-cosine fallback. `gatherRelevantNotes` feeds Plot `openThreads` + Reader critic.
- **Reranker** ([utils/rerank.ts](apps/server/src/utils/rerank.ts)): LLM-judge over the retrieval/notes pool. **Off by default** — `RETRIEVAL_RERANK=1` to enable; passthrough otherwise.

Memory-only extractor agents (`canon_fact_extractor`, `episodic_note_extractor`, `reranker`, `metaSummarize`) follow the standard contract+bootstrap path; the `STRUCTURED_AGENT_NAMES` drift-guard test enforces parity.

**Style engine** ([packages/style-engine](packages/style-engine/src/)): a `style_profiles` row is either `kind='extracted'` (fingerprint from its own corpus) or `kind='blend'` (synthesized from parent profiles listed in `blend_config_json`, migration 0019). Both are ordinary profiles — a book points at either one and writer/critics never learn which. `style_extractor` and `style_blender` live here, not in `packages/agents`, so their contracts are registered separately in [apps/server/src/index.ts](apps/server/src/index.ts).
- **Numbers are measured, not guessed** ([metrics.ts](packages/style-engine/src/metrics.ts)): `sentenceLengths` and the dialogue share are computed from the corpus; the LLM schema (`styleFingerprintLlmSchema`) omits them and returns `narrativeMix` instead, which `composeDensity` rescales into the four densities. A blend averages the parents' measured stats by weight.
- **Few-shot picks must stay stable** ([style-context.ts](apps/server/src/utils/style-context.ts)): the samples block sits inside Writer's `cache_control` prefix, so selection is ordered by a hash of the scene id — `ORDER BY random()` silently cost a full cache miss per generation. A blend draws samples from its parents in proportion to their weights, labelled by source.
- Shared prose rules (LLM-cliché list, RU dialogue punctuation, style-precedence) live in [prose-rules.ts](packages/shared/src/prose-rules.ts) and feed writer/reviser/inline/critic_style plus the fatigue baseline — previously four drifting copies.

**DB**: SQLite single file. Direct `sqlite.prepare().run/get/all` at runtime — Drizzle is schema-only. JSON columns stored as TEXT (concept, studio_state, payloads).

## Locked decisions

Stored in `~/.claude/projects/d--PROJECTS-BOOKOPIS/memory/`. Highlights:

- Auth/backend: **hybrid per-agent router** (`packages/llm/src/router.ts` → `DEFAULT_AGENT_BACKEND`). Text/aspect/memory agents (writer, editor, inline, summarizer, concept_refiner, aspect_*, canon_fact_extractor, episodic_note_extractor, reranker) default to a **subscription** backend (`claude login` via `claude-agent-sdk`; `ANTHROPIC_API_KEY` stripped from env; marked zero-cost in the usage tracker). Plot/critics/canon_guard/style_extractor/lore/character default to **direct API** (`ANTHROPIC_API_KEY`, billed). Override via `LLM_AGENT_BACKEND_MAP`. **CAVEAT:** the "subscription = free" labeling is an unverified code assumption — the 2026-05-08 research (GitHub issues #559/#43333/#44669) found Max/OAuth calls still bill as API. The key is still required today; verify real billing before trusting subscription to cut cost.
- Models: `claude-sonnet-4-6` (Plot, critics), `claude-opus-4-7` (Writer). **Opus 4.7 deprecates `temperature`** — pass conditionally (`...(temperature !== undefined ? { temperature } : {})`), Anthropic returns 400 otherwise.
- Per-book model switcher: `books.{writer_model,plot_model,critic_model}` columns drive dropdowns in BookPage.
- MVP scope locks: Russian only, levels 1+3+4 (level 2 arcs deferred), 8 agents, manual self-repair (variant B), full critique from MVP.
- **Desktop-only — мобильная вёрстка не важна вообще** (locked 2026-07-31). Не тестировать, не полировать, не заводить задачи; поломки ниже 768px багами не считаются и работу не блокируют. Существующие мобильные правила (`@media (max-width: 767px)` в `library-warm.css`, Sheet с панелями) оставлены как есть — не развивать.
- Out of MVP (do not propose): Obsidian/MCP file-watcher, branching UI, ESLint/Prettier/Husky/Docker/CI, multi-user auth, second language, мобильная/адаптивная вёрстка.
- Tests mock LLM calls (`vi.mock("@book-forge/agents/...")`) — agent contracts covered indirectly via route tests.

## Frontend

React 18 + Vite 6 + Tailwind v4 (CSS-first via `@tailwindcss/vite`, no `tailwind.config.js` — design tokens in `apps/web/src/index.css` `@theme` block). shadcn/ui as source-in-repo (only `Button` scaffolded; copy more in as needed). TipTap for editor surface. Routing via `react-router-dom@7`. Studio routes dispatch on `stageId`: `characters|items` → `EntityStagePage`, otherwise `MarkdownStagePage`.

Атмосфера «кабинета» (phase 1): классы `atm-full|atm-calm|atm-off` на `<html>` из [useAtmosphere](apps/web/src/lib/useAtmosphere.ts) (localStorage `bf-atmosphere`, лампа в TopBar); декор-слои в конце `library-warm.css`, гейтятся этими классами. Свеча-цель: `GET /api/writing-progress` + леджер `writing_days` (дельты пишет draft-хендлер chapters). Палитра — «Чернильная ночь» (сине-чернильный + золото), токены синхронно в `index.css @theme static` и `library-warm.css :root`.

Комната «Библиотека» (phase 2): BooksListPage — книжная полка (`.bookshelf`), геометрия корешков в [shelf.ts](apps/web/src/lib/shelf.ts) от `GET /api/books/stats` (агрегат глав/слов/готовых).

Комната «Кабинет» (phase 2): ChapterPage — 3-колоночный `.chapter-grid` (OutlineRail · `.ms-paper` рукопись · cri-rail с критикой и материалами); живой статус сохранения в StatusBar через [saveStatus.ts](apps/web/src/lib/saveStatus.ts), чернильница-автосейв в подвале рукописи.

Комната «Мастерская» (phase 2): Studio — карточки-чертежи (blueprint-сетка на `.stagecard`), иконки этапов — инструменты (колба/глобус/свиток/портреты/сундук/карта/стопка), верстак-фон `.page-studio` под atm-гейтом.

Комната «Доска сюжета» (phase 2): `/books/:bookId/board` — заметки `book_notes` как стикеры на пробке, колонка = глава появления, красная нить тянется до главы закрытия (открытые — пунктиром за край). Геометрия в [board.ts](apps/web/src/lib/board.ts), данные — `GET /api/books/:id/notes`. Read-only: заметки пишут агенты памяти.

## Project memory

This repository has a persistent memory that survives across machines and sessions.
It lives in an Obsidian vault reached through the `om` MCP server.

**Do not start substantive work in this repository without consulting it first.**
The last session left its reasoning there, and re-deriving it wastes the time this
layer exists to save.

At the start of a task:

1. Call `recall` вЂ” durable lessons scoped to this repo, most specific first. Call it
   with no query to see everything in scope; that is usually what you want first.
2. Read `projects/<this-repo>/README.md` through `search` or the `vault://` resource.
   It is the single source of this project's current status and next step.
3. If `recall` and `search` return the notes but not the answer вЂ” several notes bear
   on the question and they disagree, or the judgement spans them вЂ” use `reason`.

At a meaningful stopping point, before the context is lost:

4. Call `record_work`. Fill `changes`, `decisions`, `learned`, `verification` and
   `open`. A future session cannot reconstruct these from the diff, and a sparse
   record is near-worthless six weeks later, which is when it gets read.
5. If something you learned would still be true in a **different** repository, call
   `remember`. That is the test. A log of what you did today is `record_work`, not a
   memory вЂ” a memory store filling with status updates is worse than an empty one.
6. Say so if the status note is now out of date. It is the file that answers "where
   did we stop", and it is only worth reading if it is current.

If something you expect to be in the vault cannot be found, call `health` before
concluding it is not there. Every failure in this layer вЂ” a missing index, a
misconfigured root, an unresolved caller identity вЂ” presents identically as "no
results", and `health` is what distinguishes them.

Never write vault paths, vault contents, or session URLs into commits, PR
descriptions, or code comments in this repository.

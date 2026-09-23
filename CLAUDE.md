# CLAUDE.md

Guidance for Claude Code in this repository. This file is a **map of rules in force**. Why each rule exists, with dates and incidents, lives in [docs/history.md](docs/history.md) (the former CLAUDE.md, moved unchanged on 2026-09-22). If this map and the code disagree, the code wins; fix the map.

## Project

`book-forge` — single-user, local-first AI-assisted novel-writing tool. Russian-language MVP. pnpm workspaces monorepo, Node 22+ (проверено на 24), ESM only, TypeScript strict (`noUncheckedIndexedAccess`).

`better-sqlite3` — единственная нативная зависимость, `^12.11.1` (есть сборки до Node 26). Если `pnpm install` уходит в node-gyp, значит `prebuild-install` не достучался до GitHub. Положите сборку `better-sqlite3-v<версия>-node-v<ABI>-win32-x64.tar.gz` в `node_modules/.pnpm/better-sqlite3@<версия>/node_modules/better-sqlite3/build/Release/`; ABI — `node -p process.versions.modules`.

## Commands

Run from repo root unless noted.

```bash
pnpm install
pnpm migrate                # apply SQLite migrations to data/db.sqlite (server also runs them on start)
pnpm dev                    # server :3001 + web :5173 in parallel
pnpm dev:server | dev:web
pnpm typecheck              # tsc across all packages
pnpm test                   # vitest across all packages
pnpm build
pnpm --filter @book-forge/server test -- src/routes/__tests__/studio.test.ts   # one file
pnpm --filter @book-forge/server recompute-text   # rebuild content_text from content_json (backs up DB first)
```

Migrations are **hand-written plain SQL** — the official process. Drizzle-kit snapshots are broken since 0008; never use `drizzle:generate`.
1. Scaffold: `pnpm --filter @book-forge/server drizzle:new <name>` (creates the `.sql` + the journal entry).
2. Write the SQL.
3. Update `schema.ts` for types.
4. Run `pnpm migrate`. It backs up the DB (`VACUUM INTO` → `data/backups/`, last 10).

SQLite cannot change a `CHECK` via `ALTER TABLE`; adding a value means recreating the table. Details: [docs/migrations.md](docs/migrations.md).

Env: `apps/server/.env` holds `ANTHROPIC_API_KEY` (gitignored). Server reads `PORT`, `DB_PATH`. Web reads `VITE_API_BASE_URL`.

Shell gotcha (Windows Git Bash): python/node heredocs expand `\n` inside string literals. Edit TS string literals and regexes containing `\n`/`\s` with the Edit tool.

## Architecture

- `apps/server` — Hono, one `better-sqlite3` connection (WAL, optional `sqlite-vec`), direct SQL (Drizzle is schema-only). Routes under `/api`.
- `apps/web` — React 18 + Vite 6 + Tailwind v4 + TipTap.
- `packages/shared` — zod schemas and pure functions shared by server and browser. No `node:*` imports.
- `packages/agents` — agents and their contracts.
- `packages/llm` — dispatcher and backends.
- `packages/retrieval` — hybrid search and embeddings.
- `packages/style-engine` — style fingerprint and prose tells.

Imports between packages go only through `workspace:*` and `exports`, never into another package's `src/`.

**LLM.** Every structured agent registers an `AgentStructuredContract`, and `dispatchStructured` routes it to the direct API or to the subscription (`claude-agent-sdk` + mcp submit tool).

Adding an agent takes three steps:
1. Add the name to `AGENT_NAMES`/`STRUCTURED_AGENT_NAMES` ([types.ts](packages/llm/src/types.ts)).
2. Write the contract.
3. Register it in [bootstrap.ts](packages/agents/src/bootstrap.ts). A drift-guard test enforces parity.

`style_extractor`/`style_blender` register separately in [index.ts](apps/server/src/index.ts). Each agent's backend comes from `DEFAULT_AGENT_BACKEND` ([router.ts](packages/llm/src/router.ts)) — look it up, never infer it from a neighbour. Model ids come only from `MODEL_IDS` ([pricing.ts](packages/shared/src/pricing.ts)). **Opus does not accept `temperature`**: pass it conditionally.

**Studio** (`/books/:id/studio`): 7 stages — concept, world, lore, characters, items, plot, chapters. State lives in `books.studio_state` (JSON). Any PATCH needs `expectedRevision`; a mismatch is 409. Hard invariants: [studio-invariants.ts](packages/shared/src/studio-invariants.ts). Stage status is derived by `deriveStageStatus`; only the author's explicit button sets `skipped`.
- Concept: `IdeaIntake` → `PitchBoard` → `ConceptCard`; the stage is ready when `concept.lockedAt` is set.
- World/lore are document stages: `aspect_document` assembles the whole document in one call ([document.ts](packages/agents/src/aspects/document.ts)).
- Characters/items: `entity_set` → materialization into `characters`/`items`.
- Plot: variants in `books.outline_json`; approval goes through [plan-approve.ts](apps/server/src/utils/plan-approve.ts).

**Generation context** is built by one function for Writer, the critics and the Reviser: [`assembleGenerationContext`](apps/server/src/utils/generation-context.ts). Roles differ only in presentation — what they scan, how they search, how many style samples they get. They share history, participants, facts, budget and source refs. Other pieces:
- Budget: `compileContext` with `MAX_PROSE_CONTEXT_TOKENS`. The character-cards layer is required; if it overflows, generation answers 400 before the first token.
- Memory queue: `memory_jobs` ([memory-queue.ts](apps/server/src/utils/memory-queue.ts)). Activation of a version is one transaction ([memory-activation.ts](apps/server/src/utils/memory-activation.ts)).

**DB**: one SQLite file, JSON columns stored as TEXT.

## Invariants — do not break

**The author decides.**
- Nothing becomes canon without the author. Aspects arrive `reviewing`; entities arrive `proposed`; prose is a *proposal* (`prose_proposals`) until `acceptProposal` ([prose-proposals.ts](apps/server/src/utils/prose-proposals.ts)).
- Chapters from material intake land as a **draft** (`chapter_drafts`, `insertChapters(..., { asDraft: true })`): no version, no search, no memory until the author saves. Quick start creates no chapters and approves nothing.
- Intake persists each classifier answer at once (`intake_classifications`, keyed by book + `intakeFileKey`) and drops it after landing + journal. A crash mid-run must not cost a second paid call. Undelivered chapters/plans are kept in the journal (`undelivered`) and redelivered on re-drop.
- Author text becomes a version before anything replaces it (`preserveDraftAsVersion`, [chapter-drafts.ts](apps/server/src/utils/chapter-drafts.ts)).
- Partial accept is three-way (`mergeSelectedOntoDraft`, [prose-diff.ts](packages/shared/src/prose-diff.ts)). If a selected change overlaps the author's draft edit: 409 `overlap`.
- Undo of an accepted canon candidate deletes only `createdEntityId`, and refuses (409) if the card was edited since.
- Rebuilding memory deletes only machine rows (`origin` `extracted`/`llm`, scene state not `manual`).
- Materialization merges the profile (`mergeCharacterProfile`, `normalizeItemProfile`); it never replaces it.
- Plan variants are added through `mergeOutlineVariants` ([plot.ts](packages/shared/src/plot.ts)): the selected and author variants are never evicted, and the selection follows the variant, not the index.

**Concurrency: the author names what they saw.**
- CAS everywhere:
  - `studio_state.revision`;
  - `characters`/`relationships` `expectedRevision` (required);
  - proposals `expectedVersionId` + `expectedDraftRevision`;
  - scene state `expectedVersionId` + `expectedUpdatedAt`;
  - repair with selected issues needs `reportId` (409 `report_changed`).
- Long-running writers re-read before writing (concept, studio state, outline) and write only their own field.

**Chapter boundaries and memory.**
- A scene boundary is **exclusive**: character events, hooks (`seed.order_index < N`) and scene state. Retrieval uses the inclusive `beforeChapterOrder = order - 1`. Do not mix them up.
- All boundary SQL for events lives in [character-events.ts](apps/server/src/utils/character-events.ts). For scene state it is [scene-state.ts](apps/server/src/utils/scene-state.ts). Never add a second copy.
- `order_index` is sparse (step 10). Positions and distances go through `chapterPositionLookup`. Order changes only via `POST /books/:id/chapters/reorder` ([chapter-reorder.ts](apps/server/src/utils/chapter-reorder.ts)), which moves every denormalized copy.
- A chapter's memory is the memory of its **current** version. Activation drops machine facts, notes and events of other versions (`dropOtherVersionsMemory`), but keeps author-confirmed events.
- Events need a verbatim quote, and the server locates it (`locateEvidence`). An ambiguous name or quote is rejected, never guessed (`resolveEntity` returns `null` for namesakes).
- `fresh` must not hide losses: `chapterMemoryStatus` reports `skipped`, `malformed`, `events` and `eventsError`.
- The retrieval index (`indexed_version_id`) is separate from derived memory (`memory_version_id`).

**Generation.**
- Manifest source refs ([context-manifests.ts](apps/server/src/utils/context-manifests.ts)) are computed from the book's base at the boundary, not from what reached the cards. Writer and critic must produce identical refs for the same base. Changing the refs' composition means bumping `CONTEXT_PROMPT_VERSION`.
- The prompt text is not stored (author decision 2026-09-19).
- Style few-shot and voice samples are chosen deterministically, never `ORDER BY random()`: they sit in the cached prefix.
- The chapter contract beats the beat sheet and the critics' remarks. Scene intent never overrides the contract.
- A late model response after cancel is never written: proposals only from `streaming`, scene intent via `shouldPersist`.
- Live runs send a heartbeat (`touchProposal`). A proposal with no heartbeat for 2 min is dead (`recoverStaleProseProposals`, at startup and every minute).
- Critics: set in `ALL_CRITIC_TYPES`. Usage goes through `reportCriticUsage`. A skipped critic is listed in `skippedCritics`.
- The style critic runs the general pass plus `critic_style_phrase` ([style-phrase.ts](packages/agents/src/critics/style-phrase.ts)) over ~6000-char chunks of whole paragraphs; one report `style`, each issue carries `origin`. The phrase pass quotes and names a reason, never rewrites; a failed chunk is retried once and then reported in `overallNotes`. Rules for single phrases go to the phrase pass, not into the general prompt: the general critic stops at 3–5 issues per scene.
- Repair never sends `style_phrase` issues to the Reviser. They go to `editor_phrase` ([phrase-fix.ts](packages/agents/src/phrase-fix.ts)): the model returns `before`/`after`, and `applyPhraseFixes` substitutes in code only a unique `before` that contains the quote, is at most one sentence longer and does not touch a protected fragment. With no other selected issues the Reviser is not called. `critic_style_phrase` and `editor_phrase` inherit the backend of `critic_style` / `editor`.
- Prose rules must agree along the whole chain: plan → Writer → critics → Reviser. Context: [docs/prompts/agents-2026-09-23.md](docs/prompts/agents-2026-09-23.md).
  - The Writer's style block is replaced as a whole, never appended to.
  - Beats are a suggestion; obligations live in the contract.
  - `closing.note` is a stop event, not a ready-made last line.
  - A beat without local conflict says so: «локального конфликта нет».
  - Critics judge a scene by its task. A missing hook or climax is not a defect.
  - Measured tell counts are evidence of repetition, never norms or severity thresholds.
  - Do not add quota rules for the Writer (e.g. "≤3 similes per 1000 words"): they become a new template.

**Subscription backend** ([mcp-submit-tool.ts](packages/llm/src/clients/mcp-submit-tool.ts)):
- Thinking is off, and `settingSources: []`.
- A timeout is `LLMTimeoutError` and is not retried; long agents set their own `timeoutMs`.
- `maxTokens` reaches the model only via `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
- A top-level field sent as a JSON string is unpacked and quote-repaired. If it cannot be parsed:
  - it becomes `[]` only when other fields survive, and that gets logged;
  - if every field is lost, the call fails.

**Text.**
- `extractText` separates blocks with `\n\n` and joins inline nodes without spaces ([prosemirror.ts](apps/server/src/utils/prosemirror.ts)).
- Regexes over Russian text never use `\b` or `lower()`; both are ASCII-only. Use `uRe` / `mentionsEntityName` ([entity-names.ts](packages/shared/src/entity-names.ts)).
- Shared prose rules live in [prose-rules.ts](packages/shared/src/prose-rules.ts). The de-AI layer is measured, not banned ([tells.ts](packages/style-engine/src/tells.ts), [docs/prose-tells-baseline.md](docs/prose-tells-baseline.md)).

**Schemas.**
- Read schemas are lenient; write schemas are strict. Examples: `characterProfileV2Schema` vs `characterProfileWriteSchema`, `normalizeItemProfile`, scene state.
- An LLM tool schema can require fields that storage keeps optional (`architecture`, `contract`, `closing`, `chapters`, `dialogueRegister`), so old rows still read.
- `.transform` never goes into a tool schema.
- Wire responses are not proven by TypeScript: normalize at the client boundary (e.g. `inflightOrNull`).

**`books.author_notes`** is read by no context assembly — a test enforces it. The characters' "eye" toggle (`hidden_from_prompts`) filters only in `gatherCharacterContext`.

## Locked decisions

Stored in `~/.claude/projects/d--PROJECTS-BOOKOPIS/memory/`.
- Hybrid per-agent backend router. "Subscription = free" is an **unverified** assumption of the usage tracker.
- Per-book model switcher (`books.writer_model/plot_model/critic_model`).
- MVP: Russian only, manual self-repair, full critique.
- **Desktop only.** Mobile layout is not a bug and not a task (locked 2026-07-31).
- Out of scope (do not propose): Obsidian/MCP file-watcher, branching UI, ESLint/Prettier/Husky/Docker/CI, multi-user auth, second language, mobile/adaptive layout.
- Tests mock LLM calls (`vi.mock("@book-forge/agents/...")`). A test that pins current behaviour can pin a defect: when fixing one, rewrite such a test and say so in the commit.

## Frontend

React 18 + Vite 6 + Tailwind v4, CSS-first. Tokens live in the `@theme` block of `apps/web/src/index.css` and in `library-warm.css :root`; the palette is «Чернильная ночь». Components:
- shadcn/ui as source-in-repo;
- TipTap editor;
- `react-router-dom@7`. `useBlocker` needs a data router.

Rooms:
- Library — the bookshelf, [shelf.ts](apps/web/src/lib/shelf.ts).
- Cabinet — `ChapterPage`, three columns; every side panel has its own error boundary.
- Workshop — Studio.
- Plot board — `/books/:id/board`, read-only over `book_notes`.

Atmosphere classes `atm-full|atm-calm|atm-off` come from [useAtmosphere](apps/web/src/lib/useAtmosphere.ts).

SSE is read only through [`consumeSse`](apps/web/src/api/sse.ts). A stream that ends without its terminal event becomes `onError`. Servers send `ping` every 20 s.

## Project memory

This repository has a persistent memory in an Obsidian vault, reached through the `om` MCP server. **Consult it before substantive work.**

1. `recall` with no query first.
2. Read `projects/<this-repo>/README.md` via `search` or `vault://`. It is the current status.
3. If notes disagree, use `reason`.

At a stopping point:

4. `record_work`, with `changes`, `decisions`, `learned`, `verification` and `open`.
5. `remember` only lessons that hold in a different repository.
6. Say if the status note is stale.

If something expected is missing, call `health` before concluding it is not there. Never write vault paths, vault contents or session URLs into commits, PR descriptions or code comments.

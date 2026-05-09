# ADR 0001 — Stack and Repository Structure

- **Status:** Accepted
- **Date:** 2026-05-08
- **Codename:** book-forge

## Context

book-forge is a single-user, local-first AI-assisted novel-writing tool. The MVP targets Russian-language fiction, with Aleksey Pekhov as the first style reference. The eventual architecture is an 8-agent pipeline (Plot, Lore, Character, Writer + 4 critics) coordinated by LangGraph and persisted in SQLite. This ADR captures the stack and repo layout chosen at bootstrap time, before any business logic is written.

## Decision

### Runtime / Language

- **Node.js 22 LTS** — long-term support window covers the planned MVP horizon; native ESM is mature.
- **TypeScript** with strict mode, `noUncheckedIndexedAccess`, and `moduleResolution: NodeNext`. ESM only across the entire workspace.

### Repository Layout

A **pnpm workspaces monorepo** with two app folders (`apps/server`, `apps/web`) and five reserved package folders (`packages/{shared,agents,llm,retrieval,style-engine}`). Inter-package imports use `workspace:*`.

Rationale:
- Server, web, and the future agent/LLM/retrieval/style modules will share Zod schemas and TypeScript types. A monorepo lets them be referenced directly without a publishing step.
- pnpm's content-addressable store and strict hoisting reduce phantom-dependency risk vs npm/yarn.
- Five empty packages exist so future commits can drop logic in without restructuring imports.

### Backend (`apps/server`)

| Concern         | Choice                                |
| --------------- | ------------------------------------- |
| HTTP framework  | **Hono** + `@hono/node-server`        |
| Validation      | **Zod**                               |
| ORM             | **Drizzle ORM**                       |
| Database driver | **better-sqlite3**                    |
| Migrations      | **drizzle-kit** (config + raw SQL bootstrap for the sentinel `_health` table) |
| Dev runner      | **tsx watch**                         |

Rationale:
- Hono is small, ESM-native, and has first-class type inference for routes — a better fit than Express for a TS-first single-binary app.
- Drizzle gives strict types over SQLite without an ORM heavyweight; its SQLite dialect supports the future FTS5 / sqlite-vec extensions cleanly.
- better-sqlite3 (synchronous, in-process) is the right tradeoff for a single-user local tool: zero network latency, no separate DB process to manage.

### Database

**SQLite**, single file at `data/db.sqlite`. WAL mode enabled at connection time. Path is configurable via `DB_PATH` env var.

Rationale:
- Single-user, local-first means a hosted DB would be overkill.
- SQLite supports the two extension points the project needs later: FTS5 (full-text retrieval) and sqlite-vec (embedding store). Switching engines later would force rewriting both retrieval paths.
- File-on-disk simplifies backup and snapshot semantics.

### Frontend (`apps/web`)

| Concern        | Choice                                     |
| -------------- | ------------------------------------------ |
| Bundler        | **Vite 6**                                 |
| Framework      | **React 18**                               |
| Styling        | **Tailwind CSS v4** via `@tailwindcss/vite` (CSS-first, no `tailwind.config.js`, no PostCSS file) |
| Component kit  | **shadcn/ui** (Slate palette) — only `Button` scaffolded so far |
| Editor         | **TipTap** with `@tiptap/starter-kit` (deps installed; not wired this session) |

Rationale:
- Tailwind v4's CSS-first model (`@import "tailwindcss"` + `@theme {}`) removes the JS config layer and works natively with Vite.
- shadcn/ui is component-as-source rather than dependency: the Button file lives in the repo and can be customized without forking.
- TipTap is the editor of record for the future writer surface; installing now avoids churn in the next session.

### Tooling

- **Vitest** for tests (zero files yet — `--passWithNoTests` keeps CI green at this stage).
- **concurrently** at the root to fan out `pnpm dev` to both apps.

## What Is Deferred

The following are **explicitly not** part of this session and will land later:

- LLM client (`@anthropic-ai/sdk`) and Anthropic prompts.
- LangGraph orchestration (`@langchain/langgraph`) and the SQLite checkpointer.
- The 8 agents (Plot, Lore, Character, Writer, 4 critics) and their state machines.
- Retrieval: FTS5 indices, sqlite-vec vector tables, embedding pipelines.
- Style engine: Pekhov reference corpus, style metrics, fingerprinting.
- Real domain schema (works, chapters, scenes, characters, lore entries) — only the `_health` sentinel table exists today.
- Auth, multi-user features (single-user local tool by design).
- ESLint, Prettier, Husky, lint-staged, Docker, CI — out of scope for bootstrap.

## Consequences

- Strict TS settings will surface type errors aggressively; future PRs must keep `noUncheckedIndexedAccess` clean.
- Drizzle migrations are the source of truth for schema; the bootstrap migration script in `apps/server/src/db/migrate.ts` is intentionally raw SQL because there is no Drizzle migration history yet.
- All inter-package imports go through `workspace:*` — packages must publish via their `exports` field, never reach into another package's internals.
- Tailwind v4 CSS-first means design tokens live in `apps/web/src/index.css` `@theme` block, not in JS.

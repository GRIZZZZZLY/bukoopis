# Book Forge

AI-assisted novel-writing tool. Single-user, local-first. Russian-language MVP.

> Status: skeleton only. No business logic, no LLM, no agents yet. See [ADR-0001](docs/adr/0001-stack-and-structure.md) for the full stack rationale and what is deferred.

## Stack

- Node.js 22 LTS, pnpm workspaces, TypeScript (strict, ESM)
- Server: Hono + Drizzle ORM + better-sqlite3
- Web: React 18 + Vite + Tailwind v4 + shadcn/ui + TipTap
- Tests: Vitest

## Setup

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
pnpm migrate     # creates data/db.sqlite with the _health sentinel table
```

## Run

```bash
pnpm dev         # starts server on :3001 and web on :5173 in parallel
```

Then open <http://localhost:5173> and click **Ping API**. The page should display:

```json
{ "status": "ok", "timestamp": "...", "db": "ok" }
```

You can also hit the API directly:

```bash
curl http://localhost:3001/api/health
```

## Scripts (root)

| Script            | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `pnpm dev`        | Run server + web concurrently                |
| `pnpm dev:server` | Run only the API on `:3001`                  |
| `pnpm dev:web`    | Run only the web app on `:5173`              |
| `pnpm migrate`    | Apply migrations and seed `_health`          |
| `pnpm typecheck`  | TS check across all packages                 |
| `pnpm test`       | Vitest across all packages (passes if empty) |
| `pnpm build`      | Build all packages                           |

## Environment

Server (`apps/server`):

- `PORT` — default `3001`
- `DB_PATH` — default `../../data/db.sqlite` (resolved from `apps/server` cwd)

Web (`apps/web`):

- `VITE_API_BASE_URL` — default `http://localhost:3001`

## Layout

```
book-forge/
├── apps/
│   ├── server/                 # Hono API
│   └── web/                    # React + Vite
├── packages/
│   ├── shared/                 # Zod schemas & shared types (placeholder)
│   ├── agents/                 # placeholder
│   ├── llm/                    # placeholder
│   ├── retrieval/              # placeholder
│   └── style-engine/           # placeholder
├── data/                       # db.sqlite lives here at runtime
└── docs/adr/                   # architecture decision records
```

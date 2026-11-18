# Local Model for the Workshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-book switch that sends the Workshop agents (concept, pitches, world/lore, characters/items, plot outline) to a local Ollama chat model, with a visible label on locally generated pitches and plan variants.

**Architecture:**
- New `books` columns hold the switch.
- `dispatchStructured` gets a `local` branch that calls Ollama `/api/chat` with a JSON-schema `format` and validates the reply with the same schema as the Claude paths.
- Studio/plot/quick-start call sites pass `local` from the book context. Routes stamp `generatedBy` on local pitches and variants, and the web shows it.

**Tech Stack:** TypeScript strict ESM, zod 4 (`z.toJSONSchema`), Hono, better-sqlite3, React 18, vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-local-studio-model-design.md`

## Global Constraints

- Agents on the switch:
  - `concept_refiner`, `pitch_generator`, `pitch_blender`;
  - `aspect_playbook`, `aspect_variants`, `aspect_refine`, `aspect_entity_variants`, `aspect_document`;
  - `plot_outline`.

  Nothing else goes local. In particular `plot_chapter_plan`, `scene_plan`, critics, memory and intake do not.
- Never fall back to Claude when `local` is set. An unusable model throws `LLMError`.
- `raw` model kind is refused with this message: «Модель <tag> умеет только продолжать прозу; мастерской нужна обычная чат-модель Ollama.» `unavailable` is refused with: «Локальная модель <tag> недоступна: запущена ли Ollama и есть ли такая модель?»
- Ollama request:
  - `stream: false`, `think: false`;
  - `options.num_ctx = 32768`;
  - `options.num_predict = maxTokens` when given;
  - `options.temperature` only when given.
- Timeout: `Math.max(input.timeoutMs ?? 0, 600_000)` ms. On timeout, throw `LLMTimeoutError` with no retry.
- Diagnostics `modelId: "ollama:<tag>"`, `backend: "api"`. Tokens come from `prompt_eval_count` / `eval_count`.
- Provenance field name is `generatedBy?: string`, value `ollama:<tag>`. Claude items are not stamped. Never put the field in an LLM tool schema.
- Migration is hand-written SQL via `pnpm --filter @book-forge/server drizzle:new local_studio_model`; never `drizzle:generate`.
- UI words go into `apps/web/src/lib/labels.ts`.
- Regexes over Russian text never use `\b`.

## Review Focus

1. A local model wraps JSON in ```` ```json ```` fences or adds text before it. Expected: fences are stripped and the object is parsed. Test in Task 2.
2. Ollama is not running, so `fetch` rejects with a `TypeError`. Expected: a readable `LLMError` naming the tag, not a raw `fetch failed`. Test in Task 2.
3. A book has the Writer on Ollama but the Workshop on Claude. Expected: studio calls carry no `local`. Test in Task 3.
4. A concept or outline stored before this change has no `generatedBy`. Expected: it reads as before, and no label is shown. Test in Task 4.
5. PATCH `studioProvider: "ollama"` while the stored `studio_local_model` is null and none is sent. Expected: 400. Test in Task 1.

---

### Task 1: Storage and book settings

**Files:**
- Create: `apps/server/drizzle/0036_local_studio_model.sql` (via `drizzle:new`)
- Modify:
  - `apps/server/src/db/schema.ts`;
  - `apps/server/src/db/rows.ts`;
  - `packages/shared/src/book.ts`;
  - `apps/server/src/routes/books.ts`;
  - `apps/server/src/utils/book-context.ts`.
- Test: `apps/server/src/routes/__tests__/books.test.ts`

**Interfaces:**
- Produces:
  - `Book.studioProvider: WriterProvider` (default `"anthropic"`);
  - `Book.studioLocalModel: string | null`;
  - `UpdateBookInput.studioProvider?` and `studioLocalModel?`, which reuse `writerProviderSchema` and `z.string().min(1).max(120).nullable()`;
  - `BookContext.studioProvider: "anthropic" | "ollama"` and `BookContext.studioLocalModel: string | null`.

- [ ] **Step 1: Write failing tests** in `books.test.ts`:
  - `PATCH studioProvider+studioLocalModel round-trips`: PATCH `{studioProvider:"ollama", studioLocalModel:"qwen:9b"}`, then GET returns both.
  - `PATCH studioProvider ollama without a model is 400`: book with null `studio_local_model`, PATCH `{studioProvider:"ollama"}` → 400.
  - `new book defaults studioProvider to anthropic`.
- [ ] **Step 2: Run** `pnpm --filter @book-forge/server test -- src/routes/__tests__/books.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The SQL:
  ```sql
  ALTER TABLE `books` ADD COLUMN `studio_provider` text NOT NULL DEFAULT 'anthropic' CHECK (`studio_provider` IN ('anthropic','ollama'));
  ALTER TABLE `books` ADD COLUMN `studio_local_model` text;
  ```
  The other changes:
  - mirror both columns in `schema.ts` and `rows.ts`;
  - add the fields to `bookSchema` and `updateBookInputSchema`;
  - in the PATCH handler, merge like `writerProvider`/`writerLocalModel` and return 400 when the effective provider is `ollama` and the effective model is null or blank;
  - expose both fields in `loadBookContext`.
- [ ] **Step 4: Run** the same test file. Expected: PASS. Then `pnpm migrate` on a copy, `DB_PATH=<copy> pnpm migrate`, and check that `PRAGMA table_info(books)` lists both columns.
- [ ] **Step 5: Commit** `feat(server): настройка книги «мастерская через локальную модель»`.

### Task 2: Ollama branch in the structured dispatcher

**Files:**
- Modify:
  - `packages/llm/src/ollama.ts`;
  - `packages/llm/src/dispatcher.ts`;
  - `packages/llm/src/types.ts`;
  - `packages/llm/src/index.ts`.
- Test: `packages/llm/src/__tests__/ollama-structured.test.ts` (new)

**Interfaces:**
- Produces:
  - `export interface LocalModelRef { model: string }` in `types.ts`, exported from the package index;
  - `DispatchStructuredInput.local?: LocalModelRef`;
  - `export async function chatStructuredOllama(opts: { tag: string; system: string; user: string; format: unknown; temperature?: number; maxTokens?: number; timeoutMs: number; baseUrl?: string }): Promise<{ content: string; promptTokens: number; outputTokens: number }>` in `ollama.ts`;
  - `export class OllamaHttpError extends LLMError { status: number }`.
- The transport maps the errors:
  - non-OK HTTP → `OllamaHttpError`;
  - abort on timeout → `LLMTimeoutError`;
  - a network `TypeError` → `LLMError` with the «недоступна» message.

- [ ] **Step 1: Write failing tests.** Mock `fetch` with `vi.stubGlobal`. `ollamaModelKind` is answered by the `/api/show` mock; call `resetRawTemplateCache()` in `beforeEach`. Tests:
  - `valid JSON reply → validated raw, diagnostics modelId "ollama:t", backend "api", tokens from prompt_eval_count/eval_count`;
  - `request body: format equals z.toJSONSchema(outputSchema), stream false, think false, options.num_ctx 32768, num_predict = maxTokens`;
  - `raw model is refused with "умеет только продолжать прозу" and /api/chat is never called`;
  - `unavailable model (404 on /api/show) is refused with "недоступна"`;
  - `fetch rejects (ECONNREFUSED) → LLMError containing the tag`;
  - `fenced reply "```json\n{...}\n```" parses`;
  - `invalid JSON then valid → second call's user message contains the parse error; result valid`;
  - `schema-invalid twice → LLMError containing first 300 chars of the reply`;
  - `HTTP 400 on format → retried once with format "json" and the JSON schema text in the system message`;
  - `timeout → LLMTimeoutError, exactly one /api/chat call`;
  - `no local → existing api/subscription path untouched`. The existing `dispatcher.test.ts` stays green.
- [ ] **Step 2: Run** `pnpm --filter @book-forge/llm test -- src/__tests__/ollama-structured.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `dispatchStructured`, branch first on `input.local`:
  1. Kind check.
  2. System text = `input.systemBlocks` texts joined with `"\n\n"`, else `contract.systemPrompt`. User = `contract.buildPrompt(payload)`.
  3. Call `chatStructuredOllama`.
  4. Strip a leading/trailing code fence. `JSON.parse`, then `outputSchema.safeParse`.
  5. On a parse or validation failure, retry once with the error appended to the user message.
  6. Emit `dispatch`, `tool_call`, `validated`.
  7. Call `onDiagnostics`.

  `input.model` is ignored on this branch.
- [ ] **Step 4: Run** the new test file and `pnpm --filter @book-forge/llm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(llm): структурные вызовы через локальную модель Ollama`.

### Task 3: Agents and call sites follow the book switch

**Files:**
- Modify:
  - the options types of `packages/agents/src/concept/{refiner,pitches,pitch-blend}.ts` and `packages/agents/src/aspects/{playbook,variants,refine,entity-variants,document}.ts`;
  - `GenerateBookOutlineInput` in `packages/agents/src/plot.ts`;
  - `apps/server/src/routes/studio.ts`;
  - `apps/server/src/routes/plot.ts` (book outline handler only);
  - `apps/server/src/utils/quick-start-run.ts`.
- Test:
  - `apps/server/src/routes/__tests__/studio.test.ts`;
  - `apps/server/src/routes/__tests__/plot.test.ts`;
  - one agent-level test in `packages/agents/src/concept/__tests__/` (or the existing pitches test file).

**Interfaces:**
- Consumes: `LocalModelRef`, `DispatchStructuredInput.local` (Task 2); `BookContext.studioProvider/studioLocalModel` (Task 1).
- Produces:
  - each `Run*Options` above gains `local?: LocalModelRef`, forwarded to `dispatchStructured`;
  - `GenerateBookOutlineInput.local?: LocalModelRef`;
  - server helper `export function studioLocal(ctx: BookContext): LocalModelRef | undefined` in `book-context.ts`. It returns `{ model }` only when `studioProvider === "ollama"` and the model is non-blank.

- [ ] **Step 1: Write failing tests:**
  - agent: `runPitchGenerator forwards local to dispatchStructured` (mock `@book-forge/llm`), including on the contrast retry call;
  - route: `pitches on a book with studio_provider ollama pass local {model:"qwen:9b"}` (mock `runPitchGenerator`);
  - route: `book with writer_provider ollama and studio_provider anthropic passes no local`;
  - plot: `book outline on a local book passes local into runBookPlanning input`;
  - one aspect route (`aspect_document`) passes `local`.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `local` to the options. In each agent's `dispatchStructured` call, spread `...(options.local ? { local: options.local } : {})`.
  - At every call site listed in the spec, pass `local: studioLocal(ctx)` (omit the key when it is undefined).
  - Quick start uses the same helper.
- [ ] **Step 4: Run** `pnpm --filter @book-forge/agents test` and `pnpm --filter @book-forge/server test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: задания мастерской идут в локальную модель по настройке книги`.

### Task 4: Provenance label on pitches and plan variants

**Files:**
- Modify:
  - `packages/shared/src/concept.ts` (`pitchSchema`);
  - `packages/shared/src/plot.ts` (`bookOutlineVariantSchema`);
  - `packages/agents/src/concept/pitches.ts` (`pitchDraftSchema`);
  - `packages/agents/src/plot.ts` (`bookOutlineToolSchema`);
  - the pitch-blend tool schema if it derives from `pitchSchema`;
  - `apps/server/src/routes/studio.ts` (after `toPitches` for generate and blend);
  - `apps/server/src/routes/plot.ts` and `apps/server/src/utils/quick-start-run.ts` (variants before `mergeOutlineVariants`);
  - `apps/web/src/components/studio/concept/PitchCard.tsx`;
  - the variant card in `apps/web/src/pages/PlanStagePage.tsx` / `apps/web/src/components/PlanPanel.tsx`;
  - `apps/web/src/lib/labels.ts`.
- Test:
  - `packages/shared/src/concept.test.ts`;
  - the plot schema test next to `plot.ts`;
  - `studio.test.ts`;
  - `PitchCard` test (create one if none).

**Interfaces:**
- Consumes: `studioLocal(ctx)` (Task 3).
- Produces:
  - `Pitch.generatedBy?: string` and `BookOutlineVariant.generatedBy?: string`;
  - `labels.ts`: `localModelBadge(tag: string): string`, which returns `«локальная: ${tag}»` without the guillemets, given `generatedBy` with the `ollama:` prefix stripped.

- [ ] **Step 1: Write failing tests:**
  - `pitchSchema accepts a pitch without generatedBy` (old rows) and one with it;
  - `z.toJSONSchema(pitchGeneratorOutputSchema)` and `z.toJSONSchema(bookOutlineToolSchema)` have no `generatedBy` property anywhere (stringify, then `not.toContain("generatedBy")`);
  - route: local book → every new pitch has `generatedBy: "ollama:qwen:9b"`; Claude book → no `generatedBy`;
  - `mergeOutlineVariants keeps generatedBy on merged variants`;
  - `PitchCard shows "локальная: qwen:9b" for a local pitch and no badge otherwise`.
- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add the optional field to both schemas.
  - `.omit({ generatedBy: true })` in the tool schemas.
  - Stamp in routes when `studioLocal(ctx)` is defined.
  - Render a small muted badge using the existing `.cap`/`muted` classes.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: метка «локальная» у питчей и вариантов плана`.

### Task 5: Settings UI

**Files:**
- Modify: `apps/web/src/pages/SettingsStagePage.tsx`, `apps/web/src/lib/labels.ts`
- Test: `apps/web/src/pages/SettingsStagePage.test.tsx`

**Interfaces:**
- Consumes: `Book.studioProvider/studioLocalModel`, `UpdateBookInput` (Task 1).

- [ ] **Step 1: Write failing tests:**
  - checkbox «Мастерская через локальную модель» unchecked for a default book;
  - checking it reveals a tag field;
  - save sends `{studioProvider:"ollama", studioLocalModel:"qwen:9b"}`;
  - unchecking sends `studioProvider:"anthropic"`;
  - save with the box checked and the tag empty is blocked with the hint visible.
- [ ] **Step 2: Run** `pnpm --filter @book-forge/web test -- src/pages/SettingsStagePage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add a block after the Writer local-model block. Hint text: «Нужна обычная чат-модель Ollama. Модель Писателя сюда не подходит: она умеет только продолжать прозу. Память, критики и план главы остаются на Claude.»
- [ ] **Step 4: Run** the test, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): переключатель локальной модели для мастерской в настройках книги`.

### Task 6: Live evidence and docs

**Files:**
- Modify: `CLAUDE.md` (one line under Architecture/LLM: «Мастерская по настройке книги (`studio_provider`) идёт в локальную чат-модель через `dispatchStructured({ local })`; список агентов — в спеке 2026-11-18»).

- [ ] **Step 1: Live run on a DB copy.**
  1. Copy `data/db.sqlite` to the scratchpad.
  2. Run `DB_PATH=<copy> PORT=3101 pnpm dev:server`.
  3. PATCH book 4 with `{studioProvider:"ollama", studioLocalModel:"deepseek-v4-pro-qwen35-9b-heretic:latest"}`.
  4. POST `/api/books/4/concept/pitches`.

  Expected: 200, new pitches carry `generatedBy`. If it fails, record the error as the outcome.

  Repeat the PATCH with `bookforge-writer:run3`. Expected: 500 with «умеет только продолжать прозу».

  Save the pitches JSON and timings to the report. The source DB sha256 must be unchanged.
- [ ] **Step 2: Run** `pnpm typecheck && pnpm test && pnpm check:outgoing`. Expected: all green.
- [ ] **Step 3: Commit** `docs: локальная модель мастерской в карте правил` together with the spec and this plan.

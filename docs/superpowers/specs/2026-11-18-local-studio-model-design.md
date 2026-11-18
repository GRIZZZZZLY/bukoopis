# Local model for the Workshop: per-book switch

The author asked on 2026-11-18 for a way to run the Workshop stages through a local Ollama model, so the results can be compared with Claude on the same book.

## Why

The local fine-tuned Writer (`bookforge-writer:run3`) already writes prose. Every stage before prose still calls Claude:
- concept and pitches;
- world and lore;
- characters and items;
- the plot.

The author wants to see whether a free local model is good enough there. The method is to generate a batch with Claude, flip the switch, generate a batch locally, and read both. Pitches and plan variants already accumulate, so both batches sit side by side.

## Goals

- One per-book setting: «Мастерская через локальную модель» plus the model tag. Off by default.
- When it is on, the Workshop agents of that book go to Ollama. They use:
  - the same contracts: system prompt, user prompt, output schema;
  - the same post-validation as the Claude paths.
- An unusable model is refused with a reason the author can read. Claude is never used in its place silently. "Unusable" means:
  - a raw-template model such as `bookforge-writer:run3`;
  - a tag that does not exist;
  - Ollama is down.
- Local calls are logged at zero cost. Model ids start with `ollama:`, which `getModelRates` already prices at zero.

## Non-goals

- Memory, critics, intake and classification, canon extraction, chat, scene plan, scene intent, cast check: they stay on Claude whatever the switch says. Broken memory would degrade everything downstream, and nobody asked for it.
- `plot_chapter_plan` (chapter plan on the chapter page) stays on Claude. It binds the Writer through the chapter contract. Comparing it is a separate step. *(my call)*
- Per-stage switches. The author chose one switch for the whole Workshop.
- Global or env-only configuration. The author chose a per-book UI switch.
- Picking or downloading models for the author. They type the tag. Downloads need their permission anyway.

## Anti-goals

- The switch quietly falling back to Claude. The comparison would then be a lie.
- Local output that skips validation and lands malformed rows in `studio_state` or `outline_json`.
- Breaking the existing Writer local path: `writer_provider` / `writer_local_model` stay as they are.

## Approaches considered

1. **A local branch in `dispatchStructured`, driven by a per-book setting (chosen).** New columns on `books`. Studio routes pass the local model down to the agents. The dispatcher calls Ollama `/api/chat` with a JSON-schema `format`. Cost: a migration, a dispatcher branch, plumbing in about 15 call sites, and a settings field.
2. **Env map (`LLM_AGENT_BACKEND_MAP` with `ollama:<tag>`).** Cheaper: no migration, no UI. Rejected because it is global, needs a restart, and the author asked for a switch in the app.
3. **A third value «локальная» in `plotModel`.** Rejected: `plotModel` is read by plot and scene-plan code that expects only `sonnet`/`opus`.

## Design

### Storage
Migration `0036`, hand-written plain SQL per CLAUDE.md:
- `books.studio_provider TEXT NOT NULL DEFAULT 'anthropic'`, values `anthropic | ollama`;
- `books.studio_local_model TEXT` (nullable).

The values reuse `writerProviderSchema`. Book read/update schemas in `packages/shared/src/book.ts` gain `studioProvider` and `studioLocalModel`. The rules mirror the writer pair: `studioLocalModel` is required when the provider is `ollama`; the server returns 400 otherwise.

The writer's local tag is not reused. The Writer needs a raw prose model and the Workshop needs a chat model, so one field cannot serve both.

### Dispatcher
`DispatchStructuredInput` gains `local?: { model: string }`. When it is present:

1. Run `ollamaModelKind(tag)`:
   - `raw` → throw `LLMError`, «модель … умеет только продолжать прозу, заданиям мастерской нужна обычная чат-модель»;
   - `unavailable` → throw `LLMError` with the tag and a hint that Ollama must be running.

   Both reach the author through the existing studio error surface.
2. POST `/api/chat` with:
   - `messages`: [system = the contract's system prompt (or `systemBlocks` text joined), user = `contract.buildPrompt(payload)`];
   - `format`: `z.toJSONSchema(outputSchema)`;
   - `stream: false`;
   - `think: false`;
   - `options`: { `temperature` when given, `num_ctx` large enough for the prompt plus `maxTokens`, `num_predict` = `maxTokens` }.

   `num_ctx` matters: Ollama's default context silently truncates our long system prompts.
3. Parse `message.content` as JSON, then `outputSchema.safeParse`. On a parse or validation failure, retry once with the validation error appended to the user message. If that fails too, throw `LLMError` with the first ~300 chars of the reply.
4. Diagnostics:
   - `modelId: "ollama:<tag>"`;
   - `backend: "api"`, since `effectiveBackend` already maps ollama to api;
   - tokens from `prompt_eval_count` / `eval_count`;
   - `onProgress` emits `dispatch`, `tool_call` and `validated` like the API path.
5. `timeoutMs` is honoured through `AbortSignal.timeout`, and a timeout is `LLMTimeoutError` (no retry), matching the subscription rule. Local 9B models are slow, so the default is generous: 10 min.

The Ollama call lives in `packages/llm/src/ollama.ts` next to the existing client and reuses `resolveBaseUrl`.

### Agents and routes
The Workshop agents:
- `concept_refiner`, `pitch_generator`, `pitch_blender`;
- `aspect_playbook`, `aspect_variants`, `aspect_refine`, `aspect_entity_variants`, `aspect_document`;
- `plot_outline` (via `runBookPlanning`).

Each agent's run options accept `local?: { model: string }` and forward it to `dispatchStructured`.

`loadBookContext` exposes `studioProvider` / `studioLocalModel`. Every call site of those agents passes `local` when the book's studio provider is `ollama`:
- `routes/studio.ts`;
- `routes/plot.ts` (book outline only);
- `utils/quick-start-run.ts`.

Quick start follows the switch too *(my call: same book, same setting)*. Usage logging is unchanged; it already takes `usage.modelId`.

### Settings UI
In `SettingsStagePage`, a block next to the existing Writer local-model block:
- a checkbox «Мастерская через локальную модель»;
- a text field for the tag, with the hint «нужна обычная чат-модель Ollama, например qwen; модель Писателя сюда не подходит».

UI words go into `labels.ts`. The cost estimate is unaffected, since it covers chapters only.

### Provenance label (author decision 2026-11-18)
Each pitch and each plot-outline variant generated locally records which model produced it. The field is optional: `generatedBy?: string`, value `ollama:<tag>`. The name `source` was not usable: outline variants already have `source` (`llm | author_material`). Claude items are not stamped *(my call: no label is shown for them anyway)*. Rules:
- The read schemas stay lenient, so old rows without the field still read.
- `mergeOutlineVariants` keeps the field as is, since it moves whole objects.
- The field is not part of any LLM tool schema: it is omitted from `pitchDraftSchema` and `bookOutlineToolSchema`, and the server stamps it after validation.

The Pitch board and the plan variant cards show a small label «локальная: <tag>» on local items. Claude items show no label. The label is not a ranking.

World and lore documents, characters and items do not get the label. They replace each other per aspect and are not compared side by side. *(my call)*

### Language rule
Local output does not pass the language guard. The guard checks prompts, not replies, and the prompts are unchanged. Nothing to do.

## Tests (proof)

- Dispatcher with `fetch` mocked:
  - success path validates and returns diagnostics `ollama:<tag>`;
  - `raw` refused;
  - `unavailable` refused;
  - invalid JSON is retried once, then the error is thrown;
  - schema-invalid reply is retried once;
  - timeout gives `LLMTimeoutError`;
  - `format` carries the contract's JSON schema;
  - `num_ctx` is set.
- Route-level: a book with `studio_provider = 'ollama'` passes `local` to `runPitchGenerator`; with `anthropic` it does not. Agent modules are mocked as usual.
- Book PATCH: `ollama` without a tag gives 400; round-trip of both fields works.
- Migration applies on a copy of the real DB.
- **Live evidence (REVIEW.md rule):** one real pitch batch through `deepseek-v4-pro-qwen35-9b-heretic` on a DB copy, output quoted in the PR or report. Without it the feature is not done. Whether the quality is good is the author's judgement, not a pass condition.

## Settled after the builder check

- **One call per agent.** Each listed agent makes exactly one `dispatchStructured` call. `runBookPlanning` is a one-node graph around `generateBookOutline`. So a book on the local switch is never half-local inside one action.
- **Agent-level post-processing is shared automatically.** Examples are the pitch contrast retry and normalizers. They run in agent code after `dispatchStructured` returns, so the local path gets them without changes. The dispatcher-level gate is `outputSchema.safeParse`, the same as on the API path.
- **`model` stays required** in `DispatchStructuredInput` and is ignored when `local` is set. `plot_model` therefore does not apply to `plot_outline` on a local book. *(my call: smallest type change)*
- **Schema that Ollama refuses** (HTTP 400 on `format`): retry once with `format: "json"` and the JSON schema appended to the system prompt; `safeParse` stays the gate. *(my call)*
- **Concurrency:** Ollama queues requests itself, so nothing is serialized on our side. Cancellation: today no backend aborts a structured call, and the local path does not add it. The existing CAS on `studio_state` / outline protects against late writes. *(my call)*
- **Model kind:** `ollamaModelKind` calls a model `raw` only when its template is exactly `{{ .Prompt }}`. The heretic tag has a Jinja chat template, so it counts as `chat`. The base URL comes from the same `resolveBaseUrl` the Writer uses.

## Left to the builder

- Exact `num_ctx` value. Use a reasonable fixed number (for example 32768) or estimate it from prompt length.
- Whether `systemBlocks` (cache-split prompts) are joined with blank lines.
- Exact wording of refusal messages, within the meaning above.

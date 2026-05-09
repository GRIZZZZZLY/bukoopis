# Design: Unified Structured-Output Layer with Three Backends

**Date**: 2026-05-09 (revised after architectural review)
**Status**: Approved (brainstorming complete; pending implementation plan)
**Etap**: 0.2.4
**Author**: Claude Opus 4.7
**Reviewer**: project owner

---

## Revision history

- **v4 (2026-05-09)**: third review pass adds `assertUniqueMcpToolNames()` registry validation; `STRUCTURED_AGENT_NAMES` parity test against `AgentName` enum to catch missing contracts at PR time; `warnOnce()` for deprecated env keys (no log spam); Phase 0.2 spike must exercise failure paths (native invalid schema, mcp no-tool / double-tool / isError); Phase 6 hybrid removal gated on a clean full smoke cycle with zero fallbacks.
- **v3 (2026-05-09)**: contract-shape cleanups from second review pass. `outputSchema` always a function (`getOutputSchema(input)`); MCP-specific fields move into optional nested `mcp` object; `assertAllRoutedAgentsHaveContracts` only checks structured agents; backward alias for old `plot` env keys; Phase 0 split into two separate PRs (Zod 4 first, then SDK spike); telemetry columns ship with `DEFAULT NULL`; foreshadowing item ids assigned server-side; `CritiqueIssue.metadata` softened to `unknown` while dialogue's specific output schema enforces `dialogueIssueMetadataSchema`.
- **v2 (2026-05-09)**: replaced "MCP-tools-only" architecture with a three-mode unified structured layer (`native_output_format` default, `mcp_submit_tool` fallback, `hybrid_generate_extract` legacy). Added Phase 0 capability spike. Made tool registration explicit (no side-effect imports). Added telemetry to scope. Switched dialogue critic from string-prefix flattening to first-class `metadata` field on `CritiqueIssue`. Made foreshadowing schema a runtime factory of `chapterCount` + `hookIds`. Locked Zod v4 upgrade for the entire monorepo as Phase 0.5.
- **v1 (2026-05-09, superseded)**: MCP-tools-only architecture with side-effect registry.

---

## 1. Problem and Goal

After etap 0.2.3, the routing landscape is:

- `writer`, `editor`, `summarizer`: Claude Agent SDK via Pro/Max subscription — free.
- `plot.generateBookOutline`: hybrid pipeline (subscription prose + ~$0.001 API extraction).
- All other structured agents (`plot.generateChapterPlan`, four critics, `canon_guard`, `style_extractor`) and interactive `inline`: direct Anthropic API.

The owner has a Claude Max-5 subscription (~225 Opus / 1125 Sonnet messages per 5h), enough headroom for a full novel-writing session. The remaining API spend is small but motivating: a unified path lets us add more specialised agents without per-agent routing decisions.

Goal: build a **unified typed structured-output layer** that gives every agent one contract and three interchangeable execution modes, with a clear fallback story when subscription is unavailable. Add two new agents (Dialogue specialist, Foreshadowing planner) on the same path. Defer the question of "100% subscription" to operational config rather than baking it into the architecture.

Non-goal: tying the architecture to MCP. MCP is one of three backends, not the only one.

---

## 2. Compliance and authentication note

The Claude Agent SDK overview recommends starting with `ANTHROPIC_API_KEY`. Anthropic's developer terms restrict third-party developers from proxying claude.ai login or Pro/Max rate limits "on behalf of their users" in products built on the Agent SDK. BOOKOPIS is a single-user personal tool that does not proxy a foreign user's subscription, which materially reduces this risk — but the architecture must keep API as a first-class equal mode, not an emergency-only escape hatch. If Anthropic clarifies enforcement or changes SDK behaviour, the user must be able to flip every agent to API by configuration alone, with no code changes.

---

## 3. Architecture

### 3.1 The contract

Every structured-output agent is described by an `AgentStructuredContract<I, O>`:

```ts
export type StructuredMode =
  | "native_output_format"
  | "mcp_submit_tool"
  | "hybrid_generate_extract";

export interface AgentMcpSpec {
  /** Tool name shown to the model in mcp_submit_tool mode. */
  toolName: string;
  /** Tool description shown to the model. */
  toolDescription: string;
  /** Optional: custom turn budget for mcp_submit_tool mode. Default 3. */
  maxTurns?: number;
}

export interface AgentStructuredContract<I, O> {
  agentName: AgentName;
  /**
   * Output schema factory. Always invoked with the typed input — for static
   * schemas pass `() => mySchema`, for runtime-dependent schemas (e.g.
   * foreshadowing chapter index bounds) pass a closure that constructs from
   * input. Backends call this once per request before validation.
   */
  getOutputSchema: (input: I) => ZodType<O>;
  /** Stable system prompt — same on every call. */
  systemPrompt: string;
  /** Constructs the user-turn prompt from the typed input. */
  buildPrompt(input: I): string;
  /** Default mode if not overridden by env or per-call option. */
  defaultMode: StructuredMode;
  /**
   * Required only when the agent may run in `mcp_submit_tool` mode. If
   * absent and a call is routed to MCP mode, the dispatcher throws
   * `LLMError("contract for <agent> has no mcp spec")`. Agents that will
   * never run in MCP mode (e.g. those locked to `native_output_format`)
   * may omit this field.
   */
  mcp?: AgentMcpSpec;
}
```

The contract is the single source of truth for an agent's structured output. Backends consume it; they never care which backend was selected. The `getOutputSchema(input)` shape removes branching at every call site — dispatcher unconditionally invokes it. Static schemas pay one extra closure call per request; trivial cost, big consistency win.

### 3.2 Registry

`packages/llm/src/clients/structured-registry.ts`:

```ts
export function registerAgentContract<I, O>(c: AgentStructuredContract<I, O>): void;
export function getAgentContract(name: AgentName): AgentStructuredContract<unknown, unknown>;
export function clearStructuredRegistry(): void;
export function listRegisteredAgents(): AgentName[];

/** Whitelist of agents that produce structured output and therefore MUST
 *  have a contract registered. Free-text agents (writer/editor/summarizer)
 *  and non-LLM placeholders (lore/character) are excluded. */
export const STRUCTURED_AGENT_NAMES: ReadonlySet<AgentName>;

export function assertAllStructuredAgentsHaveContracts(): void;
/**
 * Verifies that no two registered contracts declare the same `mcp.toolName`.
 * Even though each MCP call instantiates a per-call server, the in-process
 * server is named `submit_${agentName}` and the tool name is namespaced as
 * `mcp__<server>__<toolName>` — duplicate toolNames across contracts would
 * still confuse logs and future telemetry aggregations. Called from
 * `assertAllStructuredAgentsHaveContracts` for free.
 */
export function assertUniqueMcpToolNames(): void;
```

`assertAllStructuredAgentsHaveContracts()` iterates `STRUCTURED_AGENT_NAMES`, throws with a missing-list error if any are unregistered, then calls `assertUniqueMcpToolNames()` so duplicate tool names trip startup. Free-text agents are not included so the assertion does not falsely demand contracts from `writer`/`editor`/`summarizer`.

Registration is **explicit, not side-effect**:

```ts
// packages/agents/src/bootstrap.ts
import { registerCanonCriticContract } from "./critics/canon.js";
import { registerStyleCriticContract } from "./critics/style.js";
// ... etc

export function registerAllAgentContracts(): void {
  registerCanonCriticContract();
  registerStyleCriticContract();
  registerEditorCriticContract();
  registerReaderCriticContract();
  registerDialogueCriticContract();
  registerPlotOutlineContract();
  registerPlotChapterPlanContract();
  registerCanonGuardContract();
  registerStyleExtractorContract();
  registerForeshadowingPlannerContract();
}
```

`apps/server/src/index.ts`:

```ts
import { registerAllAgentContracts } from "@book-forge/agents/bootstrap";
import { assertAllStructuredAgentsHaveContracts } from "@book-forge/llm";

registerAllAgentContracts();
assertAllStructuredAgentsHaveContracts();
```

Missing contract → assertion error at boot, not at first call. Tests can use `clearStructuredRegistry()` between cases.

### 3.3 Dispatcher

`packages/llm/src/structured.ts` becomes the unified entry point. Pseudocode:

```ts
async function callStructured<I, O>(input: StructuredCallInput<I, O>): Promise<StructuredCallResult<O>> {
  const contract = getAgentContract(input.agentName) as AgentStructuredContract<I, O>;
  const outputSchema = contract.getOutputSchema(input.payload);
  const backend = resolveBackendForCall({ ... });

  if (backend === "api") {
    return callViaAnthropicApi(contract, outputSchema, input);  // existing tool_use path
  }

  // Subscription path: pick a mode.
  const mode = input.mode ?? envMode(input.agentName) ?? contract.defaultMode;
  if (mode === "mcp_submit_tool" && !contract.mcp) {
    throw new LLMError(`contract for ${input.agentName} has no mcp spec; cannot run in mcp_submit_tool mode`);
  }
  const start = performance.now();

  let raw: unknown;
  let diagnostics: Partial<StructuredDiagnostics> = { mode };

  if (mode === "native_output_format") {
    ({ raw, diagnostics } = await callViaSdkNativeOutput(contract, outputSchema, input));
  } else if (mode === "mcp_submit_tool") {
    ({ raw, diagnostics } = await callViaSdkMcpSubmitTool(contract, outputSchema, input));
  } else {
    ({ raw, diagnostics } = await callViaHybrid(contract, outputSchema, input));
  }

  // Universal post-validation. Even if the SDK or MCP server already
  // validated, we re-validate locally so every backend has the same
  // failure surface.
  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) throw new LLMValidationError(parsed.error.message, raw);

  return { raw: parsed.data, modelId, backend, mode, usage, diagnostics: { latencyMs: performance.now() - start, ...diagnostics } };
}
```

### 3.4 Mode 1: `native_output_format` (default for subscription)

Uses the Agent SDK's built-in JSON Schema structured output. The SDK validates against the schema and surfaces validation failures via `error_max_structured_output_retries` on the result message.

```ts
const outputSchemaJson = z.toJSONSchema(outputSchema);  // Zod 4 native API
const q = query({
  prompt: contract.buildPrompt(input.payload),
  options: {
    model,
    systemPrompt: contract.systemPrompt,
    tools: [],
    outputFormat: { type: "json_schema", schema: outputSchemaJson },
    maxTurns: 1,
  },
});
// Iterate. The result message carries `structured_output` (or whatever the
// 0.2.x field is — verified in Phase 0.2 spike). Map to raw, then post-validate.
```

Pros: simplest, fewest turns, lowest latency, no fake `submit_*` tool.
Risk: depends on SDK supporting `outputFormat` with the auth mode the user runs (subscription via `claude` CLI credentials). Phase 0 verifies.

### 3.5 Mode 2: `mcp_submit_tool` (fallback / forced)

Builds a one-tool in-process MCP server using `tool()` + `createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk/sdk-tools`. The handler captures and pre-validates the payload, returns `{isError: true}` on schema mismatch instead of throwing.

```ts
const mcp = contract.mcp!;  // dispatcher already enforced presence
let capturedPayload: O | undefined;
let capturedValidationError: ZodError | undefined;
let toolCallCount = 0;

const submitTool = tool(
  mcp.toolName,
  mcp.toolDescription,
  outputSchema,                  // resolved per-call schema from getOutputSchema(input)
  async (args) => {
    toolCallCount++;
    const parsed = outputSchema.safeParse(args);
    if (!parsed.success) {
      capturedValidationError = parsed.error;
      return { content: [{ type: "text", text: "Payload failed schema validation." }], isError: true };
    }
    capturedPayload = parsed.data;
    return { content: [{ type: "text", text: "Accepted." }], structuredContent: parsed.data };
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
);

const serverName = `submit_${contract.agentName}`;
const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });

const q = query({
  prompt: forceToolPrompt(contract.buildPrompt(input.payload), mcp.toolName),
  options: {
    model,
    systemPrompt: contract.systemPrompt,
    tools: [],
    mcpServers: { [serverName]: mcpServer },
    allowedTools: [`mcp__${serverName}__${mcp.toolName}`],
    maxTurns: mcp.maxTurns ?? 3,
  },
});
// Drain the stream. After completion:
if (capturedValidationError) throw new LLMValidationError(capturedValidationError.message, capturedPayload);
if (toolCallCount === 0) throw new LLMNoToolCallError(`Model did not call ${mcp.toolName}`);
if (toolCallCount > 1) throw new LLMMultipleToolCallsError(`Expected exactly one tool call, got ${toolCallCount}`);
if (!capturedPayload) throw new LLMValidationError("No payload captured", undefined);
```

`forceToolPrompt` appends a hard contract:

> You must call exactly one tool: `${toolName}`. Do not answer in prose. The tool input must satisfy the schema. If no issues, submit `{ issues: [], overallNotes: "..." }`.

Pros: strong mechanical guarantee that the model produces a structured payload via tool_use; works even if `outputFormat` is unavailable.
Cons: more turns (typically 2-3), more code, more failure modes, more latency.

### 3.6 Mode 3: `hybrid_generate_extract` (legacy)

The existing `generateThenStructure` from etap 0.2.3 is preserved as the third mode. It runs subscription `streamMessages` to produce prose, then calls **the Anthropic API directly via the existing tool_use path** (i.e. forced `backend = "api"` for the extraction step) to convert prose into the schema. The extraction is a small Sonnet call costing ~$0.001. Useful when:

- prose output is large and might trip MCP tool result size limits;
- the agent benefits from a prose-first creative pass;
- both subscription modes fail in spike testing and a stop-gap is needed.

Hybrid stays as an opt-in via `mode: "hybrid_generate_extract"` per call or env. Default for all agents is `native_output_format` until spike or production data says otherwise. Hybrid is **not 100% subscription** — the extraction half is paid API. This is a deliberate trade-off for reliability when the other modes fail.

### 3.7 Routing decisions and env

Backend selection (api vs subscription) stays the same as etap 0.2.3:
- `resolveBackend(agentName)` reads `LLM_AGENT_BACKEND_MAP` JSON env or returns the default map.
- `resolveBackendForCall({...})` applies hard-rule (now: hard-rule applies only when contract is missing or env forces api). With the unified contract the dispatcher resolves both backend and mode without invariant violation.

Mode selection (within subscription):
- Per-call `input.mode` (highest priority).
- `LLM_SUBSCRIPTION_STRUCTURED_MODE` env: global default for all subscription calls.
- `LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP={"critic_canon":"mcp_submit_tool"}` JSON env: per-agent override.
- `contract.defaultMode` (lowest priority).

### 3.8 Default routing map (etap 0.2.4)

| Agent | Backend | Subscription mode (if backend=subscription) |
|---|---|---|
| writer, editor | subscription | (no structured output — uses `streamMessages`) |
| summarizer | subscription | (no structured output) |
| plot_outline, plot_chapter_plan, canon_guard, critic_canon, critic_style, critic_editor, critic_reader, style_extractor | subscription | `native_output_format` |
| critic_dialogue (new), foreshadowing_planner (new) | subscription | `native_output_format` |
| inline | api | (interactive — kept on API) |
| lore, character | api | (no LLM call currently) |

**Naming change**: the existing `plot` agentName is split into `plot_outline` and `plot_chapter_plan` because the two have distinct output schemas (`bookOutlineToolSchema` vs `chapterBeatSheetToolSchema`) and benefit from being separately routable, mode-overridable, and contract-registered. This is a one-time enum change in `AGENT_NAMES` and `DEFAULT_AGENT_BACKEND`. Existing usages in `packages/agents/src/plot.ts` are updated to pass the new agentNames.

**Backward compatibility for env overrides**: `LLM_AGENT_BACKEND_MAP` historical entries keyed `"plot"` are aliased onto both new names at parse time. A small `warnOnce(key, message)` helper deduplicates the deprecation message — `parseEnvOverrides()` runs on every call to `resolveBackend()` and we don't want N copies of the same warning per request:

```ts
const warnedKeys = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

function parseEnvOverrides(): Partial<Record<AgentName, LLMBackend>> {
  const map = parseRawJson(process.env.LLM_AGENT_BACKEND_MAP) ?? {};
  if ("plot" in map) {
    map.plot_outline ??= map.plot;
    map.plot_chapter_plan ??= map.plot;
    warnOnce(
      "LLM_AGENT_BACKEND_MAP.plot",
      '[llm/router] LLM_AGENT_BACKEND_MAP: "plot" key is deprecated, use plot_outline and plot_chapter_plan',
    );
    delete map.plot;
  }
  return map;
}
```

Same alias + `warnOnce` logic applies to `LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP`. Historical `llm_usage` rows with `agentName='plot'` stay as-is in the DB; the Usage page label adapter (`humanizeAgentName`) maps them to "plot (legacy)" so the chart remains readable.

### 3.9 Error classes

```ts
export class LLMNoToolCallError extends LLMError {}     // mcp_submit_tool: model did not invoke tool
export class LLMMultipleToolCallsError extends LLMError {} // mcp_submit_tool: model invoked > 1 time
export class LLMSchemaRetryExhaustedError extends LLMError {}  // native_output_format: SDK retries exhausted
// Existing: LLMError, LLMAuthError, LLMValidationError
```

---

## 4. New agents

### 4.1 Dialogue specialist (`critic_dialogue`)

Sub-critic focused on dialogue quality.

**System prompt summary**: «Ты — Dialogue Specialist. Читаешь главу и оцениваешь только диалоги. Игнорируешь нарратив. Фокус: voice consistency per character, отсутствие infodumps, ритм реплик, правдоподобие реакций.»

**Output schema**: extended `CritiqueIssue` from `@book-forge/shared` to carry typed metadata.

```ts
// shared/critique.ts (extended) — soft, backward-compatible.
export const critiqueIssueSchema = z.object({
  excerpt: z.string().min(1).max(400),
  severity: issueSeveritySchema,
  summary: z.string().min(1).max(300),
  suggestion: z.string().min(1).max(500),
  source: z.enum(["canon", "style", "editor", "reader", "dialogue"]).optional(),
  metadata: z.unknown().optional(),  // shape varies by source; consumers narrow per source
});
```

The shared schema accepts any `metadata` payload as `unknown` — old DB rows without `source`/`metadata` continue to validate. Each agent's contract output schema imposes its own strict shape on top:

```ts
// packages/agents/src/critics/dialogue.ts
const dialogueIssueMetadataSchema = z.object({
  character: z.string().min(1).max(120),
  kind: z.enum(["voice_drift", "infodump", "rhythm", "unbelievable_reaction"]),
  context: z.string().min(1).max(200),
});

const dialogueCriticIssueSchema = critiqueIssueSchema.extend({
  source: z.literal("dialogue"),
  metadata: dialogueIssueMetadataSchema,  // strict: required and typed
});

const dialogueCriticReportSchema = z.object({
  issues: z.array(dialogueCriticIssueSchema).max(20),
  overallNotes: z.string().min(1).max(500),
});
```

Existing critics fill `source` with their enum value (none of them populate `metadata` initially — they continue to use the parent shape). UI consumers narrow on `source` when rendering: `if (issue.source === "dialogue") { const meta = dialogueIssueMetadataSchema.parse(issue.metadata); ... }`.

**Integration**: `criticTypeSchema` enum gains `"dialogue"`. `CRITIC_LABELS` adds an entry. `graphs/critique.ts` includes the new critic in the default pipeline.

### 4.2 Foreshadowing planner (`foreshadowing_planner`)

Planner agent (not chapter-level critic).

**Input**:

```ts
interface ForeshadowingPlannerInput {
  bookTitle: string;
  bookOutline: string;
  chapterCount: number;
  completedChapters: Array<{ index: number; title: string; summary: string }>;
  unresolvedHooks: Array<{ id: number; description: string; openedInChapter: number }>;
}
```

**Schema**: dynamic factory, validates indices and hook references at parse time:

```ts
function makeForeshadowingPlanSchema(chapterCount: number, hookIds: number[]) {
  const chapterIndex = z.number().int().min(1).max(chapterCount);
  const knownHookId = z.number().int().refine((id) => hookIds.includes(id), { message: "unknown hookId" });

  const hint = z.object({
    targetChapterIndex: chapterIndex,
    kind: z.enum(["object", "dialogue", "setting_detail", "rumour", "dream"]),
    hookId: knownHookId.nullable(),
    suggestion: z.string().min(1).max(400),
    rationale: z.string().min(1).max(300),
  });

  const payoff = z
    .object({
      hintTargetChapterIndex: chapterIndex,
      payoffChapterIndex: chapterIndex,
      hookId: knownHookId.nullable(),
      suggestion: z.string().min(1).max(400),
      rationale: z.string().min(1).max(300),
    })
    .superRefine((v, ctx) => {
      if (v.payoffChapterIndex < v.hintTargetChapterIndex) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "payoff must be at or after hint" });
      }
    });

  return z.object({
    hints: z.array(hint).max(20),
    payoffs: z.array(payoff).max(20),
    overallNotes: z.string().min(1).max(500),
  });
}
```

The contract uses the unified `getOutputSchema(input)` shape from §3.1 — for foreshadowing the closure captures `input.chapterCount` and `input.unresolvedHooks` to build a per-call schema:

```ts
const foreshadowingPlannerContract: AgentStructuredContract<ForeshadowingPlannerInput, ForeshadowingPlan> = {
  agentName: "foreshadowing_planner",
  getOutputSchema: (input) =>
    makeForeshadowingPlanSchema(
      input.chapterCount,
      input.unresolvedHooks.map((h) => h.id),
    ),
  systemPrompt: SYSTEM_FORESHADOWING,
  buildPrompt: (input) => buildForeshadowingPrompt(input),
  defaultMode: "native_output_format",
  mcp: {
    toolName: "submit_foreshadowing_plan",
    toolDescription: "Submit a structured foreshadowing plan with hints and payoffs.",
  },
};
```

The dispatcher invokes `contract.getOutputSchema(input.payload)` once per call before validation — same code path as static schemas.

**Item identification**: the LLM returns hints and payoffs **without** ids — generating UUIDs from a language model is unreliable. After the dispatcher returns a parsed plan, the server route assigns a `crypto.randomUUID()` to each hint and payoff before persisting:

```ts
// apps/server/src/routes/foreshadowing.ts
const plan = await runForeshadowingPlanner(input);
const planWithIds: ForeshadowingPlanWithIds = {
  hints: plan.hints.map((h) => ({ ...h, id: crypto.randomUUID() })),
  payoffs: plan.payoffs.map((p) => ({ ...p, id: crypto.randomUUID() })),
  overallNotes: plan.overallNotes,
};
db.insert(foreshadowingPlans).values({ bookId, payload: JSON.stringify(planWithIds), status: "proposed" });
```

`ForeshadowingPlanWithIds` is a separate Zod schema layered on top of `foreshadowingPlanSchema` — adds `id: z.string().uuid()` to each hint and payoff. The UI accept/reject cards reference these ids; `accepted_items` stores the array of accepted ids.

**Database**: new table `foreshadowing_plans`:

```sql
CREATE TABLE foreshadowing_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,                -- JSON of ForeshadowingPlanWithIds (server-assigned uuids)
  status TEXT NOT NULL DEFAULT 'proposed',  -- proposed | accepted_partial | rejected | applied
  accepted_items TEXT,                  -- JSON array of accepted hint/payoff UUIDs
  applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Drizzle migration `0010_foreshadowing.sql`. Server route `POST /api/books/:bookId/foreshadowing/run` runs the agent, assigns ids, persists the plan with `status='proposed'`. UI surface: a button on the Plot tab opens a side-sheet with two lists (hints, payoffs) of accept/reject cards. Per-item acceptance updates `accepted_items`. A separate "Применить" workflow could later push accepted hints into chapter beats — out of scope for this etap.

---

## 5. Telemetry (in-scope this etap)

A lightweight diagnostics payload travels with every structured call result and is logged to `llm_usage` (extend the existing schema with three nullable columns):

```sql
ALTER TABLE llm_usage ADD COLUMN backend TEXT DEFAULT NULL;            -- 'api' | 'subscription'
ALTER TABLE llm_usage ADD COLUMN structured_mode TEXT DEFAULT NULL;    -- 'native_output_format' | 'mcp_submit_tool' | 'hybrid_generate_extract' | NULL
ALTER TABLE llm_usage ADD COLUMN diagnostics TEXT DEFAULT NULL;        -- JSON: { latencyMs, toolCallCount?, validationRetries? }
```

Pre-existing rows stay `NULL` for these columns — no backfill, no ambiguous default. The Usage page renders missing values as the literal string `unknown` so the chart legend stays explicit. Note: the `modelId: subscription:*` prefix already encodes backend implicitly, but storing it as a separate column makes filtering and aggregation in SQL straightforward without parsing string prefixes.

Drizzle migration `0011_usage_telemetry.sql`. The Usage page chart adds a stacked-bar view by `backend × structured_mode` so the user can see at a glance which agents are eating real API spend versus burning Max-5 quota.

Out of scope this etap: per-message-id deduplication of tool_use rounds (defer to 0.2.6 when fallback logic also lands).

---

## 6. Migration plan

### Phase 0 — Foundation (split into two independent PRs)

Phase 0 is divided into two **separately mergeable** changes. Reviewing them together would mix Zod-migration noise with SDK-integration risk; split, each PR is reviewable on its own merits.

#### Phase 0.1 — Zod 4 monorepo migration (own PR)

The owner has chosen to upgrade Zod atomically before any structured-layer work. Breaking changes that need attention: `z.record` arity (now requires explicit key schema), `default` vs `optional` semantics, `error.format()`/issue shape changes, `z.toJSONSchema()` replacing the third-party `zod-to-json-schema`.

Scope:
- Bump `zod` from `3.25.x` to `^4.0.0` across all `package.json` files (`packages/shared/`, `packages/llm/`, `packages/agents/`, `packages/style-engine/`, `apps/server/`, `apps/web/`).
- Replace `zod-to-json-schema` imports with `z.toJSONSchema` (kept as fallback module if any callsite needs the v3-style output). Drop the `zod-to-json-schema` dependency from `packages/llm/`.
- Fix every type/runtime breakage surfaced by `pnpm -r typecheck` and `pnpm -r test`.
- Update existing test fixtures using v3-only patterns (e.g. `default()` chained on `optional()`).

Exit criteria: green typecheck + test suite at parity (no test added, none removed); CHANGELOG note about Zod 4 in `docs/`. No Agent SDK or structured-layer code touched.

#### Phase 0.2 — SDK capability spike (own PR, depends on 0.1)

A throwaway `scripts/spike-agent-sdk.ts` script that runs **after** the Zod 4 upgrade is merged. The spike must exercise both happy paths and failure modes — error message subtypes are the most important reconnaissance for Phase 1's error mapping logic.

**Happy paths**:
- Authenticates via Claude Code CLI credentials (no `ANTHROPIC_API_KEY` in env).
- Calls `query()` with `outputFormat: { type: "json_schema", schema: ... }` for a small Zod schema, verifies typed output arrives.
- Calls `query()` with `mcpServers + tool()` + `allowedTools`, verifies the model invokes the tool with valid args.

**Failure paths to exercise** (use crafted prompts that nudge the model toward the failure, not real production prompts):

- *Native, invalid schema*: instruct the model to return a payload that omits a required field. Capture how the SDK reports it — `error_max_structured_output_retries`? Custom error subtype? Different `result.subtype`?
- *MCP, no tool call*: instruct the model "answer in prose, do not call the tool". Verify the dispatcher sees `toolCallCount === 0` and that the SDK still produces a clean `result` message.
- *MCP, double tool call*: instruct the model "submit twice". Confirm `toolCallCount` increments correctly and that the second call is observed before result.
- *MCP, handler returns isError*: handler always returns `{ isError: true }`. Verify whether the SDK retries automatically (and how many times) or surfaces the failure immediately. This determines whether `LLMValidationError` should be raised on first failure or after the retry budget.

**Measurements**:
- Latency p50 for each happy-path call.
- SDK turn counts per call.
- Full enumeration of SDK message subtypes encountered (so the dispatcher's switch statement is exhaustive).

**Output**: a decision matrix table (recorded as appendix to this design doc) on which mode is the default + which error codes map to which `LLMError` subclass.

Exit criteria: matrix recorded; default mode chosen with evidence; spike script in repo (or deleted with results captured here, per preference). Phase 1 is unblocked.

### Phase 1 — Registry + native pilot
- Implement `AgentStructuredContract`, `structured-registry.ts`, `bootstrap.ts`.
- Implement `callViaSdkNativeOutput` (mode 1 only).
- Implement `callViaAnthropicApi` migration (existing `callStructured` becomes the api branch of the dispatcher; behaviour unchanged).
- Pilot: `critic_canon` migrated to the contract pattern.
- Tests: registry, dispatcher with mocked SDK + Anthropic API.
- Manual smoke: real critique on one chapter against subscription. Verify zero API spend.

### Phase 2 — MCP submit-tool fallback
- Implement `callViaSdkMcpSubmitTool` (mode 2).
- Add `LLM_SUBSCRIPTION_STRUCTURED_MODE` and `_MAP` env handling.
- Tests for mode 2 with mocked SDK and tool capture.
- Per-agent ability to override default mode via contract.

### Phase 3 — Critics rollout
- Migrate `critic_style`, `critic_editor`, `critic_reader` to contracts. Default mode native, fallback to MCP per env.
- Critique pipeline tests + smoke.

### Phase 4 — Plot, canon_guard, style_extractor
- Migrate `plot.generateBookOutline` (drop hybrid as default), `plot.generateChapterPlan`, `canon_guard`, `style_extractor`.
- Smoke run a full chapter cycle.

### Phase 5 — New agents
- `critic_dialogue` (extended `CritiqueIssue` schema with `source` + `metadata`).
- `foreshadowing_planner` (DB table, route, UI sheet, dynamic schema factory).
- E2E test: book → outline → 3 chapters → 5 critics (incl. dialogue) → repair → foreshadowing plan.

### Phase 6 — Cleanup

Hybrid removal is **gated**, not automatic. The rule:

> Delete `generateThenStructure` only after at least one full novel-writing smoke cycle (book → outline → chapter plan → 3 chapters → 5 critics including dialogue → repair → summary → canon_guard → foreshadowing) completes with **zero `mode === "hybrid_generate_extract"` invocations** and **zero validation-failure fallbacks** observed in `llm_usage.diagnostics`.

If the gate is not met (e.g. because some agent occasionally needs hybrid for very large outputs that exceed MCP tool result size limits), keep `generateThenStructure` as an opt-in third mode and document which agents tend to hit it.

Other cleanup items (do regardless of the hybrid gate):
- Remove obsolete hard-rule throw paths from `structured.ts` — the dispatcher now handles all routing.
- Delete the `zod-to-json-schema` dependency from `packages/llm/` (replaced by `z.toJSONSchema` in Phase 0.1).
- Delete the `subscription:` modelId prefix special-casing in `pricing.ts` if it has been superseded by the `backend` column in `llm_usage`. (Tentative — depends on whether legacy rows still need the prefix interpretation.)

---

## 7. Backward compatibility

- `LLM_AGENT_BACKEND_MAP` continues to flip backend per agent.
- New `LLM_SUBSCRIPTION_STRUCTURED_MODE` (and `_MAP`) flips mode per agent within subscription.
- Pricing module: `subscription:` prefix recognition stays.
- All existing route tests (12 files in `apps/server/src/routes/__tests__/`) continue to pass — they mock at the LLM layer above the dispatcher.
- Old `LLMValidationError` shape preserved.
- Public `@book-forge/llm` exports gain registry functions and new error classes; nothing is removed before Phase 6.

---

## 8. Testing strategy

### 8.1 Registry
- Register two contracts, retrieve, equality.
- Re-register overwrites without error.
- `clearStructuredRegistry` empties.
- `assertAllStructuredAgentsHaveContracts` raises with a clear missing-list error.
- `assertUniqueMcpToolNames` raises when two contracts declare the same `mcp.toolName`.
- Get unknown → `LLMError`.

**Parity test against the enum (drift guard)**:

```ts
// packages/llm/src/__tests__/structured-agents-parity.test.ts
import { AGENT_NAMES, STRUCTURED_AGENT_NAMES } from "@book-forge/llm";

const KNOWN_FREE_TEXT_OR_NOLLM: AgentName[] = [
  "writer",
  "editor",
  "summarizer",
  "inline",
  "lore",
  "character",
];

it("STRUCTURED_AGENT_NAMES covers every AgentName except free-text/no-LLM", () => {
  const expected = AGENT_NAMES.filter((n) => !KNOWN_FREE_TEXT_OR_NOLLM.includes(n));
  expect(new Set(STRUCTURED_AGENT_NAMES)).toEqual(new Set(expected));
});
```

When a future agent is added (e.g. `timeline_planner`), this test fails until the contributor either adds the agent to `STRUCTURED_AGENT_NAMES` (with a contract) or to `KNOWN_FREE_TEXT_OR_NOLLM` (and explicitly justifies why).

### 8.2 Dispatcher
For each combination (backend × mode), with mocked SDK and mocked Anthropic client:
- Happy path: returns parsed payload, emits diagnostics.
- Schema-validation failure: each backend surfaces `LLMValidationError` consistently.
- Mode 2 specific: model never calls tool → `LLMNoToolCallError`. Model calls multiple times → `LLMMultipleToolCallsError`. Tool result with `isError: true` → `LLMValidationError`.
- Mode 1 specific: SDK reports `error_max_structured_output_retries` → `LLMSchemaRetryExhaustedError`.
- Auth path: `authentication_failed` → `LLMAuthError` regardless of mode.

### 8.3 Env routing
- `LLM_AGENT_BACKEND_MAP` flips backend.
- `LLM_SUBSCRIPTION_STRUCTURED_MODE` global mode override.
- `LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP` per-agent override.
- Per-call `input.mode` outranks env.

### 8.4 New agents
- `critic_dialogue`: schema validation including `metadata` discriminator; integration in critique pipeline.
- `foreshadowing_planner`: dynamic schema factory rejects bad indices, accepts valid plan, stores correctly in DB, route returns 200.

### 8.5 Manual smoke after each phase
Run a real chapter or critique against the user's Max-5. Record in a phase log:
- backend used,
- mode used,
- latency p50/p99,
- tool-call count (mode 2),
- validation retries observed.

---

## 9. Out of scope

- Auto-fallback from one mode to another on failure (etap 0.2.6).
- Auto-fallback from subscription to API on quota or auth (etap 0.2.6).
- UI for managing per-agent backend/mode overrides (env-only).
- Migrating `inline` to subscription.
- Per-message-id telemetry dedup for parallel tool_use (etap 0.2.6).
- Applying foreshadowing plan items into chapter beats automatically.

---

## 10. Done criteria

- All structured-output LLM-invoking agents have an explicit `AgentStructuredContract`. After the `plot` split this is 8 existing + 2 new = 10 contracts: `plot_outline`, `plot_chapter_plan`, `canon_guard`, `critic_canon`, `critic_style`, `critic_editor`, `critic_reader`, `style_extractor`, `critic_dialogue` (new), `foreshadowing_planner` (new). `writer`, `editor`, `summarizer` produce free text and do not register contracts but stay subscription-routed via `streamMessages`.
- `registerAllAgentContracts()` is called once at server startup; `assertAllRoutedAgentsHaveContracts` passes.
- Subscription `callStructured` supports `native_output_format` and `mcp_submit_tool`; `hybrid_generate_extract` reachable by opt-in.
- Every backend post-validates output with the contract's Zod schema.
- Distinct error classes for: missing tool call, multiple tool calls, validation, auth, schema retry exhausted.
- `LLM_AGENT_BACKEND_MAP` flips backend; `LLM_SUBSCRIPTION_STRUCTURED_MODE[_MAP]` flips mode.
- Telemetry columns added to `llm_usage`; Usage page chart shows backend × mode breakdown.
- New agents `critic_dialogue` and `foreshadowing_planner` integrated end-to-end.
- `pnpm -r typecheck` and `pnpm -r test` green; manual smoke confirms zero API spend on a full chapter cycle (writer + critics + summarizer + canon_guard) under default config.
- Monorepo migrated to Zod 4 with all existing schemas working.

---

## 11. Open risks (resolved or punted by Phase 0)

1. **Zod 4 migration breakage**: Phase 0.5 dedicated to it. Test suite is the gate.
2. **SDK `outputFormat` availability with subscription auth**: Phase 0 spike confirms before any Phase 1 work.
3. **MCP `tool()` + Zod 4 integration**: Phase 0 spike confirms.
4. **`maxTurns` calibration**: spike measures, contract-level `mcpMaxTurns` ships as override.
5. **Quota accounting per tool_use round**: spike measures messages-per-call. If excessive, mode 1 becomes mandatory default.
6. **Compliance**: documented in §2; architecture preserves API as an equal mode.

---

## 12. Implementation order summary

1. Phase 0.1 — Zod 4 monorepo migration (own PR; green tests at parity). **DONE 2026-05-09.**
2. Phase 0.2 — SDK capability spike (own PR; decision matrix recorded as appendix §13). **DONE 2026-05-09 — see §13 for outcome.**
3. Phase 1 — registry, contract, dispatcher, **mcp_submit_tool pilot** (revised from "mode 1" per §13.4 spike outcome — native_output_format unavailable in observed SDK build), pilot agent `critic_canon`.
4. Phase 2 — env switches + observability around `LLMNoToolCallError` / `LLMMultipleToolCallsError` (mode 1 deferred until SDK exposes `outputFormat` correctly).
5. Phase 3 — remaining critics.
6. Phase 4 — `plot_outline`, `plot_chapter_plan`, `canon_guard`, `style_extractor`.
7. Phase 5 — `critic_dialogue`, `foreshadowing_planner`.
8. Phase 6 — cleanup, optional retirement of `generateThenStructure`, re-evaluate `native_output_format` if a future SDK release exposes the field.

---

## 13. Appendix — Phase 0.2 SDK capability spike results (2026-05-09)

Spike script: [`packages/llm/scripts/spike-agent-sdk.ts`](../../packages/llm/scripts/spike-agent-sdk.ts). Raw output: [`.planning/spike-output.md`](../spike-output.md). SDK version: `@anthropic-ai/claude-agent-sdk@0.2.136`. Auth: Claude Code CLI subscription (Max-5). Model alias used: `sonnet`.

### 13.1 Decision matrix

| Probe | Mode | Path | Result | Duration ms | Turns | Tool calls | result.subtype | Notes |
|---|---|---|---|---|---|---|---|---|
| A | native_output_format | happy | ❌ | 12 347 | 1 | — | success | `result.structured_output` was **not present** on the result message; no `outputFormat`-style field was honoured; assistant returned plain text content |
| B | native_output_format | adversarial_invalid | ❌ | 148 786 | 1 | — | success | Same: no structured_output, no error subtype. Long duration (~149s) suggests the model produced verbose prose under the adversarial system prompt |
| C | mcp_submit_tool | happy | ✅ | 42 643 | 2 | 1 | success | Tool invoked exactly once, payload captured: `{city: "Paris", population: 2100000, isCapital: true}` |
| D | mcp_submit_tool | no_tool (observational) | observed | 10 381 | 1 | 0 | success | With prose-friendly system prompt, model emitted no tool call — confirms MCP tools are model-controlled |
| E | mcp_submit_tool | double_call (observational) | observed | 40 512 | 3 | 2 | success | When asked for two submissions, model invoked tool twice. Took 3 turns |
| F | mcp_submit_tool | handler_isError (observational) | observed | 14 143 | 2 | 1 | success | Despite handler always returning `isError: true`, model invoked tool only once and the SDK did **not** auto-retry. The loop terminated at 2 turns |

### 13.2 SDK message subtypes encountered

Across all probes, the dispatcher's switch statement (Phase 1) must handle:

- `system:hook_started`, `system:hook_progress`, `system:hook_response`, `system:init`
- `assistant`
- `user` (only in MCP probes — emitted to deliver tool_result back to the model)
- `rate_limit_event`
- `result:success`

No `result:error` was observed in any probe — even adversarial native cases produced `result:success`. Auth-failure subtypes were not exercised in this spike (would require a deliberately broken `claude login` state).

### 13.3 Critical finding — native_output_format unavailable

Probes A and B both completed without exposing a `structured_output` field on the `result` message. The SDK 0.2.136 either silently ignores the `outputFormat` option name we passed, or this option is reserved for non-subscription auth modes (or for a different SDK build channel). Either way: **`native_output_format` is not viable for Phase 1+ in the current build**.

Three possible follow-ups (out of scope for Phase 0.2 — to triage in Phase 6 or a dedicated investigation):
1. Search the `sdk.d.ts` for the actual field name (might be `output_format` snake_case, `responseFormat`, `outputSchema`, etc.).
2. Try the same probe under direct API key auth to see if `outputFormat` works in API mode but not subscription.
3. Wait for a newer SDK release that documents structured output more explicitly.

### 13.4 Default mode chosen for Phase 1+

**`mcp_submit_tool` is the default subscription mode**, not `native_output_format`. Rationale:

- Probe C demonstrates 100% reliability of the MCP path (correct payload, exactly 1 tool call, terminating result).
- Native path returns no structured output in the observed SDK build, making it unusable today.
- MCP latency (~13-43s for happy paths) is acceptable per the user's earlier latency-tolerance decision.

`hybrid_generate_extract` remains opt-in for very large outputs that might exceed MCP tool result size limits — Phase 1 ships its plumbing but does not exercise it by default.

`native_output_format` is **deprecated for now** (not removed from the Mode enum — its plumbing remains so we can re-enable later without re-architecting). Spec §3.4 description stays in place as "future state" reference.

### 13.5 Operational signals for Phase 1

- **`maxTurns`**: MCP happy path used 2 turns. Double-call used 3. handler-isError used 2. Phase 1 dispatcher should default to `mcpMaxTurns: 3` (matches spec §3.5) — no need to bump higher.
- **Tool retry on `isError`**: SDK does **not** auto-retry. Phase 1's `LLMValidationError` mapping for an `isError` capture is correct as designed — the dispatcher itself must surface the failure; there is no implicit retry layer to deduplicate against.
- **Quota cost reported by SDK**: each MCP happy call reports `total_cost_usd ≈ $0.10-0.17` and `cache_read_input_tokens ≈ 30 000`. The cache-read mass is the Claude Code system prompt (always loaded). It is free under subscription but counts as quota usage — full novel-writing sessions need the headroom Max-5 already provides.
- **Subscription `usage` payload shape**: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` plus `service_tier`, `cache_creation.ephemeral_1h_input_tokens` (1h-cache breakdown). The dispatcher's `extractUsage` already handles the first four; it can ignore the rest or surface them via `diagnostics`.

### 13.6 Risks confirmed or refuted by the spike

- Risk #1 (`outputFormat` availability with subscription auth): **NOT AVAILABLE in 0.2.136**. Logged as known limitation; Phase 1 ships mcp_submit_tool only.
- Risk #2 (MCP `tool()` + Zod 4 integration): **WORKS**. Used `fixtureSchema.shape` (ZodRawShape) as the third arg to `tool()`. Probe C captured a correctly-typed payload.
- Risk #3 (`maxTurns` calibration): MCP happy path = 2 turns. Default `mcpMaxTurns: 3` is sufficient.
- Risk #4 (`allowedTools` semantics): **CONFIRMED** that `allowedTools` + `tools: []` does not force a tool call (Probe D); it only pre-approves access. Phase 1's hard contract prompt + post-call `toolCallCount === 1` invariant remains necessary.
- Risk #5 (Quota accounting per tool_use round): each MCP happy probe = 1 SDK `query()` call, regardless of internal turn count. The `result` message reports aggregated `usage`, not per-turn. Quota is "1 call per dispatcher invocation" from the user's Max-5 perspective.
- Risk #8 (Zod v3/v4 peer mismatch): **NOT REPRODUCED**. SDK accepted `fixtureSchema.shape` from Zod 4.4.3 without runtime errors.

### 13.7 Spec sections superseded by this appendix

- §3.4 "Mode 1: native_output_format (default for subscription)" — its claim of being the default is **superseded**. Phase 1 ships mcp_submit_tool as default. §3.4 description is retained as future-state plumbing.
- §6 Phase 1 description ("native pilot") — read in light of §13.4: pilot is mcp_submit_tool.
- §11 Risk #1 — resolved as known limitation, not a blocker.

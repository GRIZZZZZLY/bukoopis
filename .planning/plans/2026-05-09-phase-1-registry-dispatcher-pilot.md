# Phase 1 — Registry + Dispatcher + MCP Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the unified structured-output dispatcher and pilot it on a single agent (`critic_canon`). After this PR, `critic_canon` flows through Claude Pro/Max via Claude Agent SDK + MCP submit-tool while every other agent stays on its current path. The architecture is now extensible — adding a contract registers an agent into the registry; adding a backend handler is a new file. No behaviour change for any non-piloted agent.

**Architecture:** Add an explicit `AgentStructuredContract<I, O>` type and a per-process registry keyed by `AgentName`. Refactor existing `callStructured` so its tool_use loop becomes the private function `callViaAnthropicApi`, exposed unchanged behind the legacy `callStructured` export plus reused by the new dispatcher. Add `callViaSdkMcpSubmitTool` (mode 2, default per Phase 0.2 spike outcome §13.4). Both backends post-validate output via `outputSchema.safeParse`. Add `dispatchStructured(input)` as the new public entry point — resolves contract → backend → mode and dispatches. New error classes (`LLMNoToolCallError`, `LLMMultipleToolCallsError`, `LLMSchemaRetryExhaustedError`). Env switches (`LLM_SUBSCRIPTION_STRUCTURED_MODE`, `_MAP`) honoured. `critic_canon` migrated to use the dispatcher; other critics + plot + canon_guard + style_extractor continue calling legacy `callStructured`. Phase 3+ migrates them.

**Tech Stack:** TypeScript 5.7, Zod 4.4.3, `@anthropic-ai/claude-agent-sdk@0.2.136`, Vitest 2.1.

---

## Pre-conditions

- Phase 0.1 + 0.2 merged. `pnpm -r typecheck` and `pnpm -r test` green: 157 tests + 6 spike artifacts.
- Spike outcome §13.4: subscription default mode = `mcp_submit_tool`. Native deferred.
- `claude` CLI installed and `claude login`-ed (for the manual smoke at the end).

## Files to create

| File | Purpose |
|---|---|
| `packages/llm/src/structured-registry.ts` | Registry + assertions (`STRUCTURED_AGENT_NAMES`, `registerAgentContract`, `getAgentContract`, `clearStructuredRegistry`, `listRegisteredAgents`, `assertAllStructuredAgentsHaveContracts`, `assertUniqueMcpToolNames`). |
| `packages/llm/src/clients/mcp-submit-tool.ts` | The `callViaSdkMcpSubmitTool` adapter. One file = one backend. |
| `packages/llm/src/dispatcher.ts` | The new `dispatchStructured(input)` public entry. Resolves contract → backend → mode and routes. |
| `packages/llm/src/__tests__/structured-registry.test.ts` | Registry CRUD + assertion behaviour. |
| `packages/llm/src/__tests__/structured-agents-parity.test.ts` | Parity test against `AgentName` enum (drift guard). |
| `packages/llm/src/__tests__/dispatcher.test.ts` | Dispatcher with mocked SDK + mocked Anthropic client. Covers backend × mode happy paths + key error classes. |
| `packages/llm/src/__tests__/mcp-submit-tool.test.ts` | Standalone unit coverage for the MCP adapter. |
| `packages/agents/src/bootstrap.ts` | `registerAllAgentContracts()` — initially only `critic_canon`. |

## Files to modify

| File | Reason |
|---|---|
| `packages/llm/src/types.ts` | Add `StructuredMode`, `AgentMcpSpec`, `AgentStructuredContract`. Add `STRUCTURED_AGENT_NAMES` set. Re-affirm `AgentName` includes `plot_outline`, `plot_chapter_plan` per spec §3.8 (deferred — done in Phase 4). For Phase 1: keep `AgentName` as-is; do NOT split `plot` yet. |
| `packages/llm/src/errors.ts` | Add `LLMNoToolCallError`, `LLMMultipleToolCallsError`, `LLMSchemaRetryExhaustedError`. |
| `packages/llm/src/router.ts` | Add `LLM_SUBSCRIPTION_STRUCTURED_MODE` and `_MAP` env handling: `resolveStructuredMode(agentName, contractDefault, perCall?)`. |
| `packages/llm/src/structured.ts` | Extract the existing tool_use loop body into private `callViaAnthropicApi(contract, outputSchema, input)`. Keep the legacy `callStructured(opts)` export, now a thin wrapper that constructs an ad-hoc contract from the opts and delegates to `callViaAnthropicApi`. **No behavioural change for legacy callers.** |
| `packages/llm/src/index.ts` | Export new symbols (registry, contract types, dispatcher, error classes, mode-resolution helper). Do NOT remove the legacy `callStructured` export. |
| `packages/agents/src/critics/canon.ts` | Add `registerCanonCriticContract()` (defines + registers the contract). Switch `runCanonGuard` body to call `dispatchStructured` instead of going through `runCritic`. Behaviour parity: same input shape, same `CriticReport` output shape. |
| `apps/server/src/index.ts` | Call `registerAllAgentContracts()` once at startup, then `assertAllStructuredAgentsHaveContracts()`. |

## Files NOT to modify in Phase 1

- `packages/agents/src/critics/base.ts` — used by other critics still on legacy path. Stays untouched until Phase 3.
- `packages/agents/src/critics/{style,editor,reader}.ts` — Phase 3.
- `packages/agents/src/plot.ts` — Phase 4.
- `packages/agents/src/canon-extractor.ts` — Phase 4.
- `packages/style-engine/src/extractor.ts` — Phase 4.

## Conventions

- The legacy export `callStructured` keeps its signature and behaviour for the duration of Phases 1-5. Phase 6 cleanup may remove it after all agents migrate.
- The registry is process-local. Tests use `clearStructuredRegistry()` between cases.
- Register one contract: `registerAgentContract({ agentName, getOutputSchema, systemPrompt, buildPrompt, defaultMode, mcp? })`.
- `STRUCTURED_AGENT_NAMES` for Phase 1 contains exactly `["critic_canon"]`. The set grows in subsequent phases.
- Mode resolution priority: per-call `input.mode` > env `LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP[agent]` > env `LLM_SUBSCRIPTION_STRUCTURED_MODE` > `contract.defaultMode`.

---

## Task 1: New error classes

**Files:**
- Modify: `packages/llm/src/errors.ts`

- [ ] **Step 1: Add the three new classes**

In `packages/llm/src/errors.ts`, after the existing `LLMValidationError` declaration, append:

```ts
export class LLMNoToolCallError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMNoToolCallError";
  }
}

export class LLMMultipleToolCallsError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMMultipleToolCallsError";
  }
}

export class LLMSchemaRetryExhaustedError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMSchemaRetryExhaustedError";
  }
}
```

- [ ] **Step 2: Re-export from barrel**

In `packages/llm/src/index.ts`, find the existing error exports and add the three new names:

```ts
export {
  LLMError,
  BackendNotImplementedError,
  LLMAuthError,
  LLMNoToolCallError,
  LLMMultipleToolCallsError,
  LLMSchemaRetryExhaustedError,
} from "./errors.js";
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd "d:/PROJECTS/BOOKOPIS"
pnpm --filter @book-forge/llm typecheck
git add packages/llm/src/errors.ts packages/llm/src/index.ts
git commit -m "feat(llm): add LLMNoToolCallError, LLMMultipleToolCallsError, LLMSchemaRetryExhaustedError"
```

---

## Task 2: Contract types + STRUCTURED_AGENT_NAMES

**Files:**
- Modify: `packages/llm/src/types.ts`

- [ ] **Step 1: Add the contract types**

In `packages/llm/src/types.ts`, after the existing `effectiveBackend` function, append:

```ts
import type { ZodType } from "zod";

export type StructuredMode =
  | "native_output_format"
  | "mcp_submit_tool"
  | "hybrid_generate_extract";

export interface AgentMcpSpec {
  toolName: string;
  toolDescription: string;
  maxTurns?: number;
}

export interface AgentStructuredContract<I, O> {
  agentName: AgentName;
  getOutputSchema: (input: I) => ZodType<O>;
  systemPrompt: string;
  buildPrompt: (input: I) => string;
  defaultMode: StructuredMode;
  mcp?: AgentMcpSpec;
}

/** Whitelist of agents that produce structured output and therefore MUST
 *  have a contract registered. Free-text agents (writer/editor/summarizer)
 *  and non-LLM placeholders (lore/character) are excluded. Phase 1 starts
 *  with critic_canon only; subsequent phases add the rest. */
export const STRUCTURED_AGENT_NAMES = new Set<AgentName>(["critic_canon"]);
```

(The set will grow in Phases 3-5. The parity test from Task 6 enforces that growth happens deliberately.)

- [ ] **Step 2: Re-export from barrel**

In `packages/llm/src/index.ts`, alongside the existing `AgentName`/`AGENT_NAMES`/`effectiveBackend` exports add:

```ts
export type {
  StructuredMode,
  AgentMcpSpec,
  AgentStructuredContract,
} from "./types.js";
export { STRUCTURED_AGENT_NAMES } from "./types.js";
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @book-forge/llm typecheck
git add packages/llm/src/types.ts packages/llm/src/index.ts
git commit -m "feat(llm): add AgentStructuredContract types + STRUCTURED_AGENT_NAMES set"
```

---

## Task 3: Registry module

**Files:**
- Create: `packages/llm/src/structured-registry.ts`
- Modify: `packages/llm/src/index.ts` (re-exports)

- [ ] **Step 1: Create the registry**

Create `packages/llm/src/structured-registry.ts` with:

```ts
import { LLMError } from "./errors.js";
import { STRUCTURED_AGENT_NAMES } from "./types.js";
import type { AgentName, AgentStructuredContract } from "./types.js";

const REGISTRY = new Map<AgentName, AgentStructuredContract<unknown, unknown>>();

export function registerAgentContract<I, O>(
  contract: AgentStructuredContract<I, O>,
): void {
  REGISTRY.set(
    contract.agentName,
    contract as AgentStructuredContract<unknown, unknown>,
  );
}

export function getAgentContract(
  agentName: AgentName,
): AgentStructuredContract<unknown, unknown> {
  const c = REGISTRY.get(agentName);
  if (!c) {
    throw new LLMError(
      `[structured-registry] no contract registered for agent "${agentName}"`,
    );
  }
  return c;
}

export function clearStructuredRegistry(): void {
  REGISTRY.clear();
}

export function listRegisteredAgents(): AgentName[] {
  return [...REGISTRY.keys()];
}

/** Verifies every agent in STRUCTURED_AGENT_NAMES has a contract registered. */
export function assertAllStructuredAgentsHaveContracts(): void {
  const missing: AgentName[] = [];
  for (const name of STRUCTURED_AGENT_NAMES) {
    if (!REGISTRY.has(name)) missing.push(name);
  }
  if (missing.length > 0) {
    throw new LLMError(
      `[structured-registry] missing contracts for: ${missing.join(", ")}. ` +
        `Did you call registerAllAgentContracts() at startup?`,
    );
  }
  assertUniqueMcpToolNames();
}

/** Verifies no two contracts declare the same mcp.toolName. */
export function assertUniqueMcpToolNames(): void {
  const seen = new Map<string, AgentName>();
  for (const [agent, contract] of REGISTRY.entries()) {
    if (!contract.mcp) continue;
    const existing = seen.get(contract.mcp.toolName);
    if (existing) {
      throw new LLMError(
        `[structured-registry] duplicate mcp.toolName "${contract.mcp.toolName}" ` +
          `between agents "${existing}" and "${agent}"`,
      );
    }
    seen.set(contract.mcp.toolName, agent);
  }
}
```

- [ ] **Step 2: Re-export from barrel**

In `packages/llm/src/index.ts` add:

```ts
export {
  registerAgentContract,
  getAgentContract,
  clearStructuredRegistry,
  listRegisteredAgents,
  assertAllStructuredAgentsHaveContracts,
  assertUniqueMcpToolNames,
} from "./structured-registry.js";
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @book-forge/llm typecheck
git add packages/llm/src/structured-registry.ts packages/llm/src/index.ts
git commit -m "feat(llm): add structured-registry with contract CRUD and startup assertions"
```

---

## Task 4: Mode resolution in router

**Files:**
- Modify: `packages/llm/src/router.ts`

- [ ] **Step 1: Add the resolution helper**

At the bottom of `packages/llm/src/router.ts`, after the existing exports, append:

```ts
import type { StructuredMode } from "./types.js";

const VALID_MODES: ReadonlySet<StructuredMode> = new Set([
  "native_output_format",
  "mcp_submit_tool",
  "hybrid_generate_extract",
]);

function parseEnvMode(raw: string | undefined): StructuredMode | undefined {
  if (!raw) return undefined;
  return VALID_MODES.has(raw as StructuredMode) ? (raw as StructuredMode) : undefined;
}

function parseEnvModeMap(): Partial<Record<AgentName, StructuredMode>> {
  const raw = process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      "[llm/router] LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP is not valid JSON — ignored",
    );
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Partial<Record<AgentName, StructuredMode>> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!VALID_AGENTS.has(k)) continue;
    if (typeof v !== "string" || !VALID_MODES.has(v as StructuredMode)) continue;
    out[k as AgentName] = v as StructuredMode;
  }
  return out;
}

export interface ResolveStructuredModeInput {
  agentName: AgentName;
  contractDefault: StructuredMode;
  perCall?: StructuredMode;
}

export function resolveStructuredMode(
  input: ResolveStructuredModeInput,
): StructuredMode {
  if (input.perCall) return input.perCall;
  const map = parseEnvModeMap();
  const perAgent = map[input.agentName];
  if (perAgent) return perAgent;
  const global = parseEnvMode(process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE);
  if (global) return global;
  return input.contractDefault;
}
```

- [ ] **Step 2: Re-export from barrel**

In `packages/llm/src/index.ts` add `resolveStructuredMode` to the existing router exports:

```ts
export {
  resolveBackend,
  resolveBackendForCall,
  resolveStructuredMode,
} from "./router.js";
export type {
  ResolveBackendForCallInput,
  ResolveStructuredModeInput,
} from "./router.js";
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @book-forge/llm typecheck
git add packages/llm/src/router.ts packages/llm/src/index.ts
git commit -m "feat(llm): add resolveStructuredMode with env LLM_SUBSCRIPTION_STRUCTURED_MODE[_MAP] honoured"
```

---

## Task 5: Refactor structured.ts — extract `callViaAnthropicApi`

**Files:**
- Modify: `packages/llm/src/structured.ts`

The goal: existing tool_use loop becomes a private function `callViaAnthropicApi(contract, outputSchema, input)`. Public legacy `callStructured(opts)` becomes a thin wrapper that builds an ad-hoc contract from the opts and delegates. **Behaviour parity** — every existing test passes unchanged.

- [ ] **Step 1: Add helper types at top of file**

After the existing imports in `packages/llm/src/structured.ts`, add:

```ts
import type {
  AgentStructuredContract,
  StructuredMode,
} from "./types.js";

export interface StructuredCallInternal<I> {
  agentName: AgentName;
  payload: I;
  /** Resolved at the call site by the public entry point. */
  systemBlocks?: SystemBlock[] | string;
  /** Same semantics as legacy callStructured. */
  cacheableSystem?: boolean;
  temperature?: number;
  maxTokens?: number;
  onUsage?: (usage: StructuredUsage) => void;
  model: ModelChoice;
}
```

These exist for internal use; not exported.

- [ ] **Step 2: Extract the body into `callViaAnthropicApi`**

After the closing brace of `callStructured`, add:

```ts
/**
 * Anthropic API tool_use path. Used both by the legacy `callStructured`
 * wrapper and the new `dispatchStructured` for `backend === "api"`.
 */
export async function callViaAnthropicApi<I, O>(
  contract: AgentStructuredContract<I, O>,
  outputSchema: ZodType<O>,
  input: StructuredCallInternal<I>,
): Promise<O> {
  const client = getAnthropicClient();
  const inputSchema = z.toJSONSchema(outputSchema);
  const toolName = contract.mcp?.toolName ?? `submit_${contract.agentName}`;
  const tool = {
    name: toolName,
    description:
      contract.mcp?.toolDescription ??
      `Submit structured output for ${contract.agentName}.`,
    input_schema: inputSchema as Anthropic.Tool["input_schema"],
  } satisfies Anthropic.Tool;
  const modelId = resolveModelId(input.model);
  const cacheable =
    input.cacheableSystem ?? process.env.LLM_PROMPT_CACHE !== "0";
  const systemParam = buildSystemParam(
    input.systemBlocks ?? contract.systemPrompt,
    cacheable,
  );
  const userPrompt = contract.buildPrompt(input.payload);

  const res = await withRetry(() =>
    client.messages.create({
      model: modelId,
      max_tokens: input.maxTokens ?? 8192,
      system: systemParam as Anthropic.MessageCreateParams["system"],
      tools: [tool],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: userPrompt }],
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    }),
  );

  if (input.onUsage) {
    const usage = res.usage as typeof res.usage & {
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    };
    try {
      input.onUsage({
        modelId,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      });
    } catch (e) {
      console.warn(
        "[structured] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === toolName,
  );
  if (!block) {
    throw new LLMValidationError(
      "model did not call the required tool",
      res.content,
    );
  }
  const parsed = outputSchema.safeParse(block.input);
  if (!parsed.success) {
    throw new LLMValidationError(
      `tool input failed schema validation: ${parsed.error.message}`,
      block.input,
    );
  }
  return parsed.data;
}
```

- [ ] **Step 3: Update `callStructured` to delegate (no behaviour change)**

Replace the body of `callStructured` (the current ~70-line function) with:

```ts
export async function callStructured<T>(
  opts: StructuredCallOptions<T>,
): Promise<T> {
  // Legacy path: ALWAYS go through the Anthropic API tool_use loop,
  // regardless of LLM_AGENT_BACKEND_MAP. This is the migration safety
  // valve — agents that have not yet been migrated to dispatchStructured
  // see no behavioural change from env-routing experiments.
  // Migrated agents (Phase 1: critic_canon; Phase 3+: others) call
  // dispatchStructured directly and are subject to env routing there.

  const adHocContract: AgentStructuredContract<{ prompt: string }, T> = {
    agentName: opts.agentName,
    getOutputSchema: () => opts.schema,
    systemPrompt: typeof opts.system === "string" ? opts.system : "",
    buildPrompt: (i) => i.prompt,
    defaultMode: "mcp_submit_tool",
    mcp: { toolName: opts.schemaName, toolDescription: opts.schemaDescription },
  };

  return callViaAnthropicApi(adHocContract, opts.schema, {
    agentName: opts.agentName,
    payload: { prompt: opts.prompt },
    systemBlocks: opts.system,
    model: opts.model,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.cacheableSystem !== undefined
      ? { cacheableSystem: opts.cacheableSystem }
      : {}),
    ...(opts.onUsage !== undefined ? { onUsage: opts.onUsage } : {}),
  });
}
```

This preserves the public signature exactly AND guarantees no env-induced surprise for unmigrated callers — they always hit the tool_use API path, exactly as before this PR. The previous backend-invariant throw is removed because it was a defensive check for a routing layer that legacy callers should never see.

- [ ] **Step 4: Typecheck + run llm tests**

```bash
pnpm --filter @book-forge/llm typecheck
pnpm --filter @book-forge/llm test
```

Expected: all 43 existing tests still pass. If any test fails, the refactor changed behaviour — investigate before committing. Common pitfalls:
- system prompt fallback when `opts.system` is not a string — ensure both string and `SystemBlock[]` paths still work.
- ad-hoc contract's `systemPrompt: ""` is fine because `systemBlocks` overrides at the call site.

- [ ] **Step 5: Commit**

```bash
git add packages/llm/src/structured.ts
git commit -m "refactor(llm): extract callViaAnthropicApi from callStructured (behaviour parity)"
```

---

## Task 6: MCP submit-tool adapter

**Files:**
- Create: `packages/llm/src/clients/mcp-submit-tool.ts`

- [ ] **Step 1: Create the file**

Create `packages/llm/src/clients/mcp-submit-tool.ts`:

```ts
import { z, type ZodType, type ZodError } from "zod";
import {
  query,
  tool,
  createSdkMcpServer,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  LLMAuthError,
  LLMError,
  LLMNoToolCallError,
  LLMMultipleToolCallsError,
  LLMValidationError,
} from "../errors.js";
import { resolveModelId } from "../models.js";
import type { AgentStructuredContract } from "../types.js";
import type { ModelChoice } from "@book-forge/shared";

export interface McpSubmitToolInput<I> {
  payload: I;
  model: ModelChoice;
  /** Override of contract.systemPrompt for this call only (string-form only;
   *  block-array system prompts are not supported in MCP mode). */
  systemPromptOverride?: string;
  /** Override of contract.mcp.maxTurns for this call. */
  maxTurnsOverride?: number;
}

interface McpSubmitToolDiagnostics {
  modelId: string;
  toolCallCount: number;
  resultSubtype?: string;
  isError?: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface McpSubmitToolResult<O> {
  raw: O;
  diagnostics: McpSubmitToolDiagnostics;
}

function forceToolPrompt(userPrompt: string, toolName: string): string {
  return `${userPrompt}\n\n---\n\nYou MUST call exactly one tool: \`${toolName}\`. Do not answer in prose. The tool input must satisfy the schema. If no issues are found, submit a payload that the schema accepts (e.g. an empty issues array).`;
}

function isAuthErrorCode(code: string): boolean {
  return (
    code === "authentication_failed" ||
    code === "oauth_org_not_allowed" ||
    code === "billing_error"
  );
}

function summariseAssistantError(
  msg: SDKMessage,
  modelId: string,
): LLMError | undefined {
  if (msg.type !== "assistant") return undefined;
  const code = (msg as { error?: string }).error;
  if (!code) return undefined;
  if (isAuthErrorCode(code)) {
    return new LLMAuthError(
      `[subscription/${modelId}] auth/billing failure: ${code}. Check 'claude login' state.`,
    );
  }
  return new LLMError(`[subscription/${modelId}] ${code}`);
}

export async function callViaSdkMcpSubmitTool<I, O>(
  contract: AgentStructuredContract<I, O>,
  outputSchema: ZodType<O>,
  input: McpSubmitToolInput<I>,
): Promise<McpSubmitToolResult<O>> {
  if (!contract.mcp) {
    throw new LLMError(
      `[mcp-submit-tool] contract for "${contract.agentName}" has no mcp spec; cannot run in mcp_submit_tool mode`,
    );
  }
  const mcp = contract.mcp;
  const modelId = `subscription:${resolveModelId(input.model)}`;

  let capturedPayload: O | undefined;
  let capturedValidationError: ZodError | undefined;
  let toolCallCount = 0;

  // Pass the Zod schema directly. SDK 0.2.x `tool()` accepts the schema
  // object and validates args itself (matches the spike — Phase 0.2 Probe C
  // verified this shape). The cast satisfies TS without unwrapping
  // `.shape` (which is fragile and may not match the SDK contract).
  const toolInputSchema = outputSchema as unknown as Parameters<typeof tool>[2];
  const submitTool = tool(
    mcp.toolName,
    mcp.toolDescription,
    toolInputSchema,
    async (args: unknown) => {
      toolCallCount++;
      const parsed = outputSchema.safeParse(args);
      if (!parsed.success) {
        capturedValidationError = parsed.error;
        return {
          content: [
            {
              type: "text" as const,
              text: `Schema mismatch: ${parsed.error.message}`,
            },
          ],
          isError: true,
        };
      }
      capturedPayload = parsed.data;
      return {
        content: [{ type: "text" as const, text: "Accepted." }],
      };
    },
  );

  const serverName = `submit_${contract.agentName}`;
  const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });

  const userPrompt = contract.buildPrompt(input.payload);
  const options: Options = {
    model: resolveModelId(input.model),
    systemPrompt: input.systemPromptOverride ?? contract.systemPrompt,
    tools: [],
    mcpServers: { [serverName]: mcpServer },
    allowedTools: [`mcp__${serverName}__${mcp.toolName}`],
    maxTurns: input.maxTurnsOverride ?? mcp.maxTurns ?? 3,
  };

  const q = query({
    prompt: forceToolPrompt(userPrompt, mcp.toolName),
    options,
  });

  let resultMsg: SDKMessage | undefined;
  for await (const msg of q) {
    const authErr = summariseAssistantError(msg, modelId);
    if (authErr) throw authErr;
    if (msg.type === "result") resultMsg = msg;
  }

  if (capturedValidationError) {
    throw new LLMValidationError(
      `[subscription/${modelId}] mcp tool payload failed schema validation: ${capturedValidationError.message}`,
      undefined,
    );
  }
  if (toolCallCount === 0) {
    throw new LLMNoToolCallError(
      `[subscription/${modelId}] model did not call ${mcp.toolName}`,
    );
  }
  if (toolCallCount > 1) {
    throw new LLMMultipleToolCallsError(
      `[subscription/${modelId}] expected exactly one tool call, got ${toolCallCount}`,
    );
  }
  if (capturedPayload === undefined) {
    throw new LLMValidationError(
      `[subscription/${modelId}] no payload captured from tool handler`,
      undefined,
    );
  }

  const r = resultMsg as
    | {
        subtype?: string;
        is_error?: boolean;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
      }
    | undefined;

  return {
    raw: capturedPayload,
    diagnostics: {
      modelId,
      toolCallCount,
      resultSubtype: r?.subtype,
      isError: r?.is_error,
      inputTokens: r?.usage?.input_tokens ?? 0,
      outputTokens: r?.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: r?.usage?.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: r?.usage?.cache_read_input_tokens ?? 0,
    },
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @book-forge/llm typecheck
git add packages/llm/src/clients/mcp-submit-tool.ts
git commit -m "feat(llm): add callViaSdkMcpSubmitTool adapter (mode 2 backend)"
```

---

## Task 7: Dispatcher entry point

**Files:**
- Create: `packages/llm/src/dispatcher.ts`
- Modify: `packages/llm/src/index.ts`

- [ ] **Step 1: Create the dispatcher**

Create `packages/llm/src/dispatcher.ts`:

```ts
import type { ZodType } from "zod";
import { LLMError } from "./errors.js";
import { getAgentContract } from "./structured-registry.js";
import { resolveBackendForCall, resolveStructuredMode } from "./router.js";
import { callViaAnthropicApi } from "./structured.js";
import { callViaSdkMcpSubmitTool } from "./clients/mcp-submit-tool.js";
import type {
  AgentName,
  AgentStructuredContract,
  LLMBackend,
  StructuredMode,
} from "./types.js";
import type { ModelChoice } from "@book-forge/shared";
import type { SystemBlock } from "./stream.js";

export interface StructuredDiagnostics {
  modelId: string;
  backend: LLMBackend;
  mode?: StructuredMode;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  toolCallCount?: number;
  resultSubtype?: string;
  isError?: boolean;
  latencyMs: number;
}

export interface DispatchStructuredInput<I> {
  agentName: AgentName;
  payload: I;
  model: ModelChoice;
  /** Optional override of the contract's resolved mode for this call only. */
  mode?: StructuredMode;
  /** Override the system prompt — defaults to contract.systemPrompt. */
  systemBlocks?: SystemBlock[] | string;
  cacheableSystem?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Lightweight observability hook fired once after the call resolves. */
  onDiagnostics?: (d: StructuredDiagnostics) => void;
}

export interface DispatchStructuredResult<O> {
  raw: O;
  diagnostics: StructuredDiagnostics;
}

export async function dispatchStructured<I, O>(
  input: DispatchStructuredInput<I>,
): Promise<DispatchStructuredResult<O>> {
  const contract = getAgentContract(input.agentName) as AgentStructuredContract<I, O>;
  const outputSchema = contract.getOutputSchema(input.payload);
  const backend = resolveBackendForCall({
    agentName: input.agentName,
    provider: "anthropic",
    hasOutputSchema: true,
  });

  const start = performance.now();

  if (backend === "api") {
    let apiUsage: import("./structured.js").StructuredUsage | undefined;
    const raw = await callViaAnthropicApi(contract, outputSchema as ZodType<O>, {
      agentName: input.agentName,
      payload: input.payload,
      model: input.model,
      ...(input.systemBlocks !== undefined ? { systemBlocks: input.systemBlocks } : {}),
      ...(input.cacheableSystem !== undefined
        ? { cacheableSystem: input.cacheableSystem }
        : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      onUsage: (u) => {
        apiUsage = u;
      },
    });
    const validated = outputSchema.safeParse(raw);
    if (!validated.success) {
      throw new LLMError(
        `[dispatcher] post-validation failed for ${input.agentName}: ${validated.error.message}`,
      );
    }
    const diagnostics: StructuredDiagnostics = {
      modelId: apiUsage?.modelId ?? `api:${input.model}`,
      backend: "api",
      inputTokens: apiUsage?.inputTokens ?? 0,
      outputTokens: apiUsage?.outputTokens ?? 0,
      cacheCreationInputTokens: apiUsage?.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: apiUsage?.cacheReadInputTokens ?? 0,
      latencyMs: performance.now() - start,
    };
    input.onDiagnostics?.(diagnostics);
    return { raw: validated.data, diagnostics };
  }

  // backend === "subscription"
  const mode = resolveStructuredMode({
    agentName: input.agentName,
    contractDefault: contract.defaultMode,
    ...(input.mode !== undefined ? { perCall: input.mode } : {}),
  });

  if (mode !== "mcp_submit_tool") {
    throw new LLMError(
      `[dispatcher] mode "${mode}" not implemented in Phase 1; ` +
        `set LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP={"${input.agentName}":"mcp_submit_tool"} ` +
        `or wait for Phase 2+`,
    );
  }

  const sub = await callViaSdkMcpSubmitTool(contract, outputSchema as ZodType<O>, {
    payload: input.payload,
    model: input.model,
  });
  const validated = outputSchema.safeParse(sub.raw);
  if (!validated.success) {
    throw new LLMError(
      `[dispatcher] post-validation failed for ${input.agentName}: ${validated.error.message}`,
    );
  }
  const diagnostics: StructuredDiagnostics = {
    modelId: sub.diagnostics.modelId,
    backend: "subscription",
    mode,
    inputTokens: sub.diagnostics.inputTokens,
    outputTokens: sub.diagnostics.outputTokens,
    cacheCreationInputTokens: sub.diagnostics.cacheCreationInputTokens,
    cacheReadInputTokens: sub.diagnostics.cacheReadInputTokens,
    toolCallCount: sub.diagnostics.toolCallCount,
    resultSubtype: sub.diagnostics.resultSubtype,
    isError: sub.diagnostics.isError,
    latencyMs: performance.now() - start,
  };
  input.onDiagnostics?.(diagnostics);
  return { raw: validated.data, diagnostics };
}
```

- [ ] **Step 2: Re-export from barrel**

In `packages/llm/src/index.ts`:

```ts
export { dispatchStructured } from "./dispatcher.js";
export type {
  DispatchStructuredInput,
  DispatchStructuredResult,
  StructuredDiagnostics,
} from "./dispatcher.js";
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @book-forge/llm typecheck
git add packages/llm/src/dispatcher.ts packages/llm/src/index.ts
git commit -m "feat(llm): add dispatchStructured entry point routing api / mcp_submit_tool"
```

---

## Task 8: Bootstrap module + critic_canon contract

**Files:**
- Create: `packages/agents/src/bootstrap.ts`
- Modify: `packages/agents/src/critics/canon.ts`

- [ ] **Step 1: Read the existing critics/canon.ts before editing**

```bash
cat packages/agents/src/critics/canon.ts
```

Note all existing exports (e.g. `runCanonGuard`, any system-prompt constants, fixtures, helpers). **Do not delete or rename any export.** This task patches the file in place: keeps every existing public surface, adds a new `registerCanonCriticContract()` export, and rewrites only `runCanonGuard`'s internal LLM call to use `dispatchStructured`.

- [ ] **Step 2: Build the contract object and register helper at the top of the file**

After the existing imports in `packages/agents/src/critics/canon.ts`, add:

```ts
import type { z } from "zod";
import type { CriticInput, CriticReport } from "@book-forge/shared";
import { criticReportSchema } from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
} from "@book-forge/llm";

const canonOutputSchema = criticReportSchema.omit({ critic: true });
type CanonCriticOutput = z.infer<typeof canonOutputSchema>;
```

Reuse whatever `SYSTEM` / `TASK` constants the existing file already defines. If they exist, reference them by name in `systemPrompt` and `buildPrompt`. If the existing file does NOT define them as exports, leave them where they are — the contract closure can still access them from module scope.

Add at the bottom of the file (or near the existing `runCanonGuard` definition):

```ts
function buildCanonPrompt(input: CriticInput): string {
  // Reuse the prose-builder logic that runCritic already does. If
  // critics/base.ts has a private formatter, copy its body verbatim
  // into this function — we cannot import a non-exported helper from
  // base.ts without first exporting it (and that's a wider change
  // out of scope for Phase 1 pilot).
  const stableParts: string[] = [`Книга/контекст:\n${input.bookContext}`];
  if (input.previousChaptersSummary) {
    stableParts.push(
      `Предыдущие главы (краткое):\n${input.previousChaptersSummary}`,
    );
  }
  if (input.characterContext) stableParts.push(input.characterContext);
  if (input.loreContext) stableParts.push(input.loreContext);

  const volatileParts: string[] = [
    `Глава: "${input.chapterTitle}"`,
    `POV: ${input.pov}`,
    `Эмоциональная цель: ${input.emotionalGoal}`,
    `Текст главы:\n\n${input.chapterText}`,
    `\nЗадача:\n${TASK}`,
  ];

  return [...stableParts, ...volatileParts].join("\n\n---\n\n");
}

const canonCriticContract: AgentStructuredContract<CriticInput, CanonCriticOutput> = {
  agentName: "critic_canon",
  getOutputSchema: () => canonOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildCanonPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_critique_canon",
    toolDescription:
      "Submit a structured critique report from the canon critic. Return all issues found with severity and concrete suggestions.",
  },
};

export function registerCanonCriticContract(): void {
  registerAgentContract(canonCriticContract);
}
```

If `SYSTEM` and `TASK` are not defined in this file (they may live in `critics/base.ts` or be inline strings), inline them as local constants here — paste the prose verbatim from wherever it currently lives. Do NOT modify base.ts.

- [ ] **Step 3: Rewrite the body of `runCanonGuard` (only its body, not its signature)**

Replace the existing body of `runCanonGuard` with:

```ts
export async function runCanonGuard(input: CriticInput): Promise<CriticReport> {
  const { raw } = await dispatchStructured<CriticInput, CanonCriticOutput>({
    agentName: "critic_canon",
    payload: input,
    model: input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 4096,
  });
  return { ...raw, critic: "canon" } as CriticReport;
}
```

Delete any old code inside `runCanonGuard` that called `runCritic(...)` — it is replaced by the dispatcher path. **Do not delete `runCritic` itself or `critics/base.ts`** — other critics still use them.

This deliberately bypasses the legacy `runCritic` for `critic_canon` only. Other critics (style, editor, reader) still go through `runCritic` until Phase 3.

- [ ] **Step 2: Create bootstrap.ts**

Create `packages/agents/src/bootstrap.ts`:

```ts
import { registerCanonCriticContract } from "./critics/canon.js";

/**
 * Registers all agent structured-output contracts. Must be called once at
 * server / runtime startup. Subsequent calls are idempotent (the registry
 * overwrites entries on re-register).
 */
export function registerAllAgentContracts(): void {
  registerCanonCriticContract();
  // Phase 3: register critic_style, critic_editor, critic_reader.
  // Phase 4: register plot_outline, plot_chapter_plan, canon_guard, style_extractor.
  // Phase 5: register critic_dialogue, foreshadowing_planner.
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @book-forge/agents typecheck
git add packages/agents/src/critics/canon.ts packages/agents/src/bootstrap.ts
git commit -m "feat(agents): register critic_canon contract; runCanonGuard uses dispatchStructured (pilot)"
```

---

## Task 9: Server startup wiring

**Files:**
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Add bootstrap call**

Read the existing `apps/server/src/index.ts` (it sets up Hono routes, DB, etc.). At the very top, after imports but BEFORE creating the app or starting the listener, add:

```ts
import { registerAllAgentContracts } from "@book-forge/agents/bootstrap";
import { assertAllStructuredAgentsHaveContracts } from "@book-forge/llm";

registerAllAgentContracts();
assertAllStructuredAgentsHaveContracts();
```

If `@book-forge/agents/bootstrap` is not a path that resolves, add it to the agents package.json `exports` field:

```json
"exports": {
  ".": "./src/index.ts",
  "./bootstrap": "./src/bootstrap.ts"
}
```

- [ ] **Step 2: Typecheck server**

```bash
pnpm --filter @book-forge/server typecheck
```

If the bootstrap path import fails, fix the agents `package.json` exports first.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/index.ts packages/agents/package.json
git commit -m "feat(server): wire registerAllAgentContracts at startup with assertion"
```

---

## Task 10: Registry tests

**Files:**
- Create: `packages/llm/src/__tests__/structured-registry.test.ts`

- [ ] **Step 1: Add the test file**

Create `packages/llm/src/__tests__/structured-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import {
  clearStructuredRegistry,
  getAgentContract,
  listRegisteredAgents,
  registerAgentContract,
  assertAllStructuredAgentsHaveContracts,
  assertUniqueMcpToolNames,
  STRUCTURED_AGENT_NAMES,
  type AgentStructuredContract,
} from "../index.js";
import { LLMError } from "../errors.js";

const sampleSchema = z.object({ kind: z.string(), n: z.number() });

function makeContract(
  agentName: "critic_canon" | "critic_style",
  toolName: string,
): AgentStructuredContract<{ s: string }, { kind: string; n: number }> {
  return {
    agentName,
    getOutputSchema: () => sampleSchema,
    systemPrompt: "system",
    buildPrompt: (i) => i.s,
    defaultMode: "mcp_submit_tool",
    mcp: { toolName, toolDescription: "test" },
  };
}

beforeEach(() => {
  clearStructuredRegistry();
});

describe("structured-registry", () => {
  it("registerAgentContract + getAgentContract round-trip", () => {
    const c = makeContract("critic_canon", "submit_critique_canon");
    registerAgentContract(c);
    expect(getAgentContract("critic_canon")).toBe(c);
  });

  it("re-register overwrites without error", () => {
    const c1 = makeContract("critic_canon", "submit_critique_canon");
    const c2 = makeContract("critic_canon", "submit_critique_canon_v2");
    registerAgentContract(c1);
    registerAgentContract(c2);
    expect(getAgentContract("critic_canon")).toBe(c2);
  });

  it("clearStructuredRegistry empties", () => {
    registerAgentContract(makeContract("critic_canon", "submit_critique_canon"));
    clearStructuredRegistry();
    expect(listRegisteredAgents()).toEqual([]);
  });

  it("getAgentContract on unknown agent throws LLMError", () => {
    expect(() => getAgentContract("critic_canon")).toThrow(LLMError);
  });

  it("assertAllStructuredAgentsHaveContracts raises with missing list", () => {
    // Phase 1: STRUCTURED_AGENT_NAMES = {"critic_canon"}.
    expect(() => assertAllStructuredAgentsHaveContracts()).toThrow(
      /missing contracts for: critic_canon/,
    );
  });

  it("assertAllStructuredAgentsHaveContracts passes when all registered", () => {
    registerAgentContract(makeContract("critic_canon", "submit_critique_canon"));
    expect(() => assertAllStructuredAgentsHaveContracts()).not.toThrow();
  });

  it("assertUniqueMcpToolNames raises on duplicate toolName", () => {
    registerAgentContract(makeContract("critic_canon", "duplicate_tool"));
    registerAgentContract(makeContract("critic_style", "duplicate_tool"));
    expect(() => assertUniqueMcpToolNames()).toThrow(/duplicate mcp\.toolName/);
  });

  it("STRUCTURED_AGENT_NAMES contains critic_canon for Phase 1", () => {
    expect(STRUCTURED_AGENT_NAMES.has("critic_canon")).toBe(true);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @book-forge/llm test
git add packages/llm/src/__tests__/structured-registry.test.ts
git commit -m "test(llm): registry CRUD, assertion behaviour, parity helpers"
```

Expected: all 7 new tests pass. Total llm tests now 50.

---

## Task 11: Parity test for STRUCTURED_AGENT_NAMES

**Files:**
- Create: `packages/llm/src/__tests__/structured-agents-parity.test.ts`

- [ ] **Step 1: Create the test**

Create the file:

```ts
import { describe, it, expect } from "vitest";
import { AGENT_NAMES, STRUCTURED_AGENT_NAMES, type AgentName } from "../index.js";

const KNOWN_FREE_TEXT_OR_NOLLM: AgentName[] = [
  "writer",
  "editor",
  "summarizer",
  "inline",
  "lore",
  "character",
  // Phase 3-5 will move these out as their contracts land:
  "plot",
  "canon_guard",
  "critic_style",
  "critic_editor",
  "critic_reader",
  "style_extractor",
];

describe("STRUCTURED_AGENT_NAMES drift guard", () => {
  it("covers every AgentName except the documented exclusion list", () => {
    const expected = new Set(
      AGENT_NAMES.filter((n) => !KNOWN_FREE_TEXT_OR_NOLLM.includes(n)),
    );
    const actual = new Set(STRUCTURED_AGENT_NAMES);
    expect(actual).toEqual(expected);
  });
});
```

When Phase 3 migrates `critic_style`, the contributor must (a) add `critic_style` to `STRUCTURED_AGENT_NAMES` and (b) remove it from `KNOWN_FREE_TEXT_OR_NOLLM` here. The test fails until both edits land.

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @book-forge/llm test
git add packages/llm/src/__tests__/structured-agents-parity.test.ts
git commit -m "test(llm): parity guard between STRUCTURED_AGENT_NAMES and AgentName enum"
```

---

## Task 12: MCP submit-tool adapter unit tests

**Files:**
- Create: `packages/llm/src/__tests__/mcp-submit-tool.test.ts`

- [ ] **Step 1: Add tests with SDK mocked at module boundary**

Create the file:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const queryQueue: Array<() => AsyncIterable<unknown>> = [];
// Module-scope reference to the most-recently-built MCP server's tools
// list. The mock for createSdkMcpServer captures it; tests use
// `lastTools[0].handler(...)` to simulate the model calling the tool.
let lastTools: Array<{ handler: (args: unknown) => Promise<unknown> }> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    const factory = queryQueue.shift();
    if (!factory) throw new Error("test: no fake response queued");
    return factory();
  }),
  tool: vi.fn(
    (
      name: string,
      description: string,
      schema: unknown,
      handler: (args: unknown) => Promise<unknown>,
    ) => ({ name, description, schema, handler }),
  ),
  createSdkMcpServer: vi.fn(
    ({
      name,
      tools,
    }: {
      name: string;
      tools: Array<{ handler: (args: unknown) => Promise<unknown> }>;
    }) => {
      lastTools = tools;
      return { name, tools };
    },
  ),
}));

import { callViaSdkMcpSubmitTool } from "../clients/mcp-submit-tool.js";
import {
  LLMAuthError,
  LLMNoToolCallError,
  LLMMultipleToolCallsError,
  LLMValidationError,
} from "../errors.js";
import type { AgentStructuredContract } from "../types.js";

const fixtureSchema = z.object({ city: z.string(), n: z.number() });

const fixtureContract: AgentStructuredContract<{ q: string }, z.infer<typeof fixtureSchema>> = {
  agentName: "critic_canon",
  getOutputSchema: () => fixtureSchema,
  systemPrompt: "system",
  buildPrompt: (i) => i.q,
  defaultMode: "mcp_submit_tool",
  mcp: { toolName: "submit_fixture", toolDescription: "test" },
};

beforeEach(() => {
  queryQueue.length = 0;
  lastTools = [];
});

function asyncGen<T>(
  items: Array<T | (() => Promise<unknown>)>,
): AsyncIterable<T> {
  return (async function* () {
    for (const it of items) {
      if (typeof it === "function") {
        await (it as () => Promise<unknown>)();
        continue;
      }
      yield it as T;
    }
  })();
}

const successResult = {
  type: "result",
  subtype: "success",
  is_error: false,
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_input_tokens: 30000,
    cache_read_input_tokens: 30000,
  },
};

describe("callViaSdkMcpSubmitTool", () => {
  it("happy path captures payload and returns diagnostics", async () => {
    queryQueue.push(() =>
      asyncGen([
        async () => {
          await lastTools[0]!.handler({ city: "Paris", n: 42 });
        },
        successResult,
      ]),
    );

    const result = await callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
      payload: { q: "test" },
      model: "sonnet",
    });
    expect(result.raw).toEqual({ city: "Paris", n: 42 });
    expect(result.diagnostics.toolCallCount).toBe(1);
    expect(result.diagnostics.modelId).toMatch(/^subscription:/);
    expect(result.diagnostics.inputTokens).toBe(100);
    expect(result.diagnostics.outputTokens).toBe(20);
  });

  it("throws LLMNoToolCallError when model never invokes tool", async () => {
    queryQueue.push(() => asyncGen([successResult]));
    await expect(
      callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
        payload: { q: "test" },
        model: "sonnet",
      }),
    ).rejects.toBeInstanceOf(LLMNoToolCallError);
  });

  it("throws LLMMultipleToolCallsError when model invokes tool twice", async () => {
    queryQueue.push(() =>
      asyncGen([
        async () => {
          await lastTools[0]!.handler({ city: "Paris", n: 1 });
          await lastTools[0]!.handler({ city: "Berlin", n: 2 });
        },
        successResult,
      ]),
    );
    await expect(
      callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
        payload: { q: "test" },
        model: "sonnet",
      }),
    ).rejects.toBeInstanceOf(LLMMultipleToolCallsError);
  });

  it("throws LLMValidationError when handler captures invalid payload", async () => {
    queryQueue.push(() =>
      asyncGen([
        async () => {
          await lastTools[0]!.handler({ city: 42, n: "wrong" });
        },
        successResult,
      ]),
    );
    await expect(
      callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
        payload: { q: "test" },
        model: "sonnet",
      }),
    ).rejects.toBeInstanceOf(LLMValidationError);
  });

  it("throws LLMAuthError on assistant error=authentication_failed", async () => {
    queryQueue.push(() =>
      asyncGen([
        { type: "assistant", error: "authentication_failed", message: { content: [] } },
      ]),
    );
    await expect(
      callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
        payload: { q: "test" },
        model: "sonnet",
      }),
    ).rejects.toBeInstanceOf(LLMAuthError);
  });

  it("throws LLMError when contract has no mcp spec", async () => {
    const contractWithoutMcp = { ...fixtureContract, mcp: undefined };
    await expect(
      callViaSdkMcpSubmitTool(contractWithoutMcp, fixtureSchema, {
        payload: { q: "test" },
        model: "sonnet",
      }),
    ).rejects.toThrow(/no mcp spec/);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @book-forge/llm test
git add packages/llm/src/__tests__/mcp-submit-tool.test.ts
git commit -m "test(llm): mcp-submit-tool adapter — happy + 4 error paths"
```

If any test fails because the `tool()` mock doesn't match the actual SDK signature shape, adjust the mock to match.

---

## Task 13: Dispatcher integration tests

**Files:**
- Create: `packages/llm/src/__tests__/dispatcher.test.ts`

- [ ] **Step 1: Add tests covering both backend paths**

Create the file:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

vi.mock("../clients/mcp-submit-tool.js", () => ({
  callViaSdkMcpSubmitTool: vi.fn(),
}));

vi.mock("../structured.js", async () => {
  const actual = await vi.importActual<typeof import("../structured.js")>("../structured.js");
  return {
    ...actual,
    callViaAnthropicApi: vi.fn(),
  };
});

import { dispatchStructured } from "../dispatcher.js";
import { clearStructuredRegistry, registerAgentContract } from "../structured-registry.js";
import { callViaSdkMcpSubmitTool } from "../clients/mcp-submit-tool.js";
import { callViaAnthropicApi } from "../structured.js";
import type { AgentStructuredContract } from "../types.js";

const sampleSchema = z.object({ value: z.number() });

const sampleContract: AgentStructuredContract<{ q: string }, z.infer<typeof sampleSchema>> = {
  agentName: "critic_canon",
  getOutputSchema: () => sampleSchema,
  systemPrompt: "system",
  buildPrompt: (i) => i.q,
  defaultMode: "mcp_submit_tool",
  mcp: { toolName: "submit_test", toolDescription: "test" },
};

beforeEach(() => {
  clearStructuredRegistry();
  registerAgentContract(sampleContract);
  vi.clearAllMocks();
  delete process.env.LLM_AGENT_BACKEND_MAP;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP;
});

afterEach(() => {
  delete process.env.LLM_AGENT_BACKEND_MAP;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE;
  delete process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP;
});

describe("dispatchStructured", () => {
  it("subscription default routes to callViaSdkMcpSubmitTool", async () => {
    vi.mocked(callViaSdkMcpSubmitTool).mockResolvedValue({
      raw: { value: 7 },
      diagnostics: {
        modelId: "subscription:opaque",  // dispatcher just propagates whatever the adapter returns
        toolCallCount: 1,
        resultSubtype: "success",
        isError: false,
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationInputTokens: 30000,
        cacheReadInputTokens: 30000,
      },
    });
    const r = await dispatchStructured<{ q: string }, z.infer<typeof sampleSchema>>({
      agentName: "critic_canon",
      payload: { q: "x" },
      model: "sonnet",
    });
    expect(r.raw).toEqual({ value: 7 });
    expect(r.diagnostics.backend).toBe("subscription");
    expect(r.diagnostics.mode).toBe("mcp_submit_tool");
    expect(callViaSdkMcpSubmitTool).toHaveBeenCalledOnce();
    expect(callViaAnthropicApi).not.toHaveBeenCalled();
  });

  it("api backend routes to callViaAnthropicApi", async () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ critic_canon: "api" });
    vi.mocked(callViaAnthropicApi).mockResolvedValue({ value: 42 });
    const r = await dispatchStructured<{ q: string }, z.infer<typeof sampleSchema>>({
      agentName: "critic_canon",
      payload: { q: "x" },
      model: "sonnet",
    });
    expect(r.raw).toEqual({ value: 42 });
    expect(r.diagnostics.backend).toBe("api");
    expect(callViaAnthropicApi).toHaveBeenCalledOnce();
    expect(callViaSdkMcpSubmitTool).not.toHaveBeenCalled();
  });

  it("per-call mode override is honoured", async () => {
    // critic_canon defaults to subscription. Force native, expect a clear error.
    await expect(
      dispatchStructured({
        agentName: "critic_canon",
        payload: { q: "x" },
        model: "sonnet",
        mode: "native_output_format",
      }),
    ).rejects.toThrow(/mode "native_output_format" not implemented/);
  });

  it("env LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP per-agent forces a specific mode", async () => {
    process.env.LLM_SUBSCRIPTION_STRUCTURED_MODE_MAP = JSON.stringify({
      critic_canon: "hybrid_generate_extract",
    });
    await expect(
      dispatchStructured({ agentName: "critic_canon", payload: { q: "x" }, model: "sonnet" }),
    ).rejects.toThrow(/mode "hybrid_generate_extract" not implemented/);
  });

  it("post-validates raw output", async () => {
    vi.mocked(callViaSdkMcpSubmitTool).mockResolvedValue({
      raw: { value: "not a number" } as unknown as z.infer<typeof sampleSchema>,
      diagnostics: {
        modelId: "subscription:opaque",  // dispatcher just propagates whatever the adapter returns
        toolCallCount: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
    await expect(
      dispatchStructured({ agentName: "critic_canon", payload: { q: "x" }, model: "sonnet" }),
    ).rejects.toThrow(/post-validation failed/);
  });

  it("emits onDiagnostics on success", async () => {
    vi.mocked(callViaSdkMcpSubmitTool).mockResolvedValue({
      raw: { value: 1 },
      diagnostics: {
        modelId: "subscription:opaque",  // dispatcher just propagates whatever the adapter returns
        toolCallCount: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
    });
    const seen: unknown[] = [];
    await dispatchStructured({
      agentName: "critic_canon",
      payload: { q: "x" },
      model: "sonnet",
      onDiagnostics: (d) => seen.push(d),
    });
    expect(seen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @book-forge/llm test
git add packages/llm/src/__tests__/dispatcher.test.ts
git commit -m "test(llm): dispatcher routing api / mcp / mode override / post-validate / diagnostics"
```

---

## Task 14: Workspace verification

- [ ] **Step 1: Full typecheck**

```bash
cd "d:/PROJECTS/BOOKOPIS"
pnpm -r typecheck
```

Expected: all 7 packages green.

- [ ] **Step 2: Full test**

```bash
pnpm -r test
```

Expected: 157 baseline + 7 registry + 1 parity + 6 mcp-tool + 6 dispatcher = 177 tests, all passing.

- [ ] **Step 3: Verify server boots without throwing**

In a separate terminal (this is interactive — skip in non-interactive environments):

```bash
pnpm --filter @book-forge/server dev
```

Expected: server starts, no `assertAllStructuredAgentsHaveContracts` error in logs. Kill with Ctrl-C after confirming.

- [ ] **Step 4: Commit any incidental fixes**

If Step 1-3 forced any small fix (e.g. server import path), commit:

```bash
git add -A
git commit -m "fix: incidental adjustments to keep workspace green after Phase 1"
```

If nothing needed fixing, skip.

---

## Task 15: Manual smoke against subscription (optional but recommended)

- [ ] **Step 1: Pick an existing book + chapter in your local DB** with at least one written chapter that has canon entities (characters, locations) attached.

- [ ] **Step 2: Trigger the canon critic via the existing route**, e.g. through the UI's "запустить критика" button or via:

```bash
curl -X POST http://localhost:3000/api/books/<bookId>/chapters/<chapterId>/critique \
  -H "Content-Type: application/json" \
  -d '{ "critics": ["canon"] }'
```

(Adapt to the project's actual route shape — check `apps/server/src/routes/critique.ts`.)

- [ ] **Step 3: Verify the critique result** has the expected `CriticReport` shape (issues array + overallNotes). Check server logs for any `[subscription/...]` entries — they should mention `claude-sonnet-4-6` and zero direct API spend.

- [ ] **Step 4: Verify `llm_usage` row** (if telemetry is wired) shows `modelId` starting with `subscription:`.

If smoke passes, Phase 1 is verified end-to-end.

---

## Task 16: Push

- [ ] **Step 1: Push all Phase 1 commits**

```bash
cd "d:/PROJECTS/BOOKOPIS"
git push origin main
```

- [ ] **Step 2: Confirm on GitHub** that the chain extends from `7cc6cc0` (Phase 0.1 final) → Phase 0.2 commits → Phase 1 commits.

---

## Done criteria

- [ ] Three new error classes exist and are exported.
- [ ] `AgentStructuredContract`, `AgentMcpSpec`, `StructuredMode`, `STRUCTURED_AGENT_NAMES` exported.
- [ ] Registry module exposes the 7 functions per spec §3.2 + Task 3 list.
- [ ] `resolveStructuredMode` honours per-call > env-map > env-global > contract default.
- [ ] `callViaAnthropicApi` extracted from `callStructured`; legacy `callStructured` wraps it; behaviour parity verified by 43 existing llm tests still passing.
- [ ] `callViaSdkMcpSubmitTool` adapter implemented with auth/no-tool/multiple-tool/validation error mapping.
- [ ] `dispatchStructured` routes api / mcp_submit_tool, post-validates, emits diagnostics, throws on unimplemented modes.
- [ ] `critic_canon` migrated to dispatcher; other critics unchanged.
- [ ] Server startup calls `registerAllAgentContracts()` then `assertAllStructuredAgentsHaveContracts()`.
- [ ] New tests: 7 registry + 1 parity + 6 mcp-tool + 6 dispatcher = 20 new tests pass.
- [ ] Existing 43 llm tests + 91 server + 14 web + 9 shared still pass.
- [ ] `pnpm -r typecheck` green; `pnpm -r test` reports 177 tests across packages.
- [ ] All commits pushed to `origin/main`.
- [ ] (Optional) Manual smoke confirmed canon critic runs through subscription with correct `CriticReport` output.

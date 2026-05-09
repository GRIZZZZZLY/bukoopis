# Phase 0.2 — SDK Capability Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a throwaway diagnostic script `scripts/spike-agent-sdk.ts` that exercises both happy and failure paths of Claude Agent SDK structured-output integration against the user's Max-5 subscription, then record a decision matrix in the etap-0.2.4 design doc to choose the default subscription mode for Phase 1+.

**Architecture:** One TypeScript file in a new top-level `scripts/` directory, run via `npx tsx scripts/spike-agent-sdk.ts`. The script sets up a small Zod fixture, runs each of 6 probes (3 happy + 3 failure), captures SDK message subtypes / latencies / token counts / SDK error codes, and prints a markdown matrix to stdout. Output is captured to `.planning/spike-output.md`. The design doc gains an appendix recording the chosen default mode and observed message subtypes — feeding directly into Phase 1's dispatcher implementation. The script is preserved in the repo (not deleted) so it can be re-run when SDK versions bump.

**Tech Stack:** TypeScript 5.7, tsx 4.19, Zod 4.4.3, `@anthropic-ai/claude-agent-sdk@0.2.136`, Claude Code CLI credentials (no `ANTHROPIC_API_KEY`).

---

## Pre-conditions

- Phase 0.1 merged: zod 4.4.3 resolved, `z.toJSONSchema` available, `pnpm -r typecheck` and `pnpm -r test` green.
- User has `claude` CLI installed and `claude login`-ed (Max-5).
- User accepts that the spike will consume ~6 small Sonnet messages from their Max-5 quota (negligible cost in quota terms).

## Files to create or modify

| File | Reason |
|---|---|
| `scripts/spike-agent-sdk.ts` | The spike entry point. New file. |
| `scripts/package.json` | Optional: minimal package.json so `scripts/` has its own resolution surface. **Not strictly needed** — `tsx` resolves from monorepo root. Skip unless tsx complains. |
| `.planning/spike-output.md` | Captured stdout from the spike run. New file (untracked or committed — see Task 9). |
| `.planning/design/2026-05-09-subscription-mcp-tools-design.md` | Append appendix §13 with the decision matrix and chosen default mode. |
| `docs/zod-4-migration.md` | Optional: cross-link to Phase 0.2 result. Not required. |

---

## Task 1: Scaffold spike script with shared helpers

**Files:**
- Create: `scripts/spike-agent-sdk.ts`

- [ ] **Step 1: Create the script with imports, fixture schema, and harness types**

Create `d:/PROJECTS/BOOKOPIS/scripts/spike-agent-sdk.ts` with:

```ts
/**
 * Phase 0.2 SDK Capability Spike — etap 0.2.4.
 *
 * Run with: `npx tsx scripts/spike-agent-sdk.ts`
 *
 * Exercises Claude Agent SDK against the user's Pro/Max subscription via
 * `claude` CLI credentials. Probes both `outputFormat` (native structured
 * output) and `mcpServers + tool()` (MCP submit-tool) paths, on both happy
 * and failure scenarios.
 *
 * Prints a markdown decision matrix to stdout. Capture with:
 *   `npx tsx scripts/spike-agent-sdk.ts > .planning/spike-output.md`
 *
 * Expected quota cost: ~6 small Sonnet messages (~few cents in API equiv,
 * negligible against Max-5 limits).
 */
import { z } from "zod";
import {
  query,
  tool,
  createSdkMcpServer,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

// Model id is configurable to avoid hard-coding a literal Sonnet version that
// may not exist as an Agent SDK alias yet. Default to the SDK alias "sonnet"
// (resolves to current Sonnet on the user's account) and let env override.
const SPIKE_MODEL = process.env.SPIKE_MODEL ?? "sonnet";

interface ProbeResult {
  name: string;
  ok: boolean;
  durationMs: number;
  turns: number;
  messageSubtypes: string[];
  resultSubtype?: string;
  isError?: boolean;
  usage?: unknown;
  totalCostUsd?: unknown;
  errorClass?: string;
  errorMessage?: string;
  capturedPayload?: unknown;
  toolCallCount?: number;
}

interface ResultDiagnostics {
  resultSubtype?: string;
  isError?: boolean;
  turns: number;
  usage?: unknown;
  totalCostUsd?: unknown;
  apiErrorStatus?: number;
  apiErrorMessage?: string;
}

function getResult(messages: SDKMessage[]): SDKMessage | undefined {
  return messages.find((m) => m.type === "result");
}

function extractResultDiagnostics(result: SDKMessage | undefined): ResultDiagnostics {
  const r = result as
    | {
        subtype?: string;
        is_error?: boolean;
        num_turns?: number;
        usage?: unknown;
        total_cost_usd?: unknown;
        api_error_status?: number;
        api_error_message?: string;
      }
    | undefined;
  return {
    resultSubtype: r?.subtype,
    isError: r?.is_error,
    turns: r?.num_turns ?? 0,
    usage: r?.usage,
    totalCostUsd: r?.total_cost_usd,
    apiErrorStatus: r?.api_error_status,
    apiErrorMessage: r?.api_error_message,
  };
}

const fixtureSchema = z.object({
  city: z.string(),
  population: z.number().int().positive(),
  isCapital: z.boolean(),
});
type Fixture = z.infer<typeof fixtureSchema>;

async function drainQuery(q: AsyncGenerator<SDKMessage, void>): Promise<{
  messages: SDKMessage[];
  durationMs: number;
}> {
  const start = performance.now();
  const messages: SDKMessage[] = [];
  for await (const m of q) messages.push(m);
  return { messages, durationMs: performance.now() - start };
}

function summariseSubtypes(messages: SDKMessage[]): string[] {
  const out = new Set<string>();
  for (const m of messages) {
    const sub =
      m.type +
      ((m as { subtype?: string }).subtype
        ? `:${(m as { subtype?: string }).subtype}`
        : "");
    out.add(sub);
  }
  return [...out];
}

async function runProbe(
  name: string,
  fn: () => Promise<Omit<ProbeResult, "name">>,
): Promise<ProbeResult> {
  console.error(`\n>>> Probe: ${name}`);
  try {
    const r = await fn();
    return { name, ...r };
  } catch (e) {
    return {
      name,
      ok: false,
      durationMs: 0,
      turns: 0,
      messageSubtypes: [],
      errorClass: e instanceof Error ? e.constructor.name : "unknown",
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

// Probes added in subsequent tasks.
const probes: Array<() => Promise<ProbeResult>> = [];

async function main(): Promise<void> {
  const results: ProbeResult[] = [];
  for (const p of probes) {
    results.push(await p());
  }
  printMatrix(results);
}

function printMatrix(results: ProbeResult[]): void {
  const fmt = (v: string | number | boolean | undefined) =>
    v === undefined ? "—" : String(v);
  console.log("\n# Phase 0.2 SDK Capability Spike — Results\n");
  console.log("| Probe | OK | Duration ms | Turns | Tool calls | Result subtype | is_error | Error class | Error msg | Subtypes |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.ok ? "✅" : "❌"} | ${fmt(r.durationMs)} | ${fmt(r.turns)} | ${fmt(r.toolCallCount)} | ${fmt(r.resultSubtype)} | ${fmt(r.isError)} | ${fmt(r.errorClass)} | ${fmt(r.errorMessage?.slice(0, 80))} | ${r.messageSubtypes.join(", ") || "—"} |`,
    );
  }
  console.log("\n## Raw diagnostics per probe\n");
  for (const r of results) {
    console.log(`### ${r.name}\n`);
    console.log("```json");
    console.log(JSON.stringify(
      {
        durationMs: r.durationMs,
        turns: r.turns,
        toolCallCount: r.toolCallCount,
        resultSubtype: r.resultSubtype,
        isError: r.isError,
        usage: r.usage,
        totalCostUsd: r.totalCostUsd,
        capturedPayload: r.capturedPayload,
        messageSubtypes: r.messageSubtypes,
        errorClass: r.errorClass,
        errorMessage: r.errorMessage,
      },
      null,
      2,
    ));
    console.log("```\n");
  }
}

main().catch((e) => {
  console.error("Spike crashed:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd "d:/PROJECTS/BOOKOPIS" && pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts`

Expected: zero errors. If `tool` / `createSdkMcpServer` are not exported from the package main, this is a discovery — adjust the import to `@anthropic-ai/claude-agent-sdk/sdk-tools`.

- [ ] **Step 3: Commit**

```bash
cd "d:/PROJECTS/BOOKOPIS"
git add scripts/spike-agent-sdk.ts
git commit -m "chore(spike): scaffold Phase 0.2 SDK capability spike"
```

---

## Task 2: Probe A — native_output_format happy path

**Files:**
- Modify: `scripts/spike-agent-sdk.ts` (add probe + register in `probes` array)

- [ ] **Step 1: Add probe function**

Insert before `const probes: Array<...> = [];`:

```ts
async function probeNativeHappy(): Promise<ProbeResult> {
  return runProbe("native_output_format / happy", async () => {
    const outputFormat = {
      type: "json_schema" as const,
      schema: z.toJSONSchema(fixtureSchema),
    };
    const options: Options = {
      model: SPIKE_MODEL,
      systemPrompt:
        "You are a fact lookup. Return strictly valid JSON matching the schema.",
      tools: [],
      // Note: outputFormat is passed via Options; SDK 0.2.136 may name this
      // field differently — Phase 0.2 verifies the actual key.
      ...({ outputFormat } as Record<string, unknown>),
      maxTurns: 1,
    };
    const q = query({
      prompt: "Return the city of Paris with its population (~2_100_000) and capital status.",
      options,
    });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    const structured = (result as { structured_output?: unknown } | undefined)
      ?.structured_output;
    const parsed =
      structured !== undefined
        ? fixtureSchema.safeParse(structured)
        : { success: false, error: { message: "no structured_output on result" } };
    return {
      ok: parsed.success,
      durationMs,
      turns: diag.turns,
      messageSubtypes: subtypes,
      resultSubtype: diag.resultSubtype,
      isError: diag.isError,
      usage: diag.usage,
      totalCostUsd: diag.totalCostUsd,
      capturedPayload: parsed.success ? (parsed as { data: Fixture }).data : undefined,
      errorMessage: parsed.success
        ? undefined
        : (parsed as { error: { message: string } }).error.message,
      errorClass: parsed.success ? undefined : "SchemaMismatch",
    };
  });
}
```

Then add to the registry: `probes.push(probeNativeHappy);`

- [ ] **Step 2: Verify typecheck**

Run: `cd "d:/PROJECTS/BOOKOPIS" && pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts`
Expected: zero errors.

If the SDK rejects the `outputFormat` field name (e.g. it's actually `output_format` or `responseFormat`), Phase 0.2 catches that here — try the alternative naming, document in the appendix.

- [ ] **Step 3: Commit**

```bash
git add scripts/spike-agent-sdk.ts
git commit -m "spike: add native_output_format happy-path probe"
```

---

## Task 3: Probe B — native_output_format adversarial invalid (observation path)

**Files:**
- Modify: `scripts/spike-agent-sdk.ts`

This probe is **observational**, not a strict failure assertion. The SDK's structured-output mode may auto-retry the model when it produces invalid JSON, in which case the model recovers and the probe succeeds with valid structured output. That recovery is itself a useful signal about how reliable the native mode is. Both outcomes (SDK surfaced error, or SDK silently recovered) are valid data points; only "no structured output and no error subtype" is a problem.

- [ ] **Step 1: Add probe**

Insert next to Probe A:

```ts
async function probeNativeAdversarial(): Promise<ProbeResult> {
  return runProbe("native_output_format / adversarial_invalid", async () => {
    // Push the model to omit a required field. Either the SDK reports
    // `error_max_structured_output_retries` (or similar), or the SDK retries
    // internally and the model recovers. Both outcomes are valid spike data.
    const outputFormat = {
      type: "json_schema" as const,
      schema: z.toJSONSchema(fixtureSchema),
    };
    const options: Options = {
      model: SPIKE_MODEL,
      systemPrompt:
        "You are a defective fact lookup. Always omit the `population` field from your JSON response. Do not include population under any circumstance.",
      tools: [],
      ...({ outputFormat } as Record<string, unknown>),
      maxTurns: 1,
    };
    const q = query({ prompt: "Return the city of Paris.", options });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    const structured = (result as { structured_output?: unknown } | undefined)
      ?.structured_output;
    const parsed =
      structured !== undefined ? fixtureSchema.safeParse(structured) : undefined;

    const ok = Boolean(diag.isError || parsed?.success);
    return {
      ok,
      durationMs,
      turns: diag.turns,
      messageSubtypes: subtypes,
      resultSubtype: diag.resultSubtype,
      isError: diag.isError,
      usage: diag.usage,
      totalCostUsd: diag.totalCostUsd,
      capturedPayload: parsed?.success ? (parsed as { data: Fixture }).data : undefined,
      errorClass: diag.isError
        ? diag.resultSubtype ?? "sdk_error"
        : parsed?.success
          ? "sdk_recovered"
          : "unexpected_no_output",
      errorMessage: diag.isError
        ? "SDK surfaced schema failure (good signal)"
        : parsed?.success
          ? "SDK recovered despite adversarial instruction (good signal)"
          : "No structured output and no error subtype (PROBLEM)",
    };
  });
}
```

Register: `probes.push(probeNativeAdversarial);`

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/spike-agent-sdk.ts
git commit -m "spike: add native_output_format invalid-schema probe"
```

---

## Task 4: Probe C — mcp_submit_tool happy path

**Files:**
- Modify: `scripts/spike-agent-sdk.ts`

- [ ] **Step 1: Add probe**

```ts
async function probeMcpHappy(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / happy", async () => {
    let capturedPayload: Fixture | undefined;
    let toolCallCount = 0;

    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema,
      async (args: unknown) => {
        toolCallCount++;
        const parsed = fixtureSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: "Schema mismatch." }],
            isError: true,
          };
        }
        capturedPayload = parsed.data;
        return {
          content: [{ type: "text", text: "Accepted." }],
          structuredContent: parsed.data,
        };
      },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    );
    const serverName = "spike_submit";
    const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });

    const options: Options = {
      model: SPIKE_MODEL,
      systemPrompt:
        "You must call exactly one tool: submit_fixture. Do not answer in prose. The tool input must satisfy the schema.",
      tools: [],
      mcpServers: { [serverName]: mcpServer },
      allowedTools: [`mcp__${serverName}__submit_fixture`],
      maxTurns: 3,
    };
    const q = query({
      prompt: "Submit the fact lookup for Paris (population ~2_100_000, isCapital true).",
      options,
    });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    return {
      ok: capturedPayload !== undefined && toolCallCount === 1,
      durationMs,
      turns: diag.turns,
      messageSubtypes: subtypes,
      resultSubtype: diag.resultSubtype,
      isError: diag.isError,
      usage: diag.usage,
      totalCostUsd: diag.totalCostUsd,
      toolCallCount,
      capturedPayload,
      errorClass: toolCallCount === 1 ? undefined : "no_or_multiple_tool_calls",
      errorMessage:
        toolCallCount === 0
          ? "no tool call observed"
          : toolCallCount > 1
            ? "multiple tool calls"
            : undefined,
    };
  });
}
```

Register: `probes.push(probeMcpHappy);`

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts
git add scripts/spike-agent-sdk.ts
git commit -m "spike: add mcp_submit_tool happy-path probe"
```

---

## Task 5: Probe D — mcp_submit_tool no-tool-call (observational)

**Files:**
- Modify: `scripts/spike-agent-sdk.ts`

This probe is **observational**, not a strict pass/fail. MCP tools are model-controlled — `allowedTools` only pre-approves access, it does not force invocation. We softly nudge the model toward prose, observe whether it still calls the tool, and use the result to inform Phase 1's "must call exactly one tool" enforcement strategy. Whatever happens (tool called, not called, called once, called many) is recorded as data.

- [ ] **Step 1: Add probe**

```ts
async function probeMcpNoTool(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / no_tool_observational", async () => {
    let toolCallCount = 0;
    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema,
      async () => {
        toolCallCount++;
        return { content: [{ type: "text", text: "Accepted." }], structuredContent: {} };
      },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    );
    const serverName = "spike_no_tool";
    const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });
    const options: Options = {
      model: SPIKE_MODEL,
      // Soft nudge toward prose. Production-realistic: a real prompt where
      // tool use is not the only path forward. Reveals whether the model
      // skips the tool when given a discoverable prose answer.
      systemPrompt:
        "You answer questions concisely in prose. Tools are available but optional; use them only when the answer cannot be expressed in plain text.",
      tools: [],
      mcpServers: { [serverName]: mcpServer },
      allowedTools: [`mcp__${serverName}__submit_fixture`],
      maxTurns: 2,
    };
    const q = query({ prompt: "Tell me about Paris in one sentence.", options });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    return {
      ok: true,  // observation only
      durationMs,
      turns: diag.turns,
      messageSubtypes: subtypes,
      resultSubtype: diag.resultSubtype,
      isError: diag.isError,
      usage: diag.usage,
      totalCostUsd: diag.totalCostUsd,
      toolCallCount,
      errorClass: "observation",
      errorMessage: `with prose-friendly system prompt, model invoked tool ${toolCallCount} times`,
    };
  });
}
```

Register: `probes.push(probeMcpNoTool);`

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts
git add scripts/spike-agent-sdk.ts
git commit -m "spike: add mcp_submit_tool no-tool-call probe"
```

---

## Task 6: Probe E — mcp_submit_tool double tool call (observational)

**Files:**
- Modify: `scripts/spike-agent-sdk.ts`

This probe is **observational**. The model may emit two tool calls, batch them in parallel, refuse and respond in prose, or pick one and ignore the other. All outcomes are valid data — production logic in Phase 1 will treat `toolCallCount > 1` as an error, but the spike just needs to know what shape the SDK message stream takes when this happens.

- [ ] **Step 1: Add probe**

```ts
async function probeMcpDouble(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / double_call_observational", async () => {
    let toolCallCount = 0;
    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema,
      async (args: unknown) => {
        toolCallCount++;
        const parsed = fixtureSchema.safeParse(args);
        return {
          content: [{ type: "text", text: parsed.success ? "Accepted." : "Rejected." }],
          structuredContent: parsed.success ? parsed.data : {},
          isError: !parsed.success,
        };
      },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    );
    const serverName = "spike_double";
    const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });
    const options: Options = {
      model: SPIKE_MODEL,
      systemPrompt:
        "Submit two fact lookups in this turn by calling submit_fixture twice — once for Paris and once for Berlin. Do not answer in prose between calls.",
      tools: [],
      mcpServers: { [serverName]: mcpServer },
      allowedTools: [`mcp__${serverName}__submit_fixture`],
      maxTurns: 3,
    };
    const q = query({
      prompt: "Submit fact lookups for Paris (population 2_100_000, isCapital true) and Berlin (population 3_700_000, isCapital true).",
      options,
    });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    return {
      ok: true,  // observation only
      durationMs,
      turns: diag.turns,
      messageSubtypes: subtypes,
      resultSubtype: diag.resultSubtype,
      isError: diag.isError,
      usage: diag.usage,
      totalCostUsd: diag.totalCostUsd,
      toolCallCount,
      errorClass: "observation",
      errorMessage: `observed ${toolCallCount} tool calls when asked for two submissions`,
    };
  });
}
```

Register: `probes.push(probeMcpDouble);`

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts
git add scripts/spike-agent-sdk.ts
git commit -m "spike: add mcp_submit_tool double-call probe"
```

---

## Task 7: Probe F — mcp_submit_tool handler always returns isError

**Files:**
- Modify: `scripts/spike-agent-sdk.ts`

- [ ] **Step 1: Add probe**

```ts
async function probeMcpAlwaysError(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / handler_isError", async () => {
    let toolCallCount = 0;
    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema,
      async () => {
        toolCallCount++;
        return {
          content: [{ type: "text", text: "Validation failed (forced)." }],
          isError: true,
        };
      },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    );
    const serverName = "spike_iserror";
    const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });
    const options: Options = {
      model: SPIKE_MODEL,
      systemPrompt:
        "You must call exactly one tool: submit_fixture. Do not answer in prose. The tool input must satisfy the schema.",
      tools: [],
      mcpServers: { [serverName]: mcpServer },
      allowedTools: [`mcp__${serverName}__submit_fixture`],
      maxTurns: 4,  // give the model room to retry if SDK lets it
    };
    const q = query({
      prompt: "Submit the fact lookup for Paris (population ~2_100_000, isCapital true).",
      options,
    });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    return {
      ok: true,  // observation only
      durationMs,
      turns: diag.turns,
      messageSubtypes: subtypes,
      resultSubtype: diag.resultSubtype,
      isError: diag.isError,
      usage: diag.usage,
      totalCostUsd: diag.totalCostUsd,
      toolCallCount,
      errorClass: "observation",
      errorMessage: `model invoked tool ${toolCallCount} times despite isError responses`,
    };
  });
}
```

Register: `probes.push(probeMcpAlwaysError);`

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts
git add scripts/spike-agent-sdk.ts
git commit -m "spike: add mcp_submit_tool always-isError handler probe"
```

---

## Task 8: Run the spike against Max-5 and capture output

**Files:**
- Create: `.planning/spike-output.md`

This task requires the user's environment (real `claude` CLI auth + Max-5 quota). It is **inline** — no subagent should do this. The controller (you) runs the command.

- [ ] **Step 1: Verify CLI state**

Run: `claude --version && claude auth status` (or equivalent — exact subcommand may differ in 0.2.x). Confirm logged-in identity and Max-5 plan.

If not logged in, run `claude login` and re-verify.

- [ ] **Step 2: Run the spike, capture stdout**

```bash
cd "d:/PROJECTS/BOOKOPIS"
npx tsx scripts/spike-agent-sdk.ts > .planning/spike-output.md 2> .planning/spike-stderr.log
```

Expected: ~30-90 seconds total (six small Sonnet calls, some with maxTurns 3-4). Console logs probe progress to stderr.

- [ ] **Step 3: Sanity-check the output**

Read `.planning/spike-output.md`. The matrix should have 6 rows. Look for:
- Probe A (native happy): `OK ✅`, low duration (~3-6s), turns 1-2, `capturedPayload` set, `Subtypes` includes `assistant`, `result:success`.
- Probe B (native invalid): error subtype encoded — most likely `result:error_max_structured_output_retries` or similar.
- Probe C (MCP happy): `OK ✅`, `toolCallCount` = 1.
- Probe D (MCP no-tool): `toolCallCount` = 0 expected (model obeys "do not call tool").
- Probe E (MCP double): `toolCallCount` = 2 expected.
- Probe F (MCP always-isError): observation only — note how many retries the SDK allowed.

If a probe crashed (`OK ❌` with errorClass like `TypeError`), that itself is data — record it.

- [ ] **Step 4: Add stderr log to gitignore (do NOT commit by default)**

`claude` CLI / SDK stderr can leak account, email, auth status, or transient session ids. Treat the stderr log as untrusted output:

```bash
cd "d:/PROJECTS/BOOKOPIS"
echo ".planning/spike-stderr.log" >> .gitignore
```

If you do want to commit it (e.g. for debugging Phase 1), open the file and verify nothing sensitive is present, THEN remove the gitignore line for that single commit. By default, **only commit `spike-output.md`**.

- [ ] **Step 5: Commit the captured output**

```bash
git add .gitignore .planning/spike-output.md
git commit -m "spike: capture run results against Max-5 subscription"
```

(`.planning/spike-stderr.log` stays untracked locally — useful for diagnostics during this session, ignored by VCS.)

---

## Task 9: Update design doc appendix with decision matrix

**Files:**
- Modify: `.planning/design/2026-05-09-subscription-mcp-tools-design.md` (append new §13 Appendix)

- [ ] **Step 1: Read `.planning/spike-output.md` and `.planning/spike-stderr.log`**

Distill into a decision matrix. Pay attention to:
- Which probes succeeded vs failed and why.
- Latency comparison: native vs MCP.
- SDK message subtypes encountered (these populate the dispatcher's switch statement in Phase 1).
- SDK error codes / result subtypes (these populate the error-class mapping).
- Whether the SDK enforced `maxTurns: 1` strictly for native, and what the actual minimum is for MCP.

- [ ] **Step 2: Append §13 Appendix to design doc**

Add this section at the end of `.planning/design/2026-05-09-subscription-mcp-tools-design.md`:

```markdown
---

## 13. Appendix — Phase 0.2 SDK capability spike results (2026-05-09)

Spike script: `scripts/spike-agent-sdk.ts`. Raw output: `.planning/spike-output.md`.

### 13.1 Decision matrix

| Probe | Mode | Path | Result | Latency (ms) | Turns | Notes |
|---|---|---|---|---|---|---|
| A | native_output_format | happy | [✅/❌] | ... | ... | ... |
| B | native_output_format | invalid schema | [✅/❌] | ... | ... | result subtype: `...` |
| C | mcp_submit_tool | happy | [✅/❌] | ... | ... | toolCallCount: 1 |
| D | mcp_submit_tool | no tool call | [observed] | ... | ... | toolCallCount: 0 |
| E | mcp_submit_tool | double call | [observed] | ... | ... | toolCallCount: 2 |
| F | mcp_submit_tool | handler isError | [observed] | ... | ... | retries observed: ... |

(Fill in actual numbers from spike-output.md.)

### 13.2 SDK message subtypes encountered

(List of unique subtypes from spike-output.md, e.g. `assistant`, `stream_event`, `result:success`, `result:error`, `system:auth_status`, ...)

### 13.3 SDK error / result subtypes

| Failure mode | Result subtype | is_error | api_error_status |
|---|---|---|---|
| Native invalid schema | ... | ... | ... |
| MCP handler isError | ... | ... | ... |

### 13.4 Default mode chosen

**Default subscription mode for structured agents in Phase 1+:** `[native_output_format | mcp_submit_tool]` based on the evidence above.

Rationale: ...

If `native_output_format` is chosen as default but Probe A failed or had high latency, document the reason for over-riding (e.g. MCP gave stricter guarantees but native gave lower latency — pick the priority).

### 13.5 Risks confirmed or refuted by the spike

- Risk #1 from §11 (`outputFormat` availability with subscription auth): [confirmed available / not available — explanation].
- Risk #2 (MCP `tool()` + Zod 4): [worked / had issues with ...].
- Risk #3 (`maxTurns` calibration): observed minimum for happy paths — native: ..., MCP: ....
- Risk #5 (Quota accounting per tool_use round): native happy path consumed [N] messages; MCP happy path consumed [M] messages. Phase 1 budget assumes [conclusion].
- Other risks: ...
```

Replace placeholders with real numbers from `.planning/spike-output.md`.

- [ ] **Step 3: Commit**

```bash
git add .planning/design/2026-05-09-subscription-mcp-tools-design.md
git commit -m "design: record Phase 0.2 SDK capability spike results in appendix"
```

---

## Task 10: Push and prepare for Phase 1

**Files:** none (push only)

- [ ] **Step 1: Push all Phase 0.2 commits**

```bash
cd "d:/PROJECTS/BOOKOPIS"
git push origin main
```

- [ ] **Step 2: Sanity-check `git log`**

Run: `git log --oneline origin/main..HEAD` — should be empty (everything pushed). `git log --oneline -12` should show:

```
[appendix-commit]    design: record Phase 0.2 SDK capability spike results in appendix
[output-commit]      spike: capture run results against Max-5 subscription
[probe-F-commit]     spike: add mcp_submit_tool always-isError handler probe
[probe-E-commit]     spike: add mcp_submit_tool double-call probe
[probe-D-commit]     spike: add mcp_submit_tool no-tool-call probe
[probe-C-commit]     spike: add mcp_submit_tool happy-path probe
[probe-B-commit]     spike: add native_output_format invalid-schema probe
[probe-A-commit]     spike: add native_output_format happy-path probe
[scaffold-commit]    chore(spike): scaffold Phase 0.2 SDK capability spike
[7cc6cc0]            docs: clarify Zod 4 migration test breakdown
[55f56c2]            docs: note Zod 4 migration outcome and changes
[55e78be]            fix(llm): migrate to Zod 4; ...
```

- [ ] **Step 3: Mark Phase 0.2 done**

Phase 0.2 is complete. Phase 1 (registry + dispatcher + native pilot) is now unblocked — the design appendix tells the Phase 1 implementer exactly which mode to ship, what message subtypes to handle, and what error codes to map. Phase 1 plan can be written next.

---

## Done criteria

- [ ] `scripts/spike-agent-sdk.ts` exists with 6 probes registered.
- [ ] `pnpm exec tsc --noEmit scripts/spike-agent-sdk.ts` is clean.
- [ ] `SPIKE_MODEL` is configurable via env (default `"sonnet"` alias).
- [ ] Spike was run against the user's Max-5 subscription.
- [ ] `.planning/spike-output.md` captured with the markdown matrix AND the per-probe raw diagnostics block.
- [ ] Spike records `resultSubtype`, `isError`, `usage`, `totalCostUsd` fields when the SDK exposes them.
- [ ] Probes B / D / E / F are interpreted as observational; Probe A and C are the only strict pass/fail.
- [ ] `.planning/spike-stderr.log` reviewed for sensitive data and either gitignored (default) or sanitised before commit.
- [ ] Design doc §13 appendix populated with real numbers, message subtypes, error subtypes, and a chosen default mode.
- [ ] All commits pushed to `origin/main`.
- [ ] Phase 1 plan can now be drafted using the appendix as input.

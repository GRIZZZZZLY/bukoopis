/**
 * Phase 0.2 SDK Capability Spike — etap 0.2.4.
 *
 * Run with: `pnpm exec tsx scripts/spike-agent-sdk.ts`
 *
 * Exercises Claude Agent SDK against the user's Pro/Max subscription via
 * `claude` CLI credentials. Probes both `outputFormat` (native structured
 * output) and `mcpServers + tool()` (MCP submit-tool) paths, on both happy
 * and observational scenarios.
 *
 * Prints a markdown decision matrix to stdout. Capture with:
 *   pnpm exec tsx scripts/spike-agent-sdk.ts > .planning/spike-output.md 2> .planning/spike-stderr.log
 *
 * Expected quota cost: ~6 small Sonnet messages, negligible against Max-5.
 *
 * Override the model alias via env: `SPIKE_MODEL=claude-opus-4-7 ...`.
 */
import { z } from "zod";
import {
  query,
  tool,
  createSdkMcpServer,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

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

// ─── Probe A — native_output_format / happy ───
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
      ...({ outputFormat } as Record<string, unknown>),
      maxTurns: 1,
    };
    const q = query({
      prompt:
        "Return the city of Paris with its population (~2_100_000) and capital status.",
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
        : { success: false as const, error: { message: "no structured_output on result" } };
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

// ─── Probe B — native_output_format / adversarial_invalid (observational) ───
async function probeNativeAdversarial(): Promise<ProbeResult> {
  return runProbe("native_output_format / adversarial_invalid", async () => {
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

// ─── Probe C — mcp_submit_tool / happy ───
async function probeMcpHappy(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / happy", async () => {
    let capturedPayload: Fixture | undefined;
    let toolCallCount = 0;
    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema.shape,
      async (args: unknown) => {
        toolCallCount++;
        const parsed = fixtureSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text" as const, text: "Schema mismatch." }],
            isError: true,
          };
        }
        capturedPayload = parsed.data;
        return {
          content: [{ type: "text" as const, text: "Accepted." }],
        };
      },
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
      prompt:
        "Submit the fact lookup for Paris (population ~2_100_000, isCapital true).",
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

// ─── Probe D — mcp_submit_tool / no_tool_observational ───
async function probeMcpNoTool(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / no_tool_observational", async () => {
    let toolCallCount = 0;
    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema.shape,
      async () => {
        toolCallCount++;
        return {
          content: [{ type: "text" as const, text: "Accepted." }],
        };
      },
    );
    const serverName = "spike_no_tool";
    const mcpServer = createSdkMcpServer({ name: serverName, tools: [submitTool] });
    const options: Options = {
      model: SPIKE_MODEL,
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
      ok: true,
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

// ─── Probe E — mcp_submit_tool / double_call_observational ───
async function probeMcpDouble(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / double_call_observational", async () => {
    let toolCallCount = 0;
    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema.shape,
      async (args: unknown) => {
        toolCallCount++;
        const parsed = fixtureSchema.safeParse(args);
        return {
          content: [
            { type: "text" as const, text: parsed.success ? "Accepted." : "Rejected." },
          ],
          isError: !parsed.success,
        };
      },
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
      prompt:
        "Submit fact lookups for Paris (population 2_100_000, isCapital true) and Berlin (population 3_700_000, isCapital true).",
      options,
    });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    return {
      ok: true,
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

// ─── Probe F — mcp_submit_tool / handler_isError (observational) ───
async function probeMcpAlwaysError(): Promise<ProbeResult> {
  return runProbe("mcp_submit_tool / handler_isError", async () => {
    let toolCallCount = 0;
    const submitTool = tool(
      "submit_fixture",
      "Submit the fact lookup result.",
      fixtureSchema.shape,
      async () => {
        toolCallCount++;
        return {
          content: [{ type: "text" as const, text: "Validation failed (forced)." }],
          isError: true,
        };
      },
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
      maxTurns: 4,
    };
    const q = query({
      prompt:
        "Submit the fact lookup for Paris (population ~2_100_000, isCapital true).",
      options,
    });
    const { messages, durationMs } = await drainQuery(q);
    const subtypes = summariseSubtypes(messages);
    const result = getResult(messages);
    const diag = extractResultDiagnostics(result);
    return {
      ok: true,
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

const probes: Array<() => Promise<ProbeResult>> = [
  probeNativeHappy,
  probeNativeAdversarial,
  probeMcpHappy,
  probeMcpNoTool,
  probeMcpDouble,
  probeMcpAlwaysError,
];

function printMatrix(results: ProbeResult[]): void {
  const fmt = (v: string | number | boolean | undefined) =>
    v === undefined ? "—" : String(v);
  console.log("\n# Phase 0.2 SDK Capability Spike — Results\n");
  console.log(`Model: \`${SPIKE_MODEL}\``);
  console.log(
    "\n| Probe | OK | Duration ms | Turns | Tool calls | Result subtype | is_error | Error class | Error msg | Subtypes |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.ok ? "✅" : "❌"} | ${fmt(r.durationMs)} | ${fmt(r.turns)} | ${fmt(r.toolCallCount)} | ${fmt(r.resultSubtype)} | ${fmt(r.isError)} | ${fmt(r.errorClass)} | ${fmt(r.errorMessage?.slice(0, 100))} | ${r.messageSubtypes.join(", ") || "—"} |`,
    );
  }
  console.log("\n## Raw diagnostics per probe\n");
  for (const r of results) {
    console.log(`### ${r.name}\n`);
    console.log("```json");
    console.log(
      JSON.stringify(
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
      ),
    );
    console.log("```\n");
  }
}

async function main(): Promise<void> {
  const results: ProbeResult[] = [];
  for (const p of probes) {
    results.push(await p());
  }
  printMatrix(results);
}

main().catch((e) => {
  console.error("Spike crashed:", e);
  process.exit(1);
});

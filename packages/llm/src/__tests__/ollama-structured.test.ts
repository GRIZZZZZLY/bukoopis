import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { dispatchStructured } from "../dispatcher.js";
import { clearStructuredRegistry, registerAgentContract } from "../structured-registry.js";
import { resetRawTemplateCache } from "../ollama.js";
import { LLMError, LLMTimeoutError } from "../errors.js";
import type { AgentStructuredContract } from "../types.js";

const schema = z.object({ value: z.number() });
const contract: AgentStructuredContract<{ q: string }, z.infer<typeof schema>> = {
  agentName: "plot_outline",
  getOutputSchema: () => schema,
  systemPrompt: "SYS",
  buildPrompt: (i) => `Q:${i.q}`,
  defaultMode: "mcp_submit_tool",
  mcp: { toolName: "submit_test", toolDescription: "test" },
};

type ChatReply = { status?: number; content?: string; reject?: unknown };
let chatReplies: ChatReply[];
let chatBodies: Array<Record<string, any>>;
let showStatus: number;
let showTemplate: string;

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.endsWith("/api/show")) {
        return new Response(JSON.stringify({ template: showTemplate }), { status: showStatus });
      }
      chatBodies.push(JSON.parse(init?.body ?? "{}"));
      const r = chatReplies.shift() ?? { content: "{}" };
      if (r.reject) throw r.reject;
      if (r.status && r.status !== 200) return new Response("bad", { status: r.status });
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: r.content ?? "" },
          prompt_eval_count: 11,
          eval_count: 7,
        }),
        { status: 200 },
      );
    }),
  );
}

const run = (extra: Record<string, unknown> = {}) =>
  dispatchStructured<{ q: string }, { value: number }>({
    agentName: "plot_outline",
    payload: { q: "hi" },
    model: "sonnet" as never,
    local: { model: "t" },
    ...extra,
  });

beforeEach(() => {
  clearStructuredRegistry();
  registerAgentContract(contract);
  resetRawTemplateCache();
  chatReplies = [];
  chatBodies = [];
  showStatus = 200;
  showTemplate = "{{ .System }}{{ .Prompt }}";
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("dispatchStructured · local Ollama", () => {
  it("валидный JSON → raw, диагностика ollama:t / api, токены", async () => {
    chatReplies = [{ content: '{"value":3}' }];
    const diag = vi.fn();
    const r = await run({ onDiagnostics: diag });
    expect(r.raw).toEqual({ value: 3 });
    expect(r.diagnostics).toMatchObject({
      modelId: "ollama:t",
      backend: "api",
      inputTokens: 11,
      outputTokens: 7,
    });
    expect(diag).toHaveBeenCalledOnce();
  });

  it("тело запроса: format, stream, think, num_ctx, num_predict", async () => {
    chatReplies = [{ content: '{"value":1}' }];
    await run({ maxTokens: 500 });
    const b = chatBodies[0]!;
    expect(b.format).toEqual(z.toJSONSchema(schema));
    expect(b.stream).toBe(false);
    expect(b.think).toBe(false);
    expect(b.options.num_ctx).toBe(32768);
    expect(b.options.num_predict).toBe(500);
    expect(b.options.temperature).toBeUndefined();
    expect(b.messages[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("systemBlocks заменяют systemPrompt, тексты через пустую строку", async () => {
    chatReplies = [{ content: '{"value":1}' }];
    await run({ systemBlocks: [{ type: "text", text: "A" }, { type: "text", text: "B" }] });
    expect(chatBodies[0]!.messages[0].content).toBe("A\n\nB");
  });

  it("сырая модель отклонена, /api/chat не вызывается", async () => {
    showTemplate = "{{ .Prompt }}";
    await expect(run()).rejects.toThrow("умеет только продолжать прозу");
    expect(chatBodies).toHaveLength(0);
  });

  it("недоступная модель (404 на /api/show) отклонена", async () => {
    showStatus = 404;
    await expect(run()).rejects.toThrow("недоступна");
    expect(chatBodies).toHaveLength(0);
  });

  it("fetch отказывает (ECONNREFUSED) → LLMError с тегом", async () => {
    chatReplies = [{ reject: new TypeError("fetch failed") }];
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect((err as Error).message).toContain("Локальная модель t недоступна");
  });

  it("ответ в code fence разбирается", async () => {
    chatReplies = [{ content: '```json\n{"value":5}\n```' }];
    expect((await run()).raw).toEqual({ value: 5 });
  });

  it("невалидный JSON, затем валидный: ошибка уходит во второй запрос", async () => {
    chatReplies = [{ content: "not json" }, { content: '{"value":2}' }];
    const r = await run();
    expect(r.raw).toEqual({ value: 2 });
    expect(chatBodies).toHaveLength(2);
    const second = chatBodies[1]!.messages.at(-1).content as string;
    expect(second).toContain("Q:hi");
    expect(second).toMatch(/JSON|json/);
    expect(second.length).toBeGreaterThan("Q:hi".length);
  });

  it("два раза не по схеме → LLMError с первыми 300 символами ответа", async () => {
    const bad = "x".repeat(400);
    chatReplies = [{ content: bad }, { content: bad }];
    await expect(run()).rejects.toThrow("x".repeat(300));
    expect(chatBodies).toHaveLength(2);
  });

  it("HTTP 400 на format → повтор с format json и схемой в system", async () => {
    chatReplies = [{ status: 400 }, { content: '{"value":4}' }];
    const r = await run();
    expect(r.raw).toEqual({ value: 4 });
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies[1]!.format).toBe("json");
    expect(chatBodies[1]!.messages[0].content).toContain(JSON.stringify(z.toJSONSchema(schema)));
  });

  it("таймаут → LLMTimeoutError, один вызов /api/chat", async () => {
    chatReplies = [{ reject: Object.assign(new Error("t"), { name: "TimeoutError" }) }];
    await expect(run()).rejects.toBeInstanceOf(LLMTimeoutError);
    expect(chatBodies).toHaveLength(1);
  });
  // «без local прежний путь не тронут» покрывает dispatcher.test.ts.
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const queryQueue: Array<() => AsyncIterable<unknown>> = [];
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

import { query } from "@anthropic-ai/claude-agent-sdk";
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

/** Опции последнего вызова SDK: единственный способ увидеть, что уехало в
 *  запускаемый им процесс. */
function lastQueryOptions(): {
  env?: Record<string, string | undefined>;
  maxTurns?: number;
} {
  const calls = vi.mocked(query).mock.calls;
  const last = calls[calls.length - 1]?.[0] as
    | { options?: { env?: Record<string, string | undefined>; maxTurns?: number } }
    | undefined;
  return last?.options ?? {};
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

  it("предел длины ответа доезжает до подписочного бэкенда", async () => {
    // У SDK нет поля под это в `Options`, поэтому предел едет переменной
    // окружения, которую читает запускаемый им CLI. Без неё `maxTokens`
    // молча терялся на подписке, и обрыв длинного ответа приходил как
    // «инструмент не вызван».
    queryQueue.push(() =>
      asyncGen([
        async () => {
          await lastTools[0]!.handler({ city: "Paris", n: 42 });
        },
        successResult,
      ]),
    );
    await callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
      payload: { q: "test" },
      model: "sonnet",
      maxTokens: 32000,
    });
    const opts = lastQueryOptions();
    expect(opts.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("32000");
    // Ключ API по-прежнему вычищен — подписка не должна свалиться на него.
    expect(opts.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("без предела переменная не выставляется вовсе", async () => {
    // Пустое значение CLI прочитает как предел, поэтому «не задано» обязано
    // означать отсутствие ключа, а не пустую строку.
    queryQueue.push(() =>
      asyncGen([
        async () => {
          await lastTools[0]!.handler({ city: "Paris", n: 42 });
        },
        successResult,
      ]),
    );
    await callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
      payload: { q: "test" },
      model: "sonnet",
    });
    expect(
      "CLAUDE_CODE_MAX_OUTPUT_TOKENS" in (lastQueryOptions().env ?? {}),
    ).toBe(false);
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
    const contractWithoutMcp: typeof fixtureContract = {
      ...fixtureContract,
      ...(fixtureContract.mcp !== undefined ? {} : {}),
    };
    delete (contractWithoutMcp as { mcp?: unknown }).mcp;
    await expect(
      callViaSdkMcpSubmitTool(contractWithoutMcp, fixtureSchema, {
        payload: { q: "test" },
        model: "sonnet",
      }),
    ).rejects.toThrow(/no mcp spec/);
  });
});

describe("вызов подписки не уходит в петлю размышления", () => {
  /** Живой прогон 2026-09-20: план книги и беат-лист главы не завершались
   *  никогда. Сессия Claude Code по умолчанию включает расширенное
   *  размышление; на сложном структурном запросе модель молчит дольше, чем
   *  CLI готов ждать первый кусок потока, и CLI молча шлёт запрос заново.
   *  Три круга по ~175 секунд, ни одного вызова инструмента. С выключенным
   *  размышлением тот же запрос отдал валидный ответ за 120 секунд. */
  it("выключает расширенное размышление", async () => {
    queryQueue.push(() =>
      asyncGen([
        async () => {
          await lastTools[0]!.handler({ city: "Тверь", n: 1 });
        },
        successResult,
      ]),
    );
    await callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
      payload: { q: "тест" },
      model: "sonnet",
    });
    const options = vi.mocked(query).mock.calls[0]![0].options as Record<string, unknown>;
    expect(options.thinking).toEqual({ type: "disabled" });
    expect(options.maxThinkingTokens).toBe(0);
  });

  /** Без изоляции сессия грузит пользовательские хуки, плагины и MCP-серверы:
   *  126 инструментов вместо одного, 5.5 секунды старта вместо 0.7 — и чужой
   *  контекст в каждом запросе агента. */
  it("не читает пользовательские настройки", async () => {
    queryQueue.push(() =>
      asyncGen([
        async () => {
          await lastTools[0]!.handler({ city: "Тверь", n: 1 });
        },
        successResult,
      ]),
    );
    await callViaSdkMcpSubmitTool(fixtureContract, fixtureSchema, {
      payload: { q: "тест" },
      model: "sonnet",
    });
    const options = vi.mocked(query).mock.calls[0]![0].options as Record<string, unknown>;
    expect(options.settingSources).toEqual([]);
  });
});

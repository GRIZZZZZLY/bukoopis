import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRawTemplateModel,
  resetRawTemplateCache,
  streamGenerateOllama,
} from "../ollama.js";

function ndjson(lines: string[], trailingNewline = true): Response {
  const enc = new TextEncoder();
  const text = lines.join("\n") + (trailingNewline ? "\n" : "");
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(text));
        c.close();
      },
    }),
    { status: 200 },
  );
}

async function drain(gen: AsyncGenerator<string, any, void>) {
  const chunks: string[] = [];
  while (true) {
    const r = await gen.next();
    if (r.done) return { chunks, result: r.value };
    chunks.push(r.value);
  }
}

const BASE = "http://ollama.test";

beforeEach(() => resetRawTemplateCache());
afterEach(() => vi.unstubAllGlobals());

describe("streamGenerateOllama", () => {
  it("generate streams chunks and maps done_reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjson([
        '{"response":"Я "}',
        '{"response":"шёл."}',
        '{"done":true,"done_reason":"stop","prompt_eval_count":120,"eval_count":7}',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { chunks, result } = await drain(
      streamGenerateOllama({
        modelTag: "bookforge-writer:run3",
        prompt: "P",
        baseUrl: BASE,
      }),
    );
    expect(chunks).toEqual(["Я ", "шёл."]);
    expect(result).toMatchObject({
      text: "Я шёл.",
      stopReason: "end_turn",
      inputTokens: 120,
      outputTokens: 7,
      modelId: "ollama:bookforge-writer:run3",
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/generate`);
    expect(JSON.parse(init.body)).toEqual({
      model: "bookforge-writer:run3",
      prompt: "P",
      raw: true,
      stream: true,
    });
  });

  it("length maps to max_tokens; final line without newline is flushed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ndjson(
          ['{"response":"x"}', '{"done":true,"done_reason":"length","eval_count":1}'],
          false,
        ),
      ),
    );
    const { result } = await drain(
      streamGenerateOllama({ modelTag: "m", prompt: "P", baseUrl: BASE }),
    );
    expect(result.stopReason).toBe("max_tokens");
    expect(result.outputTokens).toBe(1);
  });

  it("unknown done_reason gives null; HTTP error throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ndjson(['{"done":true,"done_reason":"load"}'])),
    );
    const { result } = await drain(
      streamGenerateOllama({ modelTag: "m", prompt: "P", baseUrl: BASE }),
    );
    expect(result.stopReason).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 })),
    );
    await expect(
      drain(streamGenerateOllama({ modelTag: "m", prompt: "P", baseUrl: BASE })),
    ).rejects.toThrow("ollama HTTP 500: boom");
  });

  it("abort propagates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    await expect(
      drain(streamGenerateOllama({ modelTag: "m", prompt: "P", baseUrl: BASE })),
    ).rejects.toThrow(/aborted/);
  });
});

describe("isRawTemplateModel", () => {
  it("raw template detected and cached", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ template: "{{ .Prompt }}\n" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await isRawTemplateModel("t", BASE)).toBe(true);
    expect(await isRawTemplateModel("t", BASE)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/api/show`);
  });

  it("chat template is not raw", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ template: "<|im_start|>user {{ .Prompt }}" })),
    );
    expect(await isRawTemplateModel("t", BASE)).toBe(false);
  });

  it("show failure is not raw and not cached", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(Response.json({ template: "{{ .Prompt }}" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await isRawTemplateModel("t", BASE)).toBe(false);
    expect(await isRawTemplateModel("t", BASE)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hung show times out after 5 s: not raw and not cached", async () => {
    // Таймер подменяем своим контроллером: «истекает» он по команде теста.
    const ctrl = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(ctrl.signal);
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const pending = isRawTemplateModel("t", BASE);
      expect(timeout).toHaveBeenCalledWith(5000);
      ctrl.abort(new DOMException("timed out", "TimeoutError"));
      expect(await pending).toBe(false);
      fetchMock.mockResolvedValueOnce(Response.json({ template: "{{ .Prompt }}" }));
      expect(await isRawTemplateModel("t", BASE)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
    }
  });
});

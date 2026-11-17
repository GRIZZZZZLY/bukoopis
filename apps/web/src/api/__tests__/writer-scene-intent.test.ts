import { describe, it, expect, vi, afterEach } from "vitest";
import { streamWriteChapter } from "../client";
import { WRITE_ERROR_LABELS } from "@/lib/labels";

/**
 * Деградация подготовки сцены должна быть видна (ТЗ 9.2). Сервер шлёт её
 * событием `scene_intent`; без обработчика клиент молча его проглатывал, и
 * автор не отличал главу, написанную с замыслом, от главы без него.
 */

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}

function mockFetch(frames: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      body: sseBody(frames),
      status: 200,
      statusText: "OK",
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

const DONE = `event: done\ndata: ${JSON.stringify({ proposal: { id: 1 } })}\n\n`;

describe("streamWriteChapter — событие подготовки сцены", () => {
  it("сообщает о деградации", async () => {
    mockFetch([
      `event: scene_intent\ndata: ${JSON.stringify({ prepared: false, degraded: true, droppedEventIds: 0 })}\n\n`,
      DONE,
    ]);
    const onSceneIntent = vi.fn();
    await streamWriteChapter(1, undefined, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
      onSceneIntent,
    });
    expect(onSceneIntent).toHaveBeenCalledWith({
      prepared: false,
      degraded: true,
      droppedEventIds: 0,
    });
  });

  it("удачная подготовка приходит тем же обработчиком", async () => {
    mockFetch([
      `event: scene_intent\ndata: ${JSON.stringify({ prepared: true, degraded: false, droppedEventIds: 2 })}\n\n`,
      DONE,
    ]);
    const onSceneIntent = vi.fn();
    await streamWriteChapter(1, undefined, {
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
      onSceneIntent,
    });
    expect(onSceneIntent).toHaveBeenCalledWith({
      prepared: true,
      degraded: false,
      droppedEventIds: 2,
    });
  });

  it("без обработчика поток не ломается", async () => {
    mockFetch([
      `event: scene_intent\ndata: ${JSON.stringify({ prepared: true, degraded: false, droppedEventIds: 0 })}\n\n`,
      DONE,
    ]);
    const onDone = vi.fn();
    await streamWriteChapter(1, undefined, {
      onChunk: () => {},
      onDone,
      onError: () => {},
    });
    expect(onDone).toHaveBeenCalled();
  });
});

describe("streamWriteChapter — отказ до потока", () => {
  function mockHttp(status: number, body: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status })),
    );
  }

  async function errorOf(): Promise<string> {
    const onError = vi.fn();
    await streamWriteChapter(1, undefined, { onChunk: () => {}, onDone: () => {}, onError });
    expect(onError).toHaveBeenCalledTimes(1);
    return onError.mock.calls[0]![0] as string;
  }

  it("показывает details.message сервера, а не сырой JSON", async () => {
    mockHttp(
      503,
      JSON.stringify({
        error: "local_model_unavailable",
        details: { message: "Модель m недоступна в Ollama: запустите Ollama и повторите." },
      }),
    );
    expect(await errorOf()).toBe("Модель m недоступна в Ollama: запустите Ollama и повторите.");
  });

  it("без details.message — подпись из labels по коду ошибки", async () => {
    mockHttp(503, JSON.stringify({ error: "local_model_unavailable" }));
    expect(await errorOf()).toBe(WRITE_ERROR_LABELS.local_model_unavailable);
  });

  it("не-JSON тело остаётся как есть", async () => {
    mockHttp(502, "Bad Gateway");
    expect(await errorOf()).toBe("HTTP 502: Bad Gateway");
  });
});

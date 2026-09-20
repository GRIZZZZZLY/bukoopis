import { describe, it, expect, vi, afterEach } from "vitest";
import { streamWriteChapter } from "../client";

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

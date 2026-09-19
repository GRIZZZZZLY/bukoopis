import { describe, it, expect, vi } from "vitest";
import { consumeSse, type SseEvent } from "../sse";

/** В9 независимого ревью 2026-09-19: пять копий разбора SSE, и только одна
 *  из них замечала обрыв без терминального события. Остальные молча
 *  возвращались, оставляя экран в состоянии «идёт» навсегда: кнопка Писателя
 *  не отпускалась, а автосохранение было выключено на всё это время. */

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe("consumeSse", () => {
  it("отдаёт события по порядку и сообщает о терминальном", async () => {
    const seen: SseEvent[] = [];
    const res = await consumeSse(
      streamOf(frame("chunk", { text: "раз" }), frame("chunk", { text: "два" }), frame("done", { ok: true })),
      (e) => seen.push(e),
      { terminalEvents: ["done", "error"] },
    );

    expect(seen.map((e) => e.event)).toEqual(["chunk", "chunk", "done"]);
    expect((seen[0]!.data as { text: string }).text).toBe("раз");
    expect(res.sawTerminal).toBe(true);
  });

  it("обрыв без терминального события виден вызывающему", async () => {
    const seen: SseEvent[] = [];
    const res = await consumeSse(
      streamOf(frame("chunk", { text: "половина" })),
      (e) => seen.push(e),
      { terminalEvents: ["done", "error"] },
    );

    expect(seen).toHaveLength(1);
    expect(res.sawTerminal).toBe(false);
  });

  it("собирает событие, разорванное между кусками потока", async () => {
    const whole = frame("done", { text: "целиком" });
    const seen: SseEvent[] = [];
    await consumeSse(
      streamOf(whole.slice(0, 12), whole.slice(12)),
      (e) => seen.push(e),
      { terminalEvents: ["done"] },
    );
    expect(seen.map((e) => e.event)).toEqual(["done"]);
  });

  it("пропускает неизвестные и битые события, не роняя поток", async () => {
    const seen: SseEvent[] = [];
    const res = await consumeSse(
      streamOf(
        "event: ping\ndata: {\"at\":1}\n\n",
        "event: chunk\ndata: {битый json\n\n",
        frame("done", {}),
      ),
      (e) => seen.push(e),
      { terminalEvents: ["done"] },
    );
    // `ping` доезжает как обычное событие — решает вызывающий, а битое
    // выбрасывается здесь: один разобранный кадр не повод ронять весь поток.
    expect(seen.map((e) => e.event)).toEqual(["ping", "done"]);
    expect(res.sawTerminal).toBe(true);
  });

  it("событие без имени считается message", async () => {
    const seen: SseEvent[] = [];
    await consumeSse(streamOf('data: {"a":1}\n\n'), (e) => seen.push(e), {
      terminalEvents: [],
    });
    expect(seen[0]!.event).toBe("message");
  });

  it("ошибка обработчика не срывает чтение остатка потока", async () => {
    const onEvent = vi.fn((e: SseEvent) => {
      if (e.event === "chunk") throw new Error("кривой потребитель");
    });
    const res = await consumeSse(
      streamOf(frame("chunk", {}), frame("done", {})),
      onEvent,
      { terminalEvents: ["done"] },
    );
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(res.sawTerminal).toBe(true);
  });
});

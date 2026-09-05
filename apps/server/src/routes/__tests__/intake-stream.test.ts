import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { makeTestApp, jsonReq, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;
beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runMaterialClassifier).mockReset();
});
afterEach(() => t.cleanup());

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Поток" });
  return r.id;
}

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Читает SSE-ответ целиком и разбирает его на события. */
async function readEvents(res: Response): Promise<SseEvent[]> {
  const text = await res.text();
  const out: SseEvent[] = [];
  for (const block of text.split("\n\n")) {
    const evLine = block.split("\n").find((l) => l.startsWith("event:"));
    const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
    if (!evLine || !dataLine) continue;
    out.push({
      event: evLine.slice("event:".length).trim(),
      data: JSON.parse(dataLine.slice("data:".length).trim()) as Record<string, unknown>,
    });
  }
  return out;
}

const file = (n: string) => ({ filename: n, content: `# ${n}\nтекст ${n}` });
const world = (title: string) => ({
  fragments: [{ target: "world" as const, title, body: `тело ${title}` }],
});

describe("POST /api/books/:id/intake-stream", () => {
  it("404 for an unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/intake-stream", "POST", { files: [file("а.md")] });
    expect(r.status).toBe(404);
  });

  it("400 for an empty file list", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/intake-stream`, "POST", { files: [] });
    expect(r.status).toBe(400);
  });

  it("emits begin, a pair of file events per file, then done", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce(world("Карта"))
      .mockResolvedValueOnce(world("Кухня"));
    const id = await createBook();
    const res = await t.app.request(
      jsonReq(`/api/books/${id}/intake-stream`, "POST", { files: [file("а.md"), file("б.md")] }),
    );
    const events = await readEvents(res);
    expect(events[0]!.event).toBe("begin");
    expect(events[0]!.data.total).toBe(2);
    expect(typeof events[0]!.data.requestKey).toBe("string");
    expect(events.filter((e) => e.event === "file").map((e) => [e.data.index, e.data.status])).toEqual([
      [0, "started"], [0, "done"], [1, "started"], [1, "done"],
    ]);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.cancelled).toBe(false);
    expect((done.data.summary as Array<{ target: string; count: number }>).map((r) => [r.target, r.count]))
      .toEqual([["world", 2]]);
  });

  it("a failed file is reported as it happens, not only at the end", async () => {
    vi.mocked(runMaterialClassifier)
      .mockRejectedValueOnce(new Error("LLM failure"))
      .mockResolvedValueOnce(world("Кухня"));
    const id = await createBook();
    const res = await t.app.request(
      jsonReq(`/api/books/${id}/intake-stream`, "POST", { files: [file("а.md"), file("б.md")] }),
    );
    const events = await readEvents(res);
    const failed = events.find((e) => e.event === "file" && e.data.status === "failed");
    expect(failed?.data).toMatchObject({ filename: "а.md", message: "LLM failure" });
    // и он пришёл раньше, чем начался второй файл
    const failedAt = events.indexOf(failed!);
    const secondStarted = events.findIndex((e) => e.event === "file" && e.data.index === 1);
    expect(failedAt).toBeLessThan(secondStarted);
  });
});

describe("POST /api/books/:id/intake/cancel", () => {
  it("404 when no such run is in flight", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/intake/cancel`, "POST", { requestKey: "нет-такого" });
    expect(r.status).toBe(404);
  });

  it("stops the run after the file in flight and keeps what landed", async () => {
    const id = await createBook();
    let cancelled = false;
    // Отмена приходит, пока разбирается первый файл: раннер сверяется с
    // реестром перед следующим, поэтому второй файл не начнётся.
    vi.mocked(runMaterialClassifier).mockImplementation(async () => {
      if (!cancelled) {
        cancelled = true;
        const state = await sendJson<{ requestKey: string }>(
          t.app, `/api/books/${id}/intake/inflight`, "GET",
        );
        await send(t.app, `/api/books/${id}/intake/cancel`, "POST", { requestKey: state.requestKey });
      }
      return world("Карта");
    });
    const res = await t.app.request(
      jsonReq(`/api/books/${id}/intake-stream`, "POST", {
        files: [file("а.md"), file("б.md"), file("в.md")],
      }),
    );
    const events = await readEvents(res);
    const done = events.at(-1)!;
    expect(done.event).toBe("done");
    expect(done.data.cancelled).toBe(true);
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect((done.data.summary as Array<{ count: number }>)[0]!.count).toBe(1);
  });
});

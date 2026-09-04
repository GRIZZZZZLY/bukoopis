import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// studio.ts imports the runner at module load — mock before importing the app.
vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { BookConcept, StudioState } from "@book-forge/shared";

let t: TestApp;
beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runMaterialClassifier).mockReset();
});
afterEach(() => t.cleanup());

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Приём" });
  return r.id;
}

interface IntakeResponse {
  summary: Array<{ target: string; label: string; count: number; titles: string[] }>;
  ideaSet: boolean;
  chapters: Array<{ chapterId: number; title: string; words: number }>;
  failures: Array<{ filename: string; message: string }>;
  revision: number;
}

const WORLD_FILE = { filename: "Карта.md", content: "# Карта\nБарьер делит два мира." };
const PEOPLE_FILE = { filename: "Связи.md", content: "# Связи\nНейла — проводница." };

describe("POST /api/books/:id/intake", () => {
  it("404 for an unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/intake", "POST", { files: [WORLD_FILE] });
    expect(r.status).toBe(404);
  });

  it("400 for an empty file list", async () => {
    const id = await createBook();
    expect((await send(t.app, `/api/books/${id}/intake`, "POST", { files: [] })).status).toBe(400);
    expect(vi.mocked(runMaterialClassifier)).not.toHaveBeenCalled();
  });

  it("lands markdown fragments as reviewing drafts and reports what went where", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        { target: "world", title: "Карта", body: "Барьер делит два мира.", note: "география" },
        { target: "lore", title: "Барьер", body: "Барьер поставили древние." },
      ],
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(out.summary.map((r) => [r.target, r.count])).toEqual([["world", 1], ["lore", 1]]);
    expect(out.failures).toEqual([]);

    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    const world = state.stages.world!;
    expect(world.aspects[0]!.status).toBe("reviewing");
    expect(world.aspects[0]!.finalPayload).toBeUndefined();
    expect(world.aspects[0]!.source).toBe("import");
    expect(world.aspects[0]!.variants[0]!.payload).toBe("Барьер делит два мира.");
    expect(state.revision).toBe(out.revision);
  });

  it("calls the classifier once per file and passes the book's idea along", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({ fragments: [] });
    const id = await createBook();
    const concept = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    await send(t.app, `/api/books/${id}/concept`, "PATCH", { ...concept, idea: "Шестеро героев из двух миров." });
    await send(t.app, `/api/books/${id}/intake`, "POST", { files: [WORLD_FILE, PEOPLE_FILE] });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(2);
    const names = vi.mocked(runMaterialClassifier).mock.calls.map((c) => c[0].filename).sort();
    expect(names).toEqual(["Карта.md", "Связи.md"]);
    expect(vi.mocked(runMaterialClassifier).mock.calls[0]![0].bookIdea).toBe("Шестеро героев из двух миров.");
  });

  it("writes the idea when the book has none and the classifier found one", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [],
      bookIdea: "Шестеро героев из двух враждующих миров.",
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(out.ideaSet).toBe(true);
    const c = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    expect(c.idea).toBe("Шестеро героев из двух враждующих миров.");
  });

  it("never overwrites an idea the author already has", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({ fragments: [], bookIdea: "Другая задумка" });
    const id = await createBook();
    const concept = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    await send(t.app, `/api/books/${id}/concept`, "PATCH", { ...concept, idea: "Моя задумка" });
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(out.ideaSet).toBe(false);
    expect((await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET")).idea).toBe("Моя задумка");
  });

  it("turns chapter fragments into real chapters", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        { target: "chapters", title: "Глава 01", body: "Караван вышел на рассвете." },
        { target: "chapters", title: "Глава 02", body: "Песок слышал металл." },
      ],
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [{ filename: "черновик.md", content: "текст" }],
    });
    expect(out.chapters.map((c) => c.title)).toEqual(["Глава 01", "Глава 02"]);
    const chapters = await sendJson<Array<{ title: string }>>(t.app, `/api/books/${id}/chapters`, "GET");
    expect(chapters.map((c) => c.title)).toEqual(["Глава 01", "Глава 02"]);
  });

  it("reports a per-file failure and still lands the files that worked", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce({ fragments: [{ target: "world", title: "Карта", body: "Барьер." }] })
      .mockRejectedValueOnce(new Error("LLM failure"));
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE, PEOPLE_FILE],
    });
    expect(out.summary.map((r) => r.target)).toEqual(["world"]);
    expect(out.failures).toEqual([{ filename: "Связи.md", message: "LLM failure" }]);
  });

  it("replays the same answer when the same files are dropped twice", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [{ target: "world", title: "Карта", body: "Барьер делит два мира." }],
    });
    const id = await createBook();
    const first = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    const again = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(again).toEqual(first);
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    expect(state.stages.world!.aspects).toHaveLength(1);
  });

  it("reports an oversized file as a failure and still lands the rest", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [{ target: "world", title: "Карта", body: "Барьер делит два мира." }],
    });
    const id = await createBook();
    const hugeFile = { filename: "Гигант.md", content: "а".repeat(40_001) };
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE, hugeFile],
    });
    // Only the small file reaches the classifier — the huge one is rejected before the call.
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runMaterialClassifier).mock.calls[0]![0].filename).toBe("Карта.md");
    expect(out.summary.map((r) => r.target)).toEqual(["world"]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]!.filename).toBe("Гигант.md");
    expect(out.failures[0]!.message).toMatch(/слишком/i);
  });
});

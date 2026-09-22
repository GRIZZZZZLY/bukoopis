import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// studio.ts imports the runner at module load — mock before importing the app.
vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

// Same reason: studio.ts imports insertChapters from this module at load time.
// Wrap it (not replace it) so every other test keeps the real insert/index
// path — only the one test that needs a mid-tail failure overrides it.
vi.mock("../import-export.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../import-export.js")>();
  return { ...actual, insertChapters: vi.fn(actual.insertChapters) };
});

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { insertChapters } from "../import-export.js";
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

  it("leaves every touched stage reachable, not skipped, after the drop", async () => {
    // The write path re-derives stage status from the aspects. Imported drafts
    // are optional and `reviewing`, so a stage full of them must read as work in
    // progress — «skipped» is what the stage pages refuse to render.
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        { target: "world", title: "Карта", body: "Барьер делит два мира." },
        { target: "lore", title: "Барьер", body: "Барьер поставили древние." },
        {
          target: "characters",
          title: "Нейла",
          body: "Проводница.",
          entities: [{ name: "Нейла", summary: "Проводница через барьер." }],
        },
      ],
    });
    const id = await createBook();
    await send(t.app, `/api/books/${id}/intake`, "POST", { files: [WORLD_FILE] });

    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    for (const stageId of ["world", "lore", "characters"] as const) {
      const stage = state.stages[stageId]!;
      expect(stage.status).toBe("in_progress");
      expect(stage.aspects).toHaveLength(1);
    }
  });

  it("reopens a stage the author had skipped when their material lands on it", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [{ target: "world", title: "Карта", body: "Барьер делит два мира." }],
    });
    const id = await createBook();
    const before = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: before.revision,
      next: {
        ...before,
        stages: {
          ...before.stages,
          world: {
            status: "skipped",
            skippedReason: "Пропущен автором",
            playbookGenerated: false,
            aspects: [],
          },
        },
      },
    });

    await send(t.app, `/api/books/${id}/intake`, "POST", { files: [WORLD_FILE] });
    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    expect(state.stages.world!.status).toBe("in_progress");
    expect(state.stages.world!.aspects).toHaveLength(1);
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

  it("does not cache a run that achieved nothing, so the same folder can be retried", async () => {
    // Every file failed — the API key was down, say. Journaling that response
    // pinned the failure forever: re-dropping the folder replayed the same
    // failures without ever retrying, while the summary told the author
    // «Их можно перетащить ещё раз».
    vi.mocked(runMaterialClassifier).mockRejectedValueOnce(new Error("LLM down"));
    const id = await createBook();
    const first = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(first.summary).toEqual([]);
    expect(first.failures).toEqual([{ filename: "Карта.md", message: "LLM down" }]);

    vi.mocked(runMaterialClassifier).mockResolvedValueOnce({
      fragments: [{ target: "world", title: "Карта", body: "Барьер делит два мира." }],
    });
    const again = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(2);
    expect(again.summary.map((r) => r.target)).toEqual(["world"]);
  });

  it("still caches a run whose only result was the idea", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [],
      bookIdea: "Шестеро героев из двух миров.",
    });
    const id = await createBook();
    await send(t.app, `/api/books/${id}/intake`, "POST", { files: [WORLD_FILE] });
    await send(t.app, `/api/books/${id}/intake`, "POST", { files: [WORLD_FILE] });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
  });

  it("splits an oversized file into parts instead of refusing it", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [{ target: "world", title: "Карта", body: "Барьер делит два мира." }],
    });
    const id = await createBook();
    // Реальный материал такого размера — авторская «библия» одним документом,
    // а не мусор: раньше она отбивалась целиком и автор оставался ни с чем.
    const hugeFile = {
      filename: "Гигант.md",
      content: Array.from({ length: 2000 }, (_, i) => `абзац ${i} `.repeat(3)).join("\n"),
    };
    expect(hugeFile.content.length).toBeGreaterThan(40_000);
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE, hugeFile],
    });

    const calls = vi.mocked(runMaterialClassifier).mock.calls;
    expect(calls[0]![0].filename).toBe("Карта.md");
    // Гигант дошёл до классификатора частями, и каждая влезает в один вызов.
    const parts = calls.slice(1);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((c) => c[0].content.length <= 40_000)).toBe(true);
    expect(parts[0]![0].filename).toBe(`Гигант.md (часть 1 из ${parts.length})`);
    expect(out.failures).toEqual([]);
    expect(out.summary.map((r) => r.target)).toEqual(["world"]);
  });

  it("a crash after aspects land still journals the response, so a retry replays instead of duplicating", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        { target: "world", title: "Карта", body: "Барьер делит два мира." },
        { target: "chapters", title: "Глава 01", body: "Текст главы." },
      ],
    });
    vi.mocked(insertChapters).mockRejectedValueOnce(new Error("insert failed"));
    const id = await createBook();
    const out = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });

    // The aspect that already landed in studio_state is not lost just because
    // the chapter insert blew up afterwards.
    expect(out.summary.map((r) => r.target)).toEqual(["world"]);
    expect(out.chapters).toEqual([]);
    expect(out.failures).toEqual([
      { filename: "Главы", message: expect.stringContaining("insert failed") },
    ]);

    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    expect(state.stages.world!.aspects).toHaveLength(1);

    // A retry with the same files must not re-classify and append a second
    // copy of the aspect that already landed — but it delivers the chapters
    // whose write failed, instead of replaying the failure (F13 ревью
    // 2026-09-22: the summary promises «перетащите ещё раз»).
    const again = await sendJson<IntakeResponse>(t.app, `/api/books/${id}/intake`, "POST", {
      files: [WORLD_FILE],
    });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect(again.chapters.map((c) => c.title)).toEqual(["Глава 01"]);
    expect(again.failures).toEqual([]);
    const state2 = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    expect(state2.stages.world!.aspects).toHaveLength(1);
  });
});

describe("авторское оглавление приземляется планом", () => {
  it("фрагмент plot с разобранными главами становится вариантом плана, а не аспектом", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        {
          target: "plot",
          title: "Оглавление",
          body: "Глава 1. Порог\nГлава 2. Мост",
          chapters: [{ title: "Порог", pov: "Рин" }, { title: "Мост" }],
        },
      ],
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse & { planVariants: number }>(
      t.app,
      `/api/books/${id}/intake`,
      "POST",
      { files: [{ filename: "Оглавление.md", content: "Глава 1. Порог" }] },
    );
    expect(out.planVariants).toBe(1);
    expect(out.failures).toEqual([]);

    const book = await sendJson<{ outlineJson: string | null }>(
      t.app,
      `/api/books/${id}`,
      "GET",
    );
    const outline = JSON.parse(book.outlineJson ?? "{}") as {
      variants: Array<{ source?: string; chapters?: Array<{ title: string }> }>;
      selectedIndex: number | null;
    };
    expect(outline.variants).toHaveLength(1);
    expect(outline.variants[0]!.source).toBe("author_material");
    expect(outline.variants[0]!.chapters).toHaveLength(2);
    // Выбор за автора никто не делает.
    expect(outline.selectedIndex).toBeNull();

    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    expect(state.stages["plot"]?.aspects ?? []).toHaveLength(0);
  });

  it("проза о сюжете без списка глав по-прежнему ложится аспектом", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [
        { target: "plot", title: "Мысли о структуре", body: "Хочу три части." },
      ],
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse & { planVariants: number }>(
      t.app,
      `/api/books/${id}/intake`,
      "POST",
      { files: [{ filename: "Структура.md", content: "Хочу три части." }] },
    );
    expect(out.planVariants).toBe(0);

    const book = await sendJson<{ outlineJson: string | null }>(t.app, `/api/books/${id}`, "GET");
    expect(book.outlineJson).toBeNull();

    const state = await sendJson<StudioState>(t.app, `/api/books/${id}/studio-state`, "GET");
    expect(state.stages["plot"]?.aspects).toHaveLength(1);
  });
});

describe("предупреждения доходят до ответа маршрута (живой прогон 2026-09-22)", () => {
  it("пересказанная глава называется в warnings синхронного ответа", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue({
      fragments: [{ target: "chapters", title: "Глава 1", body: "Совсем другой текст." }],
    });
    const id = await createBook();
    const out = await sendJson<IntakeResponse & { warnings?: Array<{ title: string }> }>(
      t.app,
      `/api/books/${id}/intake`,
      "POST",
      { files: [{ filename: "глава.md", content: "# Глава 1\nСмотритель поднялся на маяк." }] },
    );
    expect(out.warnings?.map((w) => w.title)).toEqual(["Глава 1"]);
  });
});

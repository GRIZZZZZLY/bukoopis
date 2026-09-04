import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// studio.ts imports the runners at module load — mock before importing the app.
vi.mock("@book-forge/agents/concept/pitches", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@book-forge/agents/concept/pitches")>()),
  runPitchGenerator: vi.fn(),
}));
vi.mock("@book-forge/agents/concept/pitch-blend", () => ({
  runPitchBlender: vi.fn(),
}));

import { runPitchGenerator, type PitchDraft } from "@book-forge/agents/concept/pitches";
import { runPitchBlender } from "@book-forge/agents/concept/pitch-blend";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { BookConcept } from "@book-forge/shared";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runPitchGenerator).mockReset();
  vi.mocked(runPitchBlender).mockReset();
});
afterEach(() => {
  t.cleanup();
});

const IDEA = "Шестеро героев из двух враждующих миров сталкиваются с нарастающими аномалиями.";

async function createBookWithIdea(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { idea: IDEA });
  return r.id;
}

function draft(title: string): PitchDraft {
  return {
    workingTitle: title,
    logline: `Когда ${title.toLowerCase()} рушится, героиня должна выбрать, иначе потеряет всё.`,
    protagonist: "Нейла, проводница каравана, верит карте больше, чем себе.",
    conflict: "Ритуальный маршрут ведёт в аномалию, признать это — предать род.",
    stakes: "Караван и репутация семьи.",
    hook: "В архивах маршрута — невозможная правка.",
    genre: "фантастика выживания",
    tone: "холодный",
    audience: "adult",
    strength: "Понятный конфликт с первой сцены.",
    risk: "Много мира до первого выбора.",
  };
}

type PitchesResponse = { concept: BookConcept; questions: string[]; newPitchIds: string[] };

describe("POST /api/books/:id/concept/pitches", () => {
  it("404 for unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/concept/pitches", "POST", {});
    expect(r.status).toBe(404);
  });

  it("400 when the book has no idea yet", async () => {
    const { id } = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Без задумки" });
    const r = await send(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    expect(r.status).toBe(400);
    expect(vi.mocked(runPitchGenerator)).not.toHaveBeenCalled();
  });

  it("persists generated pitches with unique ids and passes questions through", async () => {
    vi.mocked(runPitchGenerator).mockResolvedValue({
      pitches: [draft("Первый"), draft("Второй"), draft("Третий")],
      questions: ["Для кого книга?"],
    });
    const id = await createBookWithIdea();
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {
      direction: "мрачнее",
    });
    expect(out.concept.pitches).toHaveLength(3);
    expect(new Set(out.concept.pitches.map((p) => p.id)).size).toBe(3);
    expect(out.newPitchIds).toEqual(out.concept.pitches.map((p) => p.id));
    expect(out.questions).toEqual(["Для кого книга?"]);
    const call = vi.mocked(runPitchGenerator).mock.calls[0]?.[0];
    expect(call?.idea).toBe(IDEA);
    expect(call?.direction).toBe("мрачнее");
    expect(call?.avoid).toEqual([]);

    const stored = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    expect(stored.pitches.map((p) => p.workingTitle)).toEqual(["Первый", "Второй", "Третий"]);
  });

  it("a second batch appends and tells the agent what to avoid", async () => {
    vi.mocked(runPitchGenerator)
      .mockResolvedValueOnce({ pitches: [draft("А"), draft("Б"), draft("В")], questions: [] })
      .mockResolvedValueOnce({ pitches: [draft("Г"), draft("Д"), draft("Е")], questions: [] });
    const id = await createBookWithIdea();
    await send(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    expect(out.concept.pitches).toHaveLength(6);
    expect(out.newPitchIds).toHaveLength(3);
    const second = vi.mocked(runPitchGenerator).mock.calls[1]?.[0];
    expect(second?.avoid?.map((a) => a.workingTitle)).toEqual(["А", "Б", "В"]);
  });

  it("500 when the agent throws", async () => {
    vi.mocked(runPitchGenerator).mockRejectedValue(new Error("LLM failure"));
    const id = await createBookWithIdea();
    const r = await send(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: string }).error).toBe("pitch_generation_failed");
  });
});

describe("POST /api/books/:id/concept/pitches/blend", () => {
  async function bookWithPitches(): Promise<{ id: number; ids: string[] }> {
    vi.mocked(runPitchGenerator).mockResolvedValue({
      pitches: [draft("А"), draft("Б"), draft("В")],
      questions: [],
    });
    const id = await createBookWithIdea();
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    return { id, ids: out.newPitchIds };
  }

  it("400 on an unknown pitch id in picks", async () => {
    const { id } = await bookWithPitches();
    const r = await send(t.app, `/api/books/${id}/concept/pitches/blend`, "POST", {
      picks: { protagonist: "nope" },
    });
    expect(r.status).toBe(400);
  });

  it("400 on empty picks", async () => {
    const { id } = await bookWithPitches();
    const r = await send(t.app, `/api/books/${id}/concept/pitches/blend`, "POST", { picks: {} });
    expect(r.status).toBe(400);
  });

  it("appends the blended pitch and hands the agent only the picked sources", async () => {
    const { id, ids } = await bookWithPitches();
    vi.mocked(runPitchBlender).mockResolvedValue(draft("Смесь"));
    const [a, b] = ids;
    const out = await sendJson<{ concept: BookConcept; pitchId: string }>(
      t.app,
      `/api/books/${id}/concept/pitches/blend`,
      "POST",
      { picks: { protagonist: a, conflict: b }, note: "камернее" },
    );
    expect(out.concept.pitches).toHaveLength(4);
    expect(out.concept.pitches[3]?.id).toBe(out.pitchId);
    expect(out.concept.pitches[3]?.workingTitle).toBe("Смесь");
    const call = vi.mocked(runPitchBlender).mock.calls[0]?.[0];
    expect(call?.sources.map((s) => s.id).sort()).toEqual([a, b].sort());
    expect(call?.picks).toEqual({ protagonist: a, conflict: b });
    expect(call?.note).toBe("камернее");
  });
});

describe("POST /api/books/:id/concept/lock and /unlock", () => {
  async function bookWithPitches(): Promise<{ id: number; ids: string[] }> {
    vi.mocked(runPitchGenerator).mockResolvedValue({
      pitches: [draft("Маршрут"), draft("Архив"), draft("Барьер")],
      questions: [],
    });
    const id = await createBookWithIdea();
    const out = await sendJson<PitchesResponse>(t.app, `/api/books/${id}/concept/pitches`, "POST", {});
    return { id, ids: out.newPitchIds };
  }

  it("400 on unknown pitch id", async () => {
    const { id } = await bookWithPitches();
    const r = await send(t.app, `/api/books/${id}/concept/lock`, "POST", { pitchId: "nope" });
    expect(r.status).toBe(400);
  });

  it("locks the concept to the pitch, renames the book and moves the recommendation on", async () => {
    const { id, ids } = await bookWithPitches();
    const before = await sendJson<Record<number, string>>(t.app, "/api/books/recommended", "GET");
    expect(before[id]).toBe("concept");

    const locked = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept/lock`, "POST", {
      pitchId: ids[1],
    });
    expect(locked.lockedAt).toBeTruthy();
    expect(locked.selectedPitchId).toBe(ids[1]);
    expect(locked.premise.logline).toContain("архив");
    expect(locked.genre).toBe("фантастика выживания");

    const book = await sendJson<{ title: string }>(t.app, `/api/books/${id}`, "GET");
    expect(book.title).toBe("Архив");

    const after = await sendJson<Record<number, string>>(t.app, "/api/books/recommended", "GET");
    expect(after[id]).toBe("world");
  });

  it("locks a legacy concept as-is when it has a logline and no pitches", async () => {
    const { id } = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Старая" });
    const current = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept`, "GET");
    await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      ...current,
      premise: { logline: "Герой ищет правду." },
    });
    const locked = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept/lock`, "POST", {});
    expect(locked.lockedAt).toBeTruthy();
    expect(locked.premise.logline).toBe("Герой ищет правду.");
  });

  it("400 when locking as-is without a logline", async () => {
    const { id } = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Пустая" });
    const r = await send(t.app, `/api/books/${id}/concept/lock`, "POST", {});
    expect(r.status).toBe(400);
  });

  it("unlock clears lockedAt and keeps the premise", async () => {
    const { id, ids } = await bookWithPitches();
    await send(t.app, `/api/books/${id}/concept/lock`, "POST", { pitchId: ids[0] });
    const open = await sendJson<BookConcept>(t.app, `/api/books/${id}/concept/unlock`, "POST");
    expect(open.lockedAt).toBeUndefined();
    expect(open.premise.logline).toBeTruthy();
    const rec = await sendJson<Record<number, string>>(t.app, "/api/books/recommended", "GET");
    expect(rec[id]).toBe("concept");
  });
});

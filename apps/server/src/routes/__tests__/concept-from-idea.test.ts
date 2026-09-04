import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `studio.ts` imports the runner at module load, so mock before importing the app.
vi.mock("@book-forge/agents/concept/from-idea", () => ({
  runConceptFromIdea: vi.fn(),
}));

import { runConceptFromIdea } from "@book-forge/agents/concept/from-idea";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import type { BookConcept } from "@book-forge/shared";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runConceptFromIdea).mockReset();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Braindump test",
  });
  return r.id;
}

const EXPANDED: BookConcept = {
  schemaVersion: 1,
  pitches: [],
  genres: ["fantasy"],
  tones: ["melancholic"],
  audience: "ya",
  premise: {
    protagonist: "Девочка-картограф",
    conflict: "Город на карте не хочет быть найденным",
    stakes: "Потеряет мать, если не найдёт дорогу",
    logline: "Когда карта показывает город, которого нет, девочка идёт туда.",
  },
};

describe("POST /api/books/:id/concept/from-idea", () => {
  it("returns 404 for unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/concept/from-idea", "POST", {
      idea: "Девочка находит карту города, которого нет.",
    });
    expect(r.status).toBe(404);
  });

  it("returns 400 for a missing idea", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/from-idea`, "POST", {});
    expect(r.status).toBe(400);
  });

  it("returns 400 for an idea too short to work with", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/from-idea`, "POST", {
      idea: "книга",
    });
    expect(r.status).toBe(400);
  });

  it("returns the expanded concept without persisting it", async () => {
    vi.mocked(runConceptFromIdea).mockResolvedValue(EXPANDED);
    const id = await createBook();
    const out = await sendJson<BookConcept>(
      t.app,
      `/api/books/${id}/concept/from-idea`,
      "POST",
      { idea: "Девочка находит карту города, которого нет ни на одной карте." },
    );
    expect(out.premise.logline).toBe(EXPANDED.premise.logline);
    expect(vi.mocked(runConceptFromIdea).mock.calls[0]![0].idea).toContain(
      "Девочка находит карту",
    );

    // The author reviews and saves; the route itself must leave the book alone.
    const stored = await sendJson<BookConcept>(
      t.app,
      `/api/books/${id}/concept`,
      "GET",
    );
    expect(stored.premise.logline).toBeUndefined();
    expect(stored.genres).toEqual([]);
  });

  it("returns 500 when the agent throws", async () => {
    vi.mocked(runConceptFromIdea).mockRejectedValue(new Error("LLM failure"));
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/from-idea`, "POST", {
      idea: "Девочка находит карту города, которого нет.",
    });
    expect(r.status).toBe(500);
  });
});

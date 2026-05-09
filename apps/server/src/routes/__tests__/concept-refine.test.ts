import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the agent runner BEFORE importing the app/route, since `studio.ts`
// imports it at module load time.
vi.mock("@book-forge/agents/concept/refiner", () => ({
  runConceptRefiner: vi.fn(),
}));

import { runConceptRefiner } from "@book-forge/agents/concept/refiner";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runConceptRefiner).mockReset();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Refine test",
  });
  return r.id;
}

describe("POST /api/books/:id/concept/refine", () => {
  it("returns 404 for unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/concept/refine", "POST", {
      field: "protagonist",
    });
    expect(r.status).toBe(404);
  });

  it("returns 400 for missing field", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/refine`, "POST", {});
    expect(r.status).toBe(400);
  });

  it("returns 400 for invalid field name", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/refine`, "POST", {
      field: "weird",
    });
    expect(r.status).toBe(400);
  });

  it("calls runConceptRefiner with concept + field, returns variants", async () => {
    vi.mocked(runConceptRefiner).mockResolvedValue({
      variants: [
        { id: "v1", label: "героическая", payload: "Айрис, юный страж..." },
        { id: "v2", label: "тёмная", payload: "Айрис, отверженная..." },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{ variants: Array<{ id: string }> }>(
      t.app,
      `/api/books/${id}/concept/refine`,
      "POST",
      { field: "protagonist", draft: "Молодая страж границы" },
    );
    expect(r.variants).toHaveLength(2);
    expect(runConceptRefiner).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(runConceptRefiner).mock.calls[0]![0];
    expect(callArg.field).toBe("protagonist");
    expect(callArg.draft).toBe("Молодая страж границы");
    expect(callArg.concept.audience).toBe("adult");
  });

  it("forwards accumulated earlier fields when generating later field", async () => {
    vi.mocked(runConceptRefiner).mockResolvedValue({
      variants: [
        { id: "v1", label: "a", payload: "x".repeat(20) },
        { id: "v2", label: "b", payload: "y".repeat(20) },
      ],
    });
    const id = await createBook();
    await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      schemaVersion: 1,
      genres: [],
      tones: [],
      audience: "adult",
      premise: { protagonist: "P", conflict: "C" },
    });
    await sendJson(t.app, `/api/books/${id}/concept/refine`, "POST", {
      field: "stakes",
    });
    const callArg = vi.mocked(runConceptRefiner).mock.calls[0]![0];
    expect(callArg.accumulated.protagonist).toBe("P");
    expect(callArg.accumulated.conflict).toBe("C");
    expect(callArg.accumulated).not.toHaveProperty("stakes");
  });

  it("returns 500 when agent throws", async () => {
    vi.mocked(runConceptRefiner).mockRejectedValue(new Error("LLM failure"));
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept/refine`, "POST", {
      field: "logline",
    });
    expect(r.status).toBe(500);
  });
});

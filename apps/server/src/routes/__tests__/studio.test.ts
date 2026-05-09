import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import { emptyBookConcept, emptyStudioState } from "@book-forge/shared";

let t: TestApp;

beforeEach(async () => {
  t = makeTestApp();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Test",
  });
  return r.id;
}

describe("studio routes", () => {
  it("GET /api/books/:id/concept returns default for new book", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept`, "GET");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(emptyBookConcept());
  });

  it("GET /api/books/:id/concept returns 404 for unknown book", async () => {
    const r = await send(t.app, "/api/books/9999/concept", "GET");
    expect(r.status).toBe(404);
  });

  it("PATCH /api/books/:id/concept persists genres", async () => {
    const id = await createBook();
    const c = emptyBookConcept();
    c.genres = ["fantasy"];
    const r = await send(t.app, `/api/books/${id}/concept`, "PATCH", c);
    expect(r.status).toBe(200);
    const round = await sendJson<{ genres: string[] }>(
      t.app,
      `/api/books/${id}/concept`,
      "GET",
    );
    expect(round.genres).toEqual(["fantasy"]);
  });

  it("PATCH /api/books/:id/concept rejects invalid body (400)", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      genres: "not-an-array",
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/books/:id/studio-state returns default empty state", async () => {
    const id = await createBook();
    const r = await sendJson<{ revision: number; stages: object }>(
      t.app,
      `/api/books/${id}/studio-state`,
      "GET",
    );
    expect(r.revision).toBe(0);
    expect(r.stages).toEqual({});
  });

  it("PATCH /api/books/:id/studio-state increments revision", async () => {
    const id = await createBook();
    const next = emptyStudioState();
    next.stages.concept = { status: "in_progress", playbookGenerated: false, aspects: [] };
    const r = await sendJson<{ revision: number }>(
      t.app,
      `/api/books/${id}/studio-state`,
      "PATCH",
      { expectedRevision: 0, next },
    );
    expect(r.revision).toBe(1);
  });

  it("PATCH /api/books/:id/studio-state returns 409 on revision mismatch", async () => {
    const id = await createBook();
    const next = emptyStudioState();
    const r = await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: 99,
      next,
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as { error: string; details: { expected: number; actual: number } };
    expect(body.error).toBe("revision_conflict");
    expect(body.details.actual).toBe(0);
  });

  it("PATCH /api/books/:id/studio-state rejects invariant-violating state (400)", async () => {
    const id = await createBook();
    const bad = emptyStudioState();
    bad.stages.world = {
      status: "complete",
      playbookGenerated: false,
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "pending",
          order: 0,
          required: true,
          source: "llm",
          payloadKind: "markdown",
          variants: [],
        },
      ],
    };
    const r = await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: 0,
      next: bad,
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/books/:id/studio-warnings returns array", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/studio-warnings`, "GET");
    expect(r.status).toBe(200);
    const body = (await r.json()) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
  });
});

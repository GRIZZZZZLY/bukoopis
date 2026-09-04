import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import {
  emptyBookConcept,
  emptyStudioState,
  type StudioState,
} from "@book-forge/shared";

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

  it("PATCH /api/books/:id/concept persists genre", async () => {
    const id = await createBook();
    const c = emptyBookConcept();
    c.genre = "фэнтези";
    const r = await send(t.app, `/api/books/${id}/concept`, "PATCH", c);
    expect(r.status).toBe(200);
    const round = await sendJson<{ genre: string }>(
      t.app,
      `/api/books/${id}/concept`,
      "GET",
    );
    expect(round.genre).toBe("фэнтези");
  });

  it("PATCH /api/books/:id/concept rejects invalid body (400)", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      genres: "not-an-array",
    });
    expect(r.status).toBe(400);
  });

  it("PATCH /api/books/:id/concept rejects clearing the logline on a locked concept (400)", async () => {
    const id = await createBook();
    await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      schemaVersion: 1,
      pitches: [],
      audience: "adult",
      premise: { logline: "Картограф ищет остров, которого нет." },
    });
    await send(t.app, `/api/books/${id}/concept/lock`, "POST", {});
    const r = await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      schemaVersion: 1,
      pitches: [],
      audience: "adult",
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "" },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("invariant_violation");
    // the concept in storage must be untouched by the rejected patch
    const round = await sendJson<{ premise: { logline?: string } }>(
      t.app,
      `/api/books/${id}/concept`,
      "GET",
    );
    expect(round.premise.logline).toBe("Картограф ищет остров, которого нет.");
  });

  it("PATCH /api/books/:id/concept still allows an unlocked concept with no logline — the ordinary drafting state", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      schemaVersion: 1,
      pitches: [],
      audience: "adult",
      premise: {},
    });
    expect(r.status).toBe(200);
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

  it("PATCH /api/books/:id/studio-state normalizes a stage status the caller got wrong", async () => {
    const id = await createBook();
    const next = emptyStudioState();
    next.stages.world = {
      // "complete" with a pending required aspect used to be rejected; the server
      // now derives stage status, so the claim is corrected instead.
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
      next,
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as StudioState;
    expect(body.stages.world?.status).toBe("in_progress");
  });

  it("PATCH /api/books/:id/studio-state completes a stage once its required aspects land", async () => {
    const id = await createBook();
    const next = emptyStudioState();
    next.stages.world = {
      status: "in_progress",
      playbookGenerated: true,
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "accepted",
          order: 0,
          required: true,
          source: "llm",
          payloadKind: "markdown",
          variants: [],
          finalPayload: "Архипелаг северных островов.",
        },
        {
          id: "a2",
          name: "климат",
          status: "skipped",
          order: 1,
          required: true,
          source: "llm",
          payloadKind: "markdown",
          variants: [],
        },
      ],
    };
    const r = await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: 0,
      next,
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as StudioState;
    expect(body.stages.world?.status).toBe("complete");
  });

  it("PATCH /api/books/:id/studio-state still rejects invariant-violating state (400)", async () => {
    const id = await createBook();
    const bad = emptyStudioState();
    bad.stages.world = {
      status: "in_progress",
      playbookGenerated: false,
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "accepted",
          order: 0,
          required: true,
          source: "llm",
          payloadKind: "markdown",
          variants: [],
          // accepted without finalPayload
        },
      ],
    };
    const r = await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: 0,
      next: bad,
    });
    expect(r.status).toBe(400);
  });

  it("GET /api/books/:id/studio-warnings sees chapters that exist in the table", async () => {
    const id = await createBook();
    const before = await sendJson<Array<{ id: string }>>(
      t.app,
      `/api/books/${id}/studio-warnings`,
      "GET",
    );
    expect(before.map((w) => w.id)).not.toContain("chapters_without_characters");

    await send(t.app, `/api/books/${id}/chapters`, "POST", { title: "Гл1" });

    const after = await sendJson<Array<{ id: string }>>(
      t.app,
      `/api/books/${id}/studio-warnings`,
      "GET",
    );
    expect(after.map((w) => w.id)).toContain("chapters_without_characters");
  });

  it("GET /api/books/recommended walks the whole pipeline to chapters", async () => {
    const id = await createBook();
    const fresh = await sendJson<Record<number, string>>(
      t.app,
      "/api/books/recommended",
      "GET",
    );
    expect(fresh[id]).toBe("concept");

    await send(t.app, `/api/books/${id}/concept`, "PATCH", {
      schemaVersion: 1,
      pitches: [],
      genres: [],
      tones: [],
      audience: "adult",
      premise: { logline: "Картограф ищет остров, которого нет." },
    });
    // Lock through the real route rather than hand-setting lockedAt: this is a
    // legacy-style concept (a filled premise, no pitches), the "as-is" path.
    await send(t.app, `/api/books/${id}/concept/lock`, "POST", {});
    const afterConcept = await sendJson<Record<number, string>>(
      t.app,
      "/api/books/recommended",
      "GET",
    );
    expect(afterConcept[id]).toBe("world");

    const next = emptyStudioState();
    for (const s of ["world", "lore", "characters", "items", "plot"] as const) {
      next.stages[s] = { status: "skipped", playbookGenerated: false, aspects: [] };
    }
    await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: 0,
      next,
    });
    const afterSkips = await sendJson<Record<number, string>>(
      t.app,
      "/api/books/recommended",
      "GET",
    );
    expect(afterSkips[id]).toBe("chapters");
  });

  it("GET /api/books/:id/studio-warnings returns array", async () => {
    const id = await createBook();
    const r = await send(t.app, `/api/books/${id}/studio-warnings`, "GET");
    expect(r.status).toBe(200);
    const body = (await r.json()) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/books/recommended returns concept for a fresh book", async () => {
    const id = await createBook();
    const r = await send(t.app, "/api/books/recommended", "GET");
    expect(r.status).toBe(200);
    const map = (await r.json()) as Record<string, string>;
    expect(map[String(id)]).toBe("concept");
  });

  it("GET /api/books/recommended advances after concept is completed", async () => {
    const id = await createBook();
    const current = await sendJson<{ revision: number }>(
      t.app,
      `/api/books/${id}/studio-state`,
      "GET",
    );
    await send(t.app, `/api/books/${id}/studio-state`, "PATCH", {
      expectedRevision: current.revision,
      next: {
        schemaVersion: 1,
        revision: current.revision,
        stages: {
          concept: { status: "complete", playbookGenerated: false, aspects: [] },
        },
      },
    });
    const r = await send(t.app, "/api/books/recommended", "GET");
    const map = (await r.json()) as Record<string, string>;
    expect(map[String(id)]).toBe("world");
  });
});

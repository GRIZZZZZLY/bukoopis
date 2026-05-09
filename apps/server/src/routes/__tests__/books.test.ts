import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => {
  t.cleanup();
});

interface BookJson {
  id: number;
  title: string;
  language: string;
  premise: string | null;
  status: string;
}

describe("books CRUD", () => {
  it("GET /api/books returns empty list", async () => {
    const res = await send(t.app, "/api/books", "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /api/books creates a book", async () => {
    const res = await send(t.app, "/api/books", "POST", { title: "Тест" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as BookJson;
    expect(body.id).toBeGreaterThan(0);
    expect(body.title).toBe("Тест");
    expect(body.language).toBe("ru");
    expect(body.status).toBe("draft");
  });

  it("POST /api/books rejects invalid body (400)", async () => {
    const res = await send(t.app, "/api/books", "POST", { title: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_failed");
  });

  it("GET /api/books/:id returns 404 for missing", async () => {
    const res = await send(t.app, "/api/books/9999", "GET");
    expect(res.status).toBe(404);
  });

  it("GET /api/books/:id returns book", async () => {
    const created = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "X",
    });
    const res = await send(t.app, `/api/books/${created.id}`, "GET");
    expect(res.status).toBe(200);
    expect(((await res.json()) as BookJson).title).toBe("X");
  });

  it("PATCH /api/books/:id updates fields", async () => {
    const created = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "X",
    });
    const res = await send(t.app, `/api/books/${created.id}`, "PATCH", {
      premise: "Сюжет",
      status: "active",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BookJson;
    expect(body.premise).toBe("Сюжет");
    expect(body.status).toBe("active");
  });

  it("DELETE /api/books/:id returns 204 and cascades", async () => {
    const created = await sendJson<BookJson>(t.app, "/api/books", "POST", {
      title: "X",
    });
    await send(t.app, `/api/books/${created.id}/chapters`, "POST", {
      title: "Гл1",
    });
    const del = await send(t.app, `/api/books/${created.id}`, "DELETE");
    expect(del.status).toBe(204);
    const get = await send(t.app, `/api/books/${created.id}`, "GET");
    expect(get.status).toBe(404);
  });
});

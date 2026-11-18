import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { emptyBookConcept } from "@book-forge/shared";
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

  it("POST /api/books creates a book from an idea alone with a working title", async () => {
    const res = await send(t.app, "/api/books", "POST", {
      idea: "Шестеро героев из двух враждующих миров сталкиваются с аномалиями.",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as BookJson;
    expect(body.title).toBe("Новая книга");
    const concept = await sendJson<{ idea?: string; pitches: unknown[] }>(
      t.app,
      `/api/books/${body.id}/concept`,
      "GET",
    );
    expect(concept.idea).toBe("Шестеро героев из двух враждующих миров сталкиваются с аномалиями.");
    expect(concept.pitches).toEqual([]);
  });

  it("POST /api/books rejects a body with neither title nor idea (400)", async () => {
    const res = await send(t.app, "/api/books", "POST", {});
    expect(res.status).toBe(400);
  });
});

describe("books studio local model", () => {
  interface StudioJson {
    id: number;
    studioProvider: string;
    studioLocalModel: string | null;
  }

  it("new book defaults studioProvider to anthropic", async () => {
    const b = await sendJson<StudioJson>(t.app, "/api/books", "POST", {
      title: "X",
    });
    expect(b.studioProvider).toBe("anthropic");
    expect(b.studioLocalModel).toBeNull();
  });

  it("PATCH studioProvider+studioLocalModel round-trips", async () => {
    const b = await sendJson<StudioJson>(t.app, "/api/books", "POST", {
      title: "X",
    });
    const res = await send(t.app, `/api/books/${b.id}`, "PATCH", {
      studioProvider: "ollama",
      studioLocalModel: "qwen:9b",
    });
    expect(res.status).toBe(200);
    const got = await sendJson<StudioJson>(t.app, `/api/books/${b.id}`, "GET");
    expect(got.studioProvider).toBe("ollama");
    expect(got.studioLocalModel).toBe("qwen:9b");
  });

  it("PATCH studioProvider ollama without a model is 400", async () => {
    const b = await sendJson<StudioJson>(t.app, "/api/books", "POST", {
      title: "X",
    });
    const res = await send(t.app, `/api/books/${b.id}`, "PATCH", {
      studioProvider: "ollama",
    });
    expect(res.status).toBe(400);
  });
});

describe("books dossier", () => {
  it("PATCH сохраняет worldNotes и отвергает 25 001 знак", async () => {
    const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Т" });
    const text = "Станция «Пустельга» вращается над Малым морем.";
    const res = await send(t.app, `/api/books/${b.id}`, "PATCH", { worldNotes: text });
    expect(res.status).toBe(200);
    const got = await sendJson<{ worldNotes: string | null }>(t.app, `/api/books/${b.id}`, "GET");
    expect(got.worldNotes).toBe(text);
    const big = await send(t.app, `/api/books/${b.id}`, "PATCH", { worldNotes: "x".repeat(25001) });
    expect(big.status).toBe(400);
  });
});

describe("books derivedPremise", () => {
  const concept = JSON.stringify({
    ...emptyBookConcept(),
    premise: { ...emptyBookConcept().premise, logline: "Лис ищет шлюзы", conflict: "Город против реки" },
  });

  it("при пустом синопсисе отдаёт выжимку из замысла — то, что видит модель", async () => {
    const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Т" });
    t.sqlite.prepare("UPDATE books SET concept = ? WHERE id = ?").run(concept, b.id);
    const got = await sendJson<{ derivedPremise: string | null }>(t.app, `/api/books/${b.id}`, "GET");
    expect(got.derivedPremise).toBe("Лис ищет шлюзы\nКонфликт: Город против реки");
  });

  it("при заполненном синопсисе — null", async () => {
    const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Т", premise: "Своё" });
    t.sqlite.prepare("UPDATE books SET concept = ? WHERE id = ?").run(concept, b.id);
    const got = await sendJson<{ derivedPremise: string | null }>(t.app, `/api/books/${b.id}`, "GET");
    expect(got.derivedPremise).toBeNull();
  });

  it("без замысла — null", async () => {
    const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "Т" });
    const got = await sendJson<{ derivedPremise: string | null }>(t.app, `/api/books/${b.id}`, "GET");
    expect(got.derivedPremise).toBeNull();
  });
});

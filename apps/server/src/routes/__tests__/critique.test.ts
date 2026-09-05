import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
}
interface VersionJson {
  id: number;
}
interface ReportJson {
  id: number;
  chapterVersionId: number;
  status: string;
  errorMessage: string | null;
}

let t: TestApp;
let versionId: number;

beforeEach(async () => {
  t = makeTestApp();
  // Force ANTHROPIC_API_KEY missing to make critique fail fast (no real LLM call).
  delete process.env.ANTHROPIC_API_KEY;

  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "C-test",
    premise: "p",
  });
  const ch = await sendJson<ChapterJson>(
    t.app,
    `/api/books/${b.id}/chapters`,
    "POST",
    { title: "Глава" },
  );
  const v = await sendJson<VersionJson>(
    t.app,
    `/api/chapters/${ch.id}/versions`,
    "POST",
    {
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Текст главы для критики." }],
          },
        ],
      },
    },
  );
  versionId = v.id;
});
afterEach(() => t.cleanup());

describe("critique endpoints", () => {
  it("GET returns null when no report exists", async () => {
    const res = await sendJson<ReportJson | null>(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "GET",
    );
    expect(res).toBeNull();
  });

  it("404 when chapter_version missing", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/9999/critique`,
      "GET",
    );
    expect(res.status).toBe(404);
  });

  it("POST without API key returns error report (no real LLM)", async () => {
    const r = await sendJson<ReportJson>(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "POST",
      {},
    );
    expect(r.id).toBeGreaterThan(0);
    expect(["error", "done"]).toContain(r.status);
    if (r.status === "error") {
      expect(r.errorMessage).toBeTruthy();
    }
  });

  it("все критики упали — статус error, а не done (AC-27)", async () => {
    // ANTHROPIC_API_KEY удалён в beforeEach: каждый критик падает на старте.
    const r = await sendJson<{
      status: string;
      errorMessage: string | null;
      report: { requestedCritics: string[]; failedCritics: string[] } | null;
    }>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

    expect(r.status).toBe("error");
    expect(r.errorMessage).toBeTruthy();
    expect(r.report?.failedCritics).toHaveLength(4);
    expect(r.report?.requestedCritics).toHaveLength(4);
  });

  it("статус считается от числа запрошенных критиков, а не от длины списка успешных", async () => {
    const r = await sendJson<{
      status: string;
      report: { requestedCritics: string[]; failedCritics: string[] } | null;
    }>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {
      critics: ["style"],
    });
    expect(r.report?.requestedCritics).toEqual(["style"]);
    expect(r.status).toBe("error");
  });

  it("POST validates `critics` field", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "POST",
      { critics: [] },
    );
    expect(res.status).toBe(400);
  });

  it("POST 404 for missing version", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/9999/critique`,
      "POST",
      {},
    );
    expect(res.status).toBe(404);
  });

  it("DELETE removes report", async () => {
    await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "POST",
      {},
    );
    const del = await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "DELETE",
    );
    expect(del.status).toBe(204);
    const after = await sendJson<ReportJson | null>(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "GET",
    );
    expect(after).toBeNull();
  });

  it("DELETE returns 404 when nothing to delete", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "DELETE",
    );
    expect(res.status).toBe(404);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTestApp,
  send,
  sendJson,
  type TestApp,
} from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
}

let t: TestApp;
let chapterId: number;

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  // Force inline back to api in tests — subscription default would try to
  // spawn the Claude Code CLI subprocess and stall the 5s test timeout.
  process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ inline: "api" });
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Inline-test",
    premise: "p",
  });
  const ch = await sendJson<ChapterJson>(
    t.app,
    `/api/books/${b.id}/chapters`,
    "POST",
    { title: "Глава" },
  );
  chapterId = ch.id;
});
afterEach(() => {
  delete process.env.LLM_AGENT_BACKEND_MAP;
  return t.cleanup();
});

describe("inline endpoint", () => {
  it("404 when chapter missing", async () => {
    const res = await send(t.app, "/api/chapters/9999/inline", "POST", {
      command: "continue",
      selectionText: null,
      beforeText: "",
      afterText: "",
    });
    expect(res.status).toBe(404);
  });

  it("400 when invalid command", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "explode",
      selectionText: null,
      beforeText: "",
      afterText: "",
    });
    expect(res.status).toBe(400);
  });

  it("400 when rewrite without selection", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "rewrite",
      selectionText: null,
      beforeText: "abc",
      afterText: "xyz",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("400 when shorten with empty selection", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "shorten",
      selectionText: "  ",
      beforeText: "",
      afterText: "",
    });
    expect(res.status).toBe(400);
  });

  it("rejects oversized beforeText (>8000 chars)", async () => {
    const big = "a".repeat(9000);
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "continue",
      selectionText: null,
      beforeText: big,
      afterText: "",
    });
    expect(res.status).toBe(400);
  });

  it("continue with empty selection passes validation (LLM call may error without API key)", async () => {
    // Without API key the SSE stream will surface an 'error' event, but the
    // request itself must accept the input as valid (HTTP 200, SSE body).
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "continue",
      selectionText: null,
      beforeText: "Глава началась тихо. ",
      afterText: "",
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // SSE body should mention error event because no API key is set.
    expect(text).toContain("event: error");
  });

  it("400 when describe without sense", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "describe",
      selectionText: "Старый дом встретил её темнотой.",
      beforeText: "",
      afterText: "",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("describe with sense passes validation", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/inline`, "POST", {
      command: "describe",
      sense: "smell",
      selectionText: "Старый дом встретил её темнотой.",
      beforeText: "Она толкнула дверь.",
      afterText: "Потом было тихо.",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("event: error");
  });
});

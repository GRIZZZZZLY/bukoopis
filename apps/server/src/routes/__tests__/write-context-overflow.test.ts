import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * AC-14: если обязательный слой контекста не помещается в бюджет, Writer
 * отказывает понятной ошибкой, а не пишет главу без ограничений, о которых
 * модели не сказали. Бюджет — константа модуля, поэтому переполнение здесь
 * подменяется на выходе компилятора; логика самого компилятора проверяется в
 * его собственном тесте.
 */

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterWriter: vi.fn(),
}));
vi.mock("@book-forge/retrieval", async (orig) => ({
  ...(await orig<typeof import("@book-forge/retrieval")>()),
  hybridSearch: vi.fn(async () => []),
}));
vi.mock("../../utils/context-compiler.js", async (orig) => {
  const real = await orig<typeof import("../../utils/context-compiler.js")>();
  return {
    ...real,
    compileContext: vi.fn((...args: Parameters<typeof real.compileContext>) => {
      const compiled = real.compileContext(...args);
      return { ...compiled, requiredOverflow: true, requiredTokens: 999_999 };
    }),
  };
});

import { runChapterWriter } from "@book-forge/agents";
import Database from "better-sqlite3";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runChapterWriterMock = vi.mocked(runChapterWriter);

let t: TestApp;
let chapterId: number;

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  runChapterWriterMock.mockReset();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Переполнение",
    premise: "p",
  });
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/chapters`, "POST", {
    title: "Глава",
  });
  chapterId = ch.id;
  const db = new Database(`${t.dbDir}/test.sqlite`);
  db.prepare("UPDATE chapters SET plan_json = ? WHERE id = ?").run(
    JSON.stringify({
      variants: [
        {
          label: "v1",
          pov: "Рин",
          emotionalGoal: "решимость",
          estimatedWords: 1200,
          beats: [
            { index: 0, type: "scene", summary: "s", goal: "g", conflict: "c", outcome: "o" },
          ],
        },
      ],
      selectedIndex: 0,
    }),
    chapterId,
  );
  db.close();
});
afterEach(() => t.cleanup());

describe("POST /api/chapters/:id/write при переполнении обязательного слоя", () => {
  it("отказывает до первого токена и не заводит кандидата", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { message: string } };
    expect(body.error).toBe("bad_request");
    expect(body.details.message).toMatch(/обязательный контекст/);
    expect(body.details.message).toMatch(/не помещается/);
    // Писатель не вызывался, кандидат не создан: отказ случился ДО генерации.
    expect(runChapterWriterMock).not.toHaveBeenCalled();
    const proposals = t.sqlite
      .prepare("SELECT COUNT(*) n FROM prose_proposals WHERE chapter_id = ?")
      .get(chapterId) as { n: number };
    expect(proposals.n).toBe(0);
  });
});

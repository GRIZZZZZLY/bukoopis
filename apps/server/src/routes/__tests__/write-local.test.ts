import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterWriter: vi.fn(),
  runSceneIntent: vi.fn(),
  runLocalScene: vi.fn(),
  localWriterAvailable: vi.fn(),
}));

import {
  runChapterWriter,
  runSceneIntent,
  runLocalScene,
  localWriterAvailable,
} from "@book-forge/agents";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const writerMock = vi.mocked(runChapterWriter);
const sceneIntentMock = vi.mocked(runSceneIntent);
const localMock = vi.mocked(runLocalScene);
const availableMock = vi.mocked(localWriterAvailable);
let t: TestApp;
let bookId: number;
let chapterId: number;

function plan(beats: number, estimatedWords: number) {
  return {
    variants: [
      {
        label: "v1",
        pov: "Нина",
        emotionalGoal: "тревога",
        estimatedWords,
        beats: Array.from({ length: beats }, (_, i) => ({
          index: i,
          type: "rising_action",
          summary: `беат ${i}`,
          goal: "g",
          conflict: "c",
          outcome: "o",
        })),
      },
    ],
    selectedIndex: 0,
    generatedAt: "2026-11-17T00:00:00.000Z",
  };
}

function result(text: string, stopReason: string | null = "end_turn") {
  return {
    text,
    modelId: "bookopis:latest",
    stopReason,
    tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
  };
}

function setPlan(id: number, beats: number, words: number) {
  t.sqlite
    .prepare("UPDATE chapters SET plan_json = ?, active_plan_kind = 'beats' WHERE id = ?")
    .run(JSON.stringify(plan(beats, words)), id);
}

/** Первая глава получает принятую версию, вторая — план; пишется вторая. */
async function secondChapter(): Promise<number> {
  await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
    contentJson: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Он шёл по дороге и думал о доме." }] },
        { type: "paragraph", content: [{ type: "text", text: "Дверь закрылась за ним тихо." }] },
      ],
    },
  });
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Вторая" });
  setPlan(ch.id, 4, 1200);
  return ch.id;
}

beforeEach(async () => {
  t = makeTestApp();
  process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "api" });
  writerMock.mockReset();
  sceneIntentMock.mockReset();
  localMock.mockReset();
  availableMock.mockReset();
  availableMock.mockResolvedValue(true);
  writerMock.mockImplementation(async function* () {
    yield "Старый путь.";
    return result("Старый путь.");
  });
  let n = 0;
  localMock.mockImplementation(async function* () {
    const text = `Сцена ${n++}.`;
    yield text;
    return result(text);
  });
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К", premise: "п" });
  bookId = b.id;
  t.sqlite
    .prepare("UPDATE books SET writer_provider = 'ollama', writer_local_model = 'bookopis:latest' WHERE id = ?")
    .run(bookId);
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Глава" });
  chapterId = ch.id;
  setPlan(chapterId, 4, 1200);
});
afterEach(() => {
  delete process.env.LLM_AGENT_BACKEND_MAP;
  return t.cleanup();
});

function events(body: string, name: string): unknown[] {
  return body
    .split("\n\n")
    .filter((f) => f.includes(`event: ${name}`))
    .map((f) => JSON.parse(f.split("\n").find((l) => l.startsWith("data:"))!.slice(5)));
}

type Done = { cancelled?: boolean; proposal: { contentText: string; status: string; beatsTotal: number | null } };

async function write(id: number, body: object = {}): Promise<string> {
  const res = await send(t.app, `/api/chapters/${id}/write`, "POST", body);
  expect(res.status).toBe(200);
  return res.text();
}

function prompts(): string[] {
  return localMock.mock.calls.map((c) => c[0].prompt);
}

describe("глава нашей моделью по сценам", () => {
  it("writes one call per scene", async () => {
    const body = await write(chapterId);
    expect(localMock).toHaveBeenCalledTimes(2);
    expect(localMock.mock.calls[0]?.[0].modelTag).toBe("bookopis:latest");
    expect(events(body, "beat")).toEqual([
      { index: 0, total: 2 },
      { index: 1, total: 2 },
    ]);
    expect(events(body, "scene_intent")).toEqual([{ prepared: false, degraded: false, droppedEventIds: 0 }]);
    const done = events(body, "done")[0] as Done;
    expect(done.proposal.contentText).toBe("Сцена 0.\n\nСцена 1.");
    expect(done.proposal.beatsTotal).toBe(2);
    expect(done.proposal.status).toBe("ready");
    expect(writerMock).not.toHaveBeenCalled();
    expect(sceneIntentMock).not.toHaveBeenCalled();
  });

  it("mode is ignored: «целиком» still goes scene by scene", async () => {
    await write(chapterId, { mode: "whole" });
    expect(localMock).toHaveBeenCalledTimes(2);
  });

  it("first scene tail is previous chapter, second is text so far", async () => {
    const id = await secondChapter();
    await write(id);
    const [p0, p1] = prompts();
    expect(p0).toContain("### Конец предыдущей сцены\nОн шёл по дороге и думал о доме.");
    expect(p0).toContain("Дверь закрылась за ним тихо.\n\n### Текст главы\n");
    expect(p1).toContain("### Конец предыдущей сцены\nСцена 0.\n\n### Текст главы\n");
    expect(p0).toContain("События:\n1. беат 0\n2. беат 1\n");
    expect(p1).toContain("События:\n1. беат 2\n2. беат 3\n");
  });

  it("manner from previous chapter", async () => {
    const id = await secondChapter();
    await write(id);
    expect(prompts()[0]).toMatch(/\nМанера: повествование от /u);
  });

  it("no manner for the first chapter", async () => {
    await write(chapterId);
    expect(prompts()[0]).not.toContain("Манера:");
    expect(prompts()[0]).toContain("### Конец предыдущей сцены\n—\n\n");
  });

  it("cast line comes from the participant's profile", async () => {
    await sendJson(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "Нина",
      profile: { description: "Сыщица из Твери. Любит чай." },
    });
    await write(chapterId);
    expect(prompts()[0]).toContain("### Действующие лица\nНина — Сыщица из Твери.\n\n");
  });

  it("cancel stops before next scene", async () => {
    setPlan(chapterId, 3, 1800);
    let n = 0;
    localMock.mockImplementation(async function* () {
      const i = n++;
      if (i === 1) {
        const row = t.sqlite
          .prepare("SELECT id FROM prose_proposals WHERE status = 'streaming' ORDER BY id DESC LIMIT 1")
          .get() as { id: number };
        const r = await send(t.app, `/api/prose-proposals/${row.id}/cancel`, "POST", {});
        expect(r.status).toBe(200);
      }
      const text = `Сцена ${i}.`;
      yield text;
      return result(text);
    });
    const body = await write(chapterId);
    expect(localMock).toHaveBeenCalledTimes(2);
    expect((events(body, "done")[0] as Done).cancelled).toBe(true);
  });

  it("length on last scene is incomplete", async () => {
    let n = 0;
    localMock.mockImplementation(async function* () {
      const i = n++;
      const text = `Сцена ${i}.`;
      yield text;
      return result(text, i === 1 ? "max_tokens" : "end_turn");
    });
    const body = await write(chapterId);
    expect((events(body, "done")[0] as Done).proposal.status).toBe("incomplete");
  });

  it("non-raw ollama model uses the old path", async () => {
    availableMock.mockResolvedValue(false);
    await write(chapterId);
    expect(writerMock).toHaveBeenCalledTimes(1);
    expect(localMock).not.toHaveBeenCalled();
  });

  it("anthropic book never asks ollama", async () => {
    t.sqlite.prepare("UPDATE books SET writer_provider = 'anthropic' WHERE id = ?").run(bookId);
    await write(chapterId);
    expect(availableMock).not.toHaveBeenCalled();
    expect(localMock).not.toHaveBeenCalled();
    expect(writerMock).toHaveBeenCalledTimes(1);
  });
});

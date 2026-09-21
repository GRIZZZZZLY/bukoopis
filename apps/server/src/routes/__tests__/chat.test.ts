import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runBookChat: vi.fn(),
}));

import { runBookChat } from "@book-forge/agents";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runBookChatMock = vi.mocked(runBookChat);
let t: TestApp;
let chapterId: number;

beforeEach(async () => {
  t = makeTestApp();
  runBookChatMock.mockReset();
  runBookChatMock.mockImplementation(async function* () {
    yield "Она ";
    yield "уйдёт.";
    return {
      text: "Она уйдёт.",
      modelId: "test-model",
      tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
    };
  });
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К", premise: "п" });
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/chapters`, "POST", { title: "Глава" });
  chapterId = ch.id;
});
afterEach(() => t.cleanup());

describe("чат по книге", () => {
  it("тред создаётся, перечисляется и удаляется", async () => {
    const th = await sendJson<{ id: number; chapterId: number; title: string | null }>(
      t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {},
    );
    expect(th.chapterId).toBe(chapterId);
    expect(th.title).toBeNull();
    const list = await sendJson<Array<{ id: number }>>(t.app, `/api/chapters/${chapterId}/chat/threads`, "GET");
    expect(list.map((x) => x.id)).toEqual([th.id]);
    expect((await send(t.app, `/api/chat/threads/${th.id}`, "DELETE")).status).toBe(204);
    expect((await send(t.app, `/api/chat/threads/${th.id}/messages`, "GET")).status).toBe(404);
    expect((await send(t.app, `/api/chapters/99999/chat/threads`, "POST", {})).status).toBe(404);
  });

  it("сообщение стримится, обе реплики ложатся в тред, тред получает название", async () => {
    const th = await sendJson<{ id: number }>(t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {});
    const res = await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", {
      content: "Что Нина сделает дальше?",
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: chunk");
    expect(body).toContain("event: done");
    const msgs = await sendJson<Array<{ role: string; content: string }>>(
      t.app, `/api/chat/threads/${th.id}/messages`, "GET",
    );
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1]?.content).toBe("Она уйдёт.");
    const [thread] = await sendJson<Array<{ title: string | null }>>(
      t.app, `/api/chapters/${chapterId}/chat/threads`, "GET",
    );
    expect(thread?.title).toBe("Что Нина сделает дальше?");
    const call = runBookChatMock.mock.calls[0]?.[0];
    expect(call?.message).toBe("Что Нина сделает дальше?");
    expect(call?.history).toEqual([]);
  });

  it("история едет в следующий запрос", async () => {
    const th = await sendJson<{ id: number }>(t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {});
    await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "Раз" });
    await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "Два" });
    const second = runBookChatMock.mock.calls[1]?.[0];
    expect(second?.history.map((m) => m.content)).toEqual(["Раз", "Она уйдёт."]);
  });

  it("пустое сообщение — 400; сбой модели — event: error, ответ не сохраняется", async () => {
    const th = await sendJson<{ id: number }>(t.app, `/api/chapters/${chapterId}/chat/threads`, "POST", {});
    expect((await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "   " })).status).toBe(400);
    runBookChatMock.mockImplementation(async function* () {
      yield "";
      throw new Error("backend down");
    });
    const res = await send(t.app, `/api/chat/threads/${th.id}/messages`, "POST", { content: "Вопрос" });
    expect(await res.text()).toContain("event: error");
    const msgs = await sendJson<Array<{ role: string }>>(t.app, `/api/chat/threads/${th.id}/messages`, "GET");
    expect(msgs.map((m) => m.role)).toEqual(["user"]);
  });
});

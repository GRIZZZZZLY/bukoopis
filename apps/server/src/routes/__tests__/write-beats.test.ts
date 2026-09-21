import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterWriter: vi.fn(),
}));

import { runChapterWriter } from "@book-forge/agents";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const writerMock = vi.mocked(runChapterWriter);
let t: TestApp;
let bookId: number;
let chapterId: number;

const PLAN = {
  variants: [
    {
      label: "v1",
      pov: "Нина",
      emotionalGoal: "тревога",
      estimatedWords: 900,
      beats: [0, 1, 2].map((i) => ({
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
  generatedAt: "2026-09-21T00:00:00.000Z",
};

function okResult(text: string) {
  return {
    text,
    modelId: "test-model",
    stopReason: "end_turn",
    tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
  };
}

beforeEach(async () => {
  t = makeTestApp();
  process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ writer: "api" });
  writerMock.mockReset();
  writerMock.mockImplementation(async function* (input) {
    const i = input.beat?.index ?? -1;
    const text = `Абзац беата ${i}.`;
    yield text;
    return okResult(text);
  });
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К", premise: "п" });
  bookId = b.id;
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Глава" });
  chapterId = ch.id;
  t.sqlite.prepare("UPDATE chapters SET plan_json = ? WHERE id = ?").run(JSON.stringify(PLAN), chapterId);
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

describe("глава по беатам", () => {
  it("один вызов на беат, текст копится в одном кандидате", async () => {
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(writerMock).toHaveBeenCalledTimes(3);
    expect(writerMock.mock.calls.map((c) => c[0].beat?.index)).toEqual([0, 1, 2]);
    expect(writerMock.mock.calls[2]?.[0].beat?.textSoFar).toBe("Абзац беата 0.\n\nАбзац беата 1.");
    expect(events(body, "beat")).toEqual([
      { index: 0, total: 3 },
      { index: 1, total: 3 },
      { index: 2, total: 3 },
    ]);
    const done = events(body, "done")[0] as { proposal: { contentText: string; beatsDone: number; beatsTotal: number; status: string } };
    expect(done.proposal.contentText).toBe("Абзац беата 0.\n\nАбзац беата 1.\n\nАбзац беата 2.");
    expect(done.proposal.beatsDone).toBe(3);
    expect(done.proposal.beatsTotal).toBe(3);
    expect(done.proposal.status).toBe("ready");
  });

  it("целиком — как прежде: один вызов, beats null", async () => {
    writerMock.mockImplementation(async function* () {
      yield "Вся глава.";
      return okResult("Вся глава.");
    });
    const body = await (await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {})).text();
    expect(writerMock).toHaveBeenCalledTimes(1);
    expect(writerMock.mock.calls[0]?.[0].beat).toBeUndefined();
    const done = events(body, "done")[0] as { proposal: { beatsDone: number | null } };
    expect(done.proposal.beatsDone).toBeNull();
  });

  it("удержание после беата сохраняет написанное как incomplete", async () => {
    writerMock.mockImplementation(async function* (input) {
      const i = input.beat?.index ?? -1;
      if (i === 1) {
        const row = t.sqlite
          .prepare("SELECT id FROM prose_proposals WHERE status = 'streaming' ORDER BY id DESC LIMIT 1")
          .get() as { id: number };
        const hold = await send(t.app, `/api/prose-proposals/${row.id}/hold`, "POST");
        expect(hold.status).toBe(200);
      }
      const text = `Беат ${i}.`;
      yield text;
      return okResult(text);
    });
    const body = await (await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats" })).text();
    expect(writerMock).toHaveBeenCalledTimes(2);
    const done = events(body, "done")[0] as {
      held?: boolean;
      proposal: { status: string; stopReason: string | null; beatsDone: number; contentText: string };
    };
    expect(done.held).toBe(true);
    expect(done.proposal.status).toBe("incomplete");
    expect(done.proposal.stopReason).toBe("held");
    expect(done.proposal.beatsDone).toBe(2);
    expect(done.proposal.contentText).toBe("Беат 0.\n\nБеат 1.");
  });

  // Версия на ДВА абзаца: `content_text` склеен `extractText` в одну строку,
  // и на одноабзацной главе оба источника префикса неотличимы. Пустая строка
  // между абзацами — единственное, что отличает верный префикс от склеенного.
  it("дописать с беата берёт префикс из принятой версии, сохраняя абзацы", async () => {
    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Принятое начало." }] },
          { type: "paragraph", content: [{ type: "text", text: "Второй абзац начала." }] },
        ],
      },
    });
    const body = await (
      await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats", fromBeat: 2 })
    ).text();
    expect(writerMock).toHaveBeenCalledTimes(1);
    expect(writerMock.mock.calls[0]?.[0].beat).toEqual({
      index: 2,
      textSoFar: "Принятое начало.\n\nВторой абзац начала.",
    });
    const done = events(body, "done")[0] as { proposal: { contentText: string; beatsDone: number } };
    expect(done.proposal.contentText).toBe(
      "Принятое начало.\n\nВторой абзац начала.\n\nАбзац беата 2.",
    );
    expect(done.proposal.beatsDone).toBe(3);
  });

  it("написанный беат лежит в кандидате ещё до конца прогона", async () => {
    let midRun: { content_text: string; beats_done: number | null; status: string } | undefined;
    writerMock.mockImplementation(async function* (input) {
      const i = input.beat?.index ?? -1;
      // Снимок читаем ПЕРЕД вторым беатом: первый уже дописан, прогон ещё идёт.
      if (i === 1) {
        midRun = t.sqlite
          .prepare(
            "SELECT content_text, beats_done, status FROM prose_proposals ORDER BY id DESC LIMIT 1",
          )
          .get() as typeof midRun;
      }
      const text = `Абзац беата ${i}.`;
      yield text;
      return okResult(text);
    });
    // Тело SSE ленивое: без вычитывания обработчик не начнёт работу вовсе.
    await (await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats" })).text();
    expect(midRun?.status).toBe("streaming");
    expect(midRun?.content_text).toBe("Абзац беата 0.");
    expect(midRun?.beats_done).toBe(1);
  });

  it("падение на втором беате оставляет первый принимаемым", async () => {
    writerMock.mockImplementation(async function* (input) {
      const i = input.beat?.index ?? -1;
      if (i === 1) throw new Error("бэкенд отвалился");
      const text = `Абзац беата ${i}.`;
      yield text;
      return okResult(text);
    });
    const body = await (
      await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats" })
    ).text();
    const { proposalId } = events(body, "proposal")[0] as { proposalId: number };
    const proposal = await sendJson<{
      status: string;
      stopReason: string | null;
      contentText: string;
      beatsDone: number;
      errorMessage: string | null;
    }>(t.app, `/api/prose-proposals/${proposalId}`, "GET");
    expect(proposal.status).toBe("incomplete");
    expect(proposal.stopReason).toBe("interrupted");
    expect(proposal.contentText).toBe("Абзац беата 0.");
    expect(proposal.beatsDone).toBe(1);
    // Ошибка остаётся видимой: обрыв не превращается в тихий обычный кандидат.
    expect(proposal.errorMessage).toContain("бэкенд отвалился");

    // Главное: написанное можно взять, а не только увидеть.
    const accepted = await send(t.app, `/api/prose-proposals/${proposalId}/accept`, "POST", {
      requestId: "req-interrupted",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: true,
      acknowledgeContextDrift: true,
    });
    expect(accepted.status).toBe(200);
  });

  it("падение на первом беате — обычный отказ, принимать нечего", async () => {
    writerMock.mockImplementation(async function* () {
      throw new Error("бэкенд отвалился сразу");
      // eslint-disable-next-line no-unreachable
      yield "";
    });
    const body = await (
      await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats" })
    ).text();
    const { proposalId } = events(body, "proposal")[0] as { proposalId: number };
    const proposal = await sendJson<{ status: string; beatsDone: number | null }>(
      t.app,
      `/api/prose-proposals/${proposalId}`,
      "GET",
    );
    expect(proposal.status).toBe("failed");
    expect(proposal.beatsDone).toBeNull();
  });

  it("fromBeat без mode=beats и за пределами плана — 400", async () => {
    expect((await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { fromBeat: 1 })).status).toBe(400);
    expect(
      (await send(t.app, `/api/chapters/${chapterId}/write`, "POST", { mode: "beats", fromBeat: 3 })).status,
    ).toBe(400);
  });
});

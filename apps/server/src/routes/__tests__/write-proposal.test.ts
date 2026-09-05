import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterWriter: vi.fn(),
}));
// Маршрут генерации зовёт retrieval; без мока он полез бы в ONNX-эмбеддинги —
// медленно и не про этот тест. Ошибки там глушатся, но ждать их незачем.
vi.mock("@book-forge/retrieval", async (orig) => ({
  ...(await orig<typeof import("@book-forge/retrieval")>()),
  hybridSearch: vi.fn(async () => []),
}));
// Регрессия: даёт возможность уронить logUsage ПОСЛЕ того, как кандидат уже
// дописан, не трогая остальную логику усечения usage. По умолчанию — no-op,
// так же безопасно для прочих тестов файла, как настоящий вызов.
vi.mock("../../utils/usageLogger.js", async (orig) => ({
  ...(await orig<typeof import("../../utils/usageLogger.js")>()),
  logUsage: vi.fn(),
}));

import { runChapterWriter } from "@book-forge/agents";
import { logUsage } from "../../utils/usageLogger.js";
import Database from "better-sqlite3";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runChapterWriterMock = vi.mocked(runChapterWriter);
const logUsageMock = vi.mocked(logUsage);

interface BookJson { id: number }
interface ChapterJson { id: number }

let t: TestApp;
let bookId: number;
let chapterId: number;

/** Собирает SSE-ответ в события: тестам нужен разбор, а не сырой текст. */
async function readSse(res: Response): Promise<Array<{ event: string; data: unknown }>> {
  const raw = await res.text();
  return raw
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "message";
      const data = block.match(/^data: (.+)$/m)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });
}

function mockWriter(text: string, stopReason: string | null): void {
  runChapterWriterMock.mockImplementation(
    // eslint-disable-next-line require-yield
    async function* () {
      yield text.slice(0, 5);
      return {
        text,
        modelId: "test-model",
        stopReason,
        tokens: { input: 1, output: 2, cacheCreation: 0, cacheRead: 0 },
      };
    } as never,
  );
}

function seedSelectedPlan(): void {
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
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  runChapterWriterMock.mockReset();
  logUsageMock.mockReset();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Кандидат",
    premise: "p",
  });
  bookId = b.id;
  const ch = await sendJson<ChapterJson>(t.app, `/api/books/${bookId}/chapters`, "POST", {
    title: "Глава",
  });
  chapterId = ch.id;
  seedSelectedPlan();
});
afterEach(() => t.cleanup());

describe("POST /api/chapters/:id/write", () => {
  it("создаёт кандидата и не трогает текущую версию главы (AC-16)", async () => {
    mockWriter("Первый абзац.\n\nВторой абзац.", "end_turn");

    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    const proposal = (done!.data as { proposal: { id: number; status: string; completion: string } })
      .proposal;
    expect(proposal.status).toBe("ready");
    expect(proposal.completion).toBe("confirmed");

    const chapter = await sendJson<{ currentVersionId: number | null; draft: unknown }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(chapter.currentVersionId).toBeNull();
    expect(chapter.draft).toBeNull();
  });

  it("сообщает идентификатор кандидата в начале потока", async () => {
    mockWriter("Текст.", "end_turn");
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    const begin = events.find((e) => e.event === "proposal");
    expect(begin).toBeDefined();
    expect((begin!.data as { proposalId: number }).proposalId).toBeGreaterThan(0);
  });

  it("не ставит заданий памяти до принятия (AC-16)", async () => {
    mockWriter("Текст.", "end_turn");
    await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const db = new Database(`${t.dbDir}/test.sqlite`);
    const jobs = db.prepare("SELECT COUNT(*) c FROM memory_jobs").get() as { c: number };
    db.close();
    expect(jobs.c).toBe(0);
  });

  it("бэкенд без причины остановки даёт незавершённого кандидата (AC-37)", async () => {
    mockWriter("Обрубок", null);
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    const proposal = (events.find((e) => e.event === "done")!.data as {
      proposal: { status: string; completion: string };
    }).proposal;
    expect(proposal.status).toBe("incomplete");
    expect(proposal.completion).toBe("unconfirmed");
  });

  it("лимит вывода — тоже незавершённый кандидат (AC-37)", async () => {
    mockWriter("Обрубок по лимиту", "max_tokens");
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    const proposal = (events.find((e) => e.event === "done")!.data as {
      proposal: { status: string; stopReason: string | null };
    }).proposal;
    expect(proposal.status).toBe("incomplete");
    expect(proposal.stopReason).toBe("max_tokens");
  });

  it("падение агента помечает кандидата failed, а не оставляет streaming", async () => {
    runChapterWriterMock.mockImplementation(
      // eslint-disable-next-line require-yield
      async function* () {
        throw new Error("бэкенд недоступен");
      } as never,
    );
    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    expect(events.find((e) => e.event === "error")).toBeDefined();

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const row = db
      .prepare("SELECT status, error_message FROM prose_proposals ORDER BY id DESC LIMIT 1")
      .get() as { status: string; error_message: string | null };
    db.close();
    expect(row.status).toBe("failed");
    expect(row.error_message).toContain("бэкенд недоступен");
  });

  it("сбой logUsage после генерации не понижает уже готового кандидата (regression)", async () => {
    mockWriter("Готовый текст.", "end_turn");
    logUsageMock.mockImplementationOnce(() => {
      throw new Error("usage logger недоступен");
    });

    const res = await send(t.app, `/api/chapters/${chapterId}/write`, "POST", {});
    const events = await readSse(res);
    // Кандидат уже дописан к моменту сбоя — событие "done" уйти не могло, но
    // и понижать до failed то, что уже готово, нельзя.
    expect(events.find((e) => e.event === "error")).toBeDefined();
    expect(events.find((e) => e.event === "done")).toBeUndefined();

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const row = db
      .prepare("SELECT status, model_id FROM prose_proposals ORDER BY id DESC LIMIT 1")
      .get() as { status: string; model_id: string | null };
    db.close();
    expect(row.status).toBe("ready");
    expect(row.model_id).toBe("test-model");
  });
});

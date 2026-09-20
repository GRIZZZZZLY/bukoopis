import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runCastCheck = vi.hoisted(() => vi.fn());
vi.mock("@book-forge/agents", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@book-forge/agents");
  return { ...actual, runCastCheck };
});

/**
 * Проверка различий состава (ТЗ 9.1). Отчёт — предложение: героев он не
 * меняет. Проверяется соединение — отсев выдуманных номеров, привязка к
 * составу на момент проверки и то, что правка героя делает отчёт устаревшим.
 */

let t: TestApp;
let bookId: number;
let ninaId: number;
let vortId: number;

async function makeCharacter(name: string): Promise<number> {
  const c = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: name,
    profile: { description: "Герой этой книги.", want: "чего-то хочет" },
  });
  return c.id;
}

function answer(ids: number[]) {
  return {
    pairs: [
      {
        characterIds: ids,
        similarity: "оба уходят от прямого ответа",
        basis: "совпадают принципы и голос",
        situations: ["request_for_help"],
        directions: ["дать одному физическое действие вместо паузы"],
        keep: "сама пауза работает",
      },
    ],
    notes: "Остальные различимы",
  };
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  runCastCheck.mockReset();
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Состав" });
  bookId = b.id;
  ninaId = await makeCharacter("Нина Соловьёва");
  vortId = await makeCharacter("Ворт Соловьёв");
});
afterEach(() => t.cleanup());

describe("POST /books/:id/cast-check", () => {
  it("возвращает и сохраняет отчёт", async () => {
    runCastCheck.mockResolvedValue(answer([ninaId, vortId]));
    const r = await sendJson<{ report: { pairs: unknown[]; basis: unknown[] }; stale: boolean }>(
      t.app,
      `/api/books/${bookId}/cast-check`,
      "POST",
      {},
    );
    expect(r.report.pairs).toHaveLength(1);
    expect(r.report.basis).toHaveLength(2);
    expect(r.stale).toBe(false);

    const saved = await sendJson<{ report: { pairs: unknown[] } | null }>(
      t.app,
      `/api/books/${bookId}/cast-check`,
      "GET",
    );
    expect(saved.report?.pairs).toHaveLength(1);
  });

  it("пара с выдуманным номером героя выбрасывается", async () => {
    runCastCheck.mockResolvedValue(answer([ninaId, 999_999]));
    const r = await sendJson<{ report: { pairs: unknown[] }; droppedPairs: number }>(
      t.app,
      `/api/books/${bookId}/cast-check`,
      "POST",
      {},
    );
    expect(r.report.pairs).toEqual([]);
    expect(r.droppedPairs).toBe(1);
  });

  it("меньше двух героев — проверять нечего, 400 и никакого вызова", async () => {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Один" });
    const res = await send(t.app, `/api/books/${b.id}/cast-check`, "POST", {});
    expect(res.status).toBe(400);
    expect(runCastCheck).not.toHaveBeenCalled();
  });

  it("героев не меняет: отчёт это предложение", async () => {
    const before = await sendJson<Array<{ revision: number }>>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    runCastCheck.mockResolvedValue(answer([ninaId, vortId]));
    await sendJson(t.app, `/api/books/${bookId}/cast-check`, "POST", {});
    const after = await sendJson<Array<{ revision: number }>>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(after.map((c) => c.revision)).toEqual(before.map((c) => c.revision));
  });

  it("правка героя делает сохранённый отчёт устаревшим", async () => {
    runCastCheck.mockResolvedValue(answer([ninaId, vortId]));
    await sendJson(t.app, `/api/books/${bookId}/cast-check`, "POST", {});

    const list = await sendJson<Array<{ id: number; revision: number }>>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    const nina = list.find((c) => c.id === ninaId)!;
    await sendJson(t.app, `/api/characters/${ninaId}`, "PATCH", {
      expectedRevision: nina.revision,
      profile: { description: "Другое описание героя книги." },
    });

    const after = await sendJson<{ stale: boolean }>(
      t.app,
      `/api/books/${bookId}/cast-check`,
      "GET",
    );
    expect(after.stale).toBe(true);
  });

  it("проверки не было — отчёта нет, и это не ошибка", async () => {
    const r = await sendJson<{ report: null; stale: boolean }>(
      t.app,
      `/api/books/${bookId}/cast-check`,
      "GET",
    );
    expect(r.report).toBeNull();
    expect(r.stale).toBe(false);
  });
});

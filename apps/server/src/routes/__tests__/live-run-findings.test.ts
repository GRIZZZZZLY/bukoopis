import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

const runAspectVariants = vi.hoisted(() => vi.fn());
vi.mock("@book-forge/agents/aspects/variants", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@book-forge/agents/aspects/variants",
  );
  return { ...actual, runAspectVariants };
});

/**
 * Находки живого прогона 2026-09-20. Каждая — про то, что инструмент говорит
 * автору неправду или молчит там, где должен сказать.
 */

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  runAspectVariants.mockReset();
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Находки" });
  bookId = b.id;
});
afterEach(() => t.cleanup());

describe("учёт расходов Мастерской", () => {
  it("генерация вариантов раздела попадает в журнал расходов", async () => {
    // Агент сообщает расход обратным вызовом — так же, как это делают
    // Писатель, критики и извлекатели памяти.
    runAspectVariants.mockImplementation(
      async (_input: unknown, options: { onUsage?: (u: unknown) => void }) => {
        options?.onUsage?.({
          modelId: "claude-sonnet-4-6",
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        });
        return { variants: [{ label: "а", payload: "Текст раздела." }] };
      },
    );

    // Состояние кладётся прямо в базу: проверяется учёт расходов, а не путь
    // сохранения этапа.
    t.sqlite.prepare("UPDATE books SET studio_state = ? WHERE id = ?").run(
      JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        stages: {
          world: {
            status: "in_progress",
            playbookGenerated: true,
            aspects: [
              {
                id: "a1",
                name: "география",
                status: "pending",
                order: 0,
                required: true,
                source: "llm",
                payloadKind: "markdown",
                variants: [],
              },
            ],
          },
        },
      }),
      bookId,
    );

    const gen = await send(
      t.app,
      `/api/books/${bookId}/stages/world/aspects/a1/generate`,
      "POST",
      { expectedRevision: 1, aspect: { id: "a1", name: "география" }, accumulated: [] },
    );
    expect(gen.status).toBe(200);

    const usage = t.sqlite
      .prepare("SELECT route FROM llm_usage WHERE book_id = ?")
      .all(bookId) as Array<{ route: string }>;
    expect(usage.map((u) => u.route)).toContain("studio.aspect_variants");
  });
});

describe("«ничего не идёт» — штатный ответ, а не ошибка", () => {
  it("разбор материалов не идёт — 200 и признак, а не 404", async () => {
    const res = await send(t.app, `/api/books/${bookId}/intake/inflight`, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ running: false });
  });

  it("быстрый сбор не идёт — тоже 200", async () => {
    const res = await send(t.app, `/api/books/${bookId}/quick-start/inflight`, "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ running: false });
  });

  it("книги нет — по-прежнему 404: это другая ошибка", async () => {
    const res = await send(t.app, `/api/books/999999/intake/inflight`, "GET");
    expect(res.status).toBe(404);
  });
});

describe("негодные данные — 400 с причиной, а не 500", () => {
  it("испорченное состояние Мастерской не даёт internal_error", async () => {
    t.sqlite
      .prepare("UPDATE books SET studio_state = ? WHERE id = ?")
      .run(JSON.stringify({ schemaVersion: 1, revision: "не число", stages: {} }), bookId);
    const res = await send(t.app, `/api/books/${bookId}/studio-state`, "GET");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_failed");
  });
});

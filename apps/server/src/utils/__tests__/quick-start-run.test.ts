import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Раннер зовёт те же функции агентов, что и обработчики Мастерской. Мокаем все
// четыре: без ключа к API они падали бы одинаково, и случай «этап уже собран»
// проверить было бы нечем.
vi.mock("@book-forge/agents/aspects/playbook", () => ({
  runAspectPlaybook: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/variants", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents/aspects/variants")>()),
  runAspectVariants: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/entity-variants", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents/aspects/entity-variants")>()),
  runAspectEntityVariants: vi.fn(),
}));
vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runBookPlanning: vi.fn(),
}));

import Database, { type Database as DatabaseType } from "better-sqlite3";
import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import { runAspectVariants } from "@book-forge/agents/aspects/variants";
import { runAspectEntityVariants } from "@book-forge/agents/aspects/entity-variants";
import { runBookPlanning } from "@book-forge/agents";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { createQuickStartCancelRegistry } from "../quick-start-cancel.js";
import { QUICK_START_STAGES, runQuickStart } from "../quick-start-run.js";
import { createStudioRepository } from "../../db/studio.js";

let t: TestApp;
let db: DatabaseType;
let bookId: number;

function deps() {
  return { sqlite: db, hasVec: false, repo: createStudioRepository(db), bookId };
}

function studioState(): {
  stages?: Record<string, { aspects?: Array<{ status: string; variants?: unknown[] }> }>;
} {
  const row = db
    .prepare("SELECT studio_state FROM books WHERE id = ?")
    .get(bookId) as { studio_state: string | null };
  return JSON.parse(row.studio_state ?? "{}") as {
    stages?: Record<string, { aspects?: Array<{ status: string; variants?: unknown[] }> }>;
  };
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Быстрый сбор",
    premise: "Картограф ищет остров, которого нет.",
  });
  bookId = b.id;
  db = new Database(`${t.dbDir}/test.sqlite`);

  vi.mocked(runAspectPlaybook).mockReset();
  vi.mocked(runAspectVariants).mockReset();
  vi.mocked(runAspectEntityVariants).mockReset();
  vi.mocked(runBookPlanning).mockReset();

  vi.mocked(runAspectPlaybook).mockResolvedValue({
    aspects: [
      {
        name: "Раздел",
        description: "О чём он",
        required: true,
        payloadKind: "markdown" as const,
      },
    ],
  });
  vi.mocked(runAspectVariants).mockResolvedValue({
    variants: [{ label: "v1", payload: "Текст раздела, достаточно длинный для схемы." }],
  });
  vi.mocked(runAspectEntityVariants).mockResolvedValue({
    variants: [
      {
        label: "v1",
        candidates: [
          {
            tempId: "c1",
            kind: "character" as const,
            profile: { name: "Нейла", summary: "Проводница каравана." },
          },
        ],
      },
    ],
  });
  vi.mocked(runBookPlanning).mockResolvedValue([
    {
      label: "тёмный",
      logline: "Логлайн",
      synopsis: "Синопсис",
      themes: ["поиск"],
      protagonist: "Картограф",
      antagonist: null,
      setting: "Архипелаг",
      arcs: [
        { title: "Арка", summary: "s", keyBeats: ["b"] },
        { title: "Сюжет", summary: "s", keyBeats: ["b"] },
      ],
      estimatedChapters: 12,
    },
  ]);
});
afterEach(() => {
  db.close();
  t.cleanup();
});

describe("createQuickStartCancelRegistry", () => {
  it("незарегистрированный прогон остановить нельзя", () => {
    const reg = createQuickStartCancelRegistry();
    expect(reg.requestStop(1)).toBe(false);
  });

  it("зарегистрированный помечается на остановку", () => {
    const reg = createQuickStartCancelRegistry();
    reg.begin(1);
    expect(reg.shouldStop(1)).toBe(false);
    expect(reg.requestStop(1)).toBe(true);
    expect(reg.shouldStop(1)).toBe(true);
  });

  it("остановка одной книги не задевает другую", () => {
    const reg = createQuickStartCancelRegistry();
    reg.begin(1);
    reg.begin(2);
    reg.requestStop(1);
    expect(reg.shouldStop(2)).toBe(false);
  });

  it("завершённый прогон исчезает из реестра", () => {
    const reg = createQuickStartCancelRegistry();
    reg.begin(1);
    reg.end(1);
    expect(reg.size()).toBe(0);
    expect(reg.requestStop(1)).toBe(false);
  });
});

describe("runQuickStart", () => {
  it("сообщает о каждом этапе по порядку", async () => {
    const seen: string[] = [];
    const result = await runQuickStart(deps(), { onStage: (e) => seen.push(`${e.stageId}:${e.status}`) });
    expect(result.stages.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.endsWith(":started")).map((s) => s.split(":")[0])).toEqual([
      ...QUICK_START_STAGES,
    ]);
  });

  it("ничего не утверждает: аспекты приходят на рассмотрение", async () => {
    await runQuickStart(deps(), {});
    const state = studioState();
    let seen = 0;
    for (const stage of Object.values(state.stages ?? {})) {
      for (const aspect of stage.aspects ?? []) {
        seen++;
        expect(aspect.status).not.toBe("accepted");
        expect(aspect.status).toBe("reviewing");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("план собран, но вариант за автора не выбран", async () => {
    await runQuickStart(deps(), {});
    const row = db
      .prepare("SELECT outline_json FROM books WHERE id = ?")
      .get(bookId) as { outline_json: string | null };
    const outline = JSON.parse(row.outline_json ?? "{}") as {
      variants: unknown[];
      selectedIndex: number | null;
    };
    expect(outline.variants).toHaveLength(1);
    expect(outline.selectedIndex).toBeNull();
  });

  it("глав не создаёт", async () => {
    await runQuickStart(deps(), {});
    const count = db
      .prepare("SELECT COUNT(*) c FROM chapters WHERE book_id = ?")
      .get(bookId) as { c: number };
    expect(count.c).toBe(0);
  });

  it("остановка прекращает прогон между этапами", async () => {
    let calls = 0;
    const result = await runQuickStart(deps(), {
      shouldStop: () => {
        calls++;
        return calls > 1;
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.stages.filter((s) => s.status === "started").length).toBeLessThan(
      QUICK_START_STAGES.length,
    );
  });

  it("падение одного этапа не уносит остальные", async () => {
    vi.mocked(runBookPlanning).mockRejectedValue(new Error("бэкенд недоступен"));
    const result = await runQuickStart(deps(), {});
    const failed = result.stages.filter((s) => s.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.stageId).toBe("plot");
    expect(failed[0]?.message).toContain("бэкенд недоступен");
    // Прогон дошёл до конца списка, а не оборвался на первом отказе.
    expect(result.cancelled).toBe(false);
    expect(result.stages.filter((s) => s.status === "done")).toHaveLength(
      QUICK_START_STAGES.length - 1,
    );
  });

  it("этап, на котором уже что-то лежит, пропускается", async () => {
    // Первый прогон наполняет этапы, второй должен их не трогать.
    await runQuickStart(deps(), {});
    const callsAfterFirst = vi.mocked(runAspectPlaybook).mock.calls.length;
    const second = await runQuickStart(deps(), {});
    expect(second.stages.filter((s) => s.status === "skipped")).toHaveLength(
      QUICK_START_STAGES.length,
    );
    expect(vi.mocked(runAspectPlaybook).mock.calls.length).toBe(callsAfterFirst);
  });

  it("список разделов сохраняется, даже если варианты не собрались", async () => {
    vi.mocked(runAspectVariants).mockRejectedValue(new Error("вариант не собрался"));
    const result = await runQuickStart(deps(), {});
    expect(result.stages.some((s) => s.status === "failed")).toBe(true);
    // Раздел лежит в pending: пятиминутное ожидание не должно кончаться пустотой.
    const world = studioState().stages?.["world"];
    expect(world?.aspects ?? []).toHaveLength(1);
    expect(world?.aspects?.[0]?.status).toBe("pending");
  });
});

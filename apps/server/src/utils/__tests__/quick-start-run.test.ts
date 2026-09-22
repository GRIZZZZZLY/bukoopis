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
vi.mock("@book-forge/agents/aspects/document", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents/aspects/document")>()),
  runAspectDocument: vi.fn(),
}));

import Database, { type Database as DatabaseType } from "better-sqlite3";
import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import { runAspectVariants } from "@book-forge/agents/aspects/variants";
import { runAspectEntityVariants } from "@book-forge/agents/aspects/entity-variants";
import { runAspectDocument } from "@book-forge/agents/aspects/document";
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
  vi.mocked(runAspectDocument).mockReset();
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
            profile: {
              name: "Нейла",
              role: "проводница",
              description: "Проводница каравана.",
            },
          },
        ],
      },
    ],
  });
  // Мир и лор — документные этапы (фаза 3): без дефолта здесь оба падали бы
  // на `result.sections` из `undefined`, и тесты, не знающие о документах
  // (падение одного этапа, повтор сбора и т.п.), ловили бы лишние "failed".
  vi.mocked(runAspectDocument).mockResolvedValue({
    sections: [
      {
        name: "раздел",
        description: "о чём раздел",
        markdown: "Текст раздела документа, достаточно длинный для схемы.",
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
    // До фазы 3 этот сценарий проверялся на "world" через `runAspectVariants`.
    // Мир теперь документный этап (см. describe ниже) и вариантов не собирает
    // вовсе — сценарий "список сохранён, вариант не собрался" по-прежнему жив
    // на "characters", который варианты собирает через `runAspectEntityVariants`.
    vi.mocked(runAspectEntityVariants).mockRejectedValue(new Error("вариант не собрался"));
    const result = await runQuickStart(deps(), {});
    expect(result.stages.some((s) => s.status === "failed")).toBe(true);
    // Раздел лежит в pending: пятиминутное ожидание не должно кончаться пустотой.
    const characters = studioState().stages?.["characters"];
    expect(characters?.aspects ?? []).toHaveLength(1);
    expect(characters?.aspects?.[0]?.status).toBe("pending");
  });
});

describe("runQuickStart: документные этапы (мир и лор)", () => {
  it("мир собирается одним вызовом, а не плейбуком и вариантами", async () => {
    vi.mocked(runAspectDocument).mockResolvedValue({
      sections: [
        { name: "география", description: "рельеф", markdown: "Текст географии." },
        { name: "власть", description: "кто правит", markdown: "Текст власти." },
      ],
    });
    const d = deps();
    await runQuickStart(d, { onStage: () => {} });

    expect(
      vi.mocked(runAspectDocument).mock.calls.some(
        (c) => (c[0] as { stageId: string }).stageId === "world",
      ),
    ).toBe(true);
    expect(
      vi.mocked(runAspectPlaybook).mock.calls.some(
        (c) => (c[0] as { stageId: string }).stageId === "world",
      ),
    ).toBe(false);

    const world = d.repo.loadStudioState(bookId).stages.world;
    expect(world?.aspects).toHaveLength(2);
    // Правило «без автора ничего не утверждается» держится и здесь.
    expect(world?.aspects.every((a) => a.status === "reviewing")).toBe(true);
  });

  it("этап с уже заполненными разделами быстрый сбор не трогает и вызова не тратит", async () => {
    const d = deps();
    const state = d.repo.loadStudioState(bookId);
    d.repo.patchStudioState(bookId, {
      expectedRevision: state.revision,
      next: {
        ...state,
        stages: {
          ...state.stages,
          world: {
            status: "in_progress",
            playbookGenerated: true,
            aspects: [
              {
                id: "a1",
                name: "власть",
                status: "accepted",
                order: 0,
                required: false,
                source: "import",
                payloadKind: "markdown",
                variants: [
                  {
                    id: "v1",
                    label: "из материалов",
                    payloadKind: "markdown",
                    payload: "Правит совет.",
                    status: "accepted",
                    editSource: "manual",
                    generatedAt: "2026-09-22T00:00:00.000Z",
                  },
                ],
                selectedVariantId: "v1",
                finalPayload: "Правит совет.",
              },
            ],
          },
        },
      },
    });
    vi.mocked(runAspectDocument).mockClear();

    const result = await runQuickStart(d, { onStage: () => {} });

    const world = d.repo.loadStudioState(bookId).stages.world;
    expect(world?.aspects).toHaveLength(1);
    expect(world?.aspects[0]?.finalPayload).toBe("Правит совет.");
    // Пустых разделов нет, писать нечего — платить за вызов не за что.
    const worldCalls = vi
      .mocked(runAspectDocument)
      .mock.calls.filter((c) => (c[0] as { stageId: string }).stageId === "world");
    expect(worldCalls).toHaveLength(0);
    // Это внешний gate «этап занят», а не решение внутри generateDocumentStage:
    // generateStage для world вовсе не вызывается.
    expect(
      result.stages.some((s) => s.stageId === "world" && s.status === "skipped"),
    ).toBe(true);
  });

  it("раздел с мёртвым выбором (superseded-вариант) считается пустым, а не заполненным — и внешним gate тоже", async () => {
    // Прежний экран при уточнении помечал вариант superseded, не снимая
    // selectedVariantId. Старые разделы мира/лора могут хранить именно такое
    // состояние: выбор указывает на вариант, которого больше нет в счёт.
    // Наивная проверка "есть ли непустой вариант любого статуса" (её несёт и
    // внешний gate «этап занят», и внутренний merge) сочла бы раздел
    // заполненным и не дописала бы его никогда — ни то, ни другое место не
    // должно на это купиться.
    const d = deps();
    const state = d.repo.loadStudioState(bookId);
    d.repo.patchStudioState(bookId, {
      expectedRevision: state.revision,
      next: {
        ...state,
        stages: {
          ...state.stages,
          world: {
            status: "in_progress",
            playbookGenerated: true,
            aspects: [
              {
                id: "a1",
                name: "география",
                status: "reviewing",
                order: 0,
                required: false,
                source: "llm",
                payloadKind: "markdown",
                variants: [
                  {
                    id: "v1",
                    label: "документ",
                    payloadKind: "markdown",
                    payload: "Старый текст, вытесненный уточнением.",
                    status: "superseded",
                    editSource: "llm",
                    generatedAt: "2026-09-01T00:00:00.000Z",
                  },
                ],
                selectedVariantId: "v1",
              },
            ],
          },
        },
      },
    });

    vi.mocked(runAspectDocument).mockResolvedValue({
      sections: [
        {
          name: "география",
          description: "рельеф",
          markdown: "Новый текст географии вместо вытесненного старого.",
        },
      ],
    });

    await runQuickStart(d, { onStage: () => {} });

    const call = vi
      .mocked(runAspectDocument)
      .mock.calls.find((c) => (c[0] as { stageId: string }).stageId === "world");
    const input = call?.[0] as
      | { existingSections: Array<{ name: string }>; emptySectionNames: string[] }
      | undefined;
    expect(input?.emptySectionNames).toContain("география");
    expect(input?.existingSections.some((s) => s.name === "география")).toBe(false);

    const world = d.repo.loadStudioState(bookId).stages.world;
    const geo = world?.aspects.find((a) => a.id === "a1");
    expect(geo?.variants).toHaveLength(2);
    expect(geo?.status).toBe("reviewing");
    // Тем же вызовом заполняется и description, если у раздела его не было —
    // тот же backfill, что делает web-версия слияния.
    expect(geo?.description).toBe("рельеф");
  });

  it("модель, вернувшая один раздел дважды, не удваивает его в состоянии", async () => {
    vi.mocked(runAspectDocument).mockResolvedValue({
      sections: [
        {
          name: "география",
          description: "рельеф",
          markdown: "Первый текст раздела географии.",
        },
        {
          name: "география",
          description: "рельеф (снова)",
          markdown: "Второй текст раздела географии.",
        },
      ],
    });
    const d = deps();
    await runQuickStart(d, { onStage: () => {} });

    const world = d.repo.loadStudioState(bookId).stages.world;
    expect(world?.aspects.filter((a) => a.name === "география")).toHaveLength(1);
  });
});

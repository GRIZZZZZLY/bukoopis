import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/aspects/playbook", () => ({
  runAspectPlaybook: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/variants", async () => {
  const actual = await vi.importActual<
    typeof import("@book-forge/agents/aspects/variants")
  >("@book-forge/agents/aspects/variants");
  return {
    runAspectVariants: vi.fn(),
    toStoredVariants: actual.toStoredVariants,
  };
});
vi.mock("@book-forge/agents/aspects/refine", async () => {
  const actual = await vi.importActual<
    typeof import("@book-forge/agents/aspects/refine")
  >("@book-forge/agents/aspects/refine");
  return {
    runAspectRefine: vi.fn(),
    toStoredRefinedVariant: actual.toStoredRefinedVariant,
  };
});
vi.mock("@book-forge/agents/aspects/entity-variants", async () => {
  const actual = await vi.importActual<
    typeof import("@book-forge/agents/aspects/entity-variants")
  >("@book-forge/agents/aspects/entity-variants");
  return {
    runAspectEntityVariants: vi.fn(),
    toStoredEntityVariants: actual.toStoredEntityVariants,
  };
});

import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import { runAspectEntityVariants } from "@book-forge/agents/aspects/entity-variants";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runAspectPlaybook).mockReset();
  vi.mocked(runAspectEntityVariants).mockReset();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Entity test",
  });
  return r.id;
}

describe("playbook overrides payloadKind for entity stages", () => {
  it("/stages/characters/playbook returns aspects with payloadKind=entity_set", async () => {
    vi.mocked(runAspectPlaybook).mockResolvedValue({
      aspects: [
        { name: "Протагонист", description: "герой", required: true, payloadKind: "markdown" },
        { name: "Антагонист", description: "противник", required: true, payloadKind: "markdown" },
        { name: "Спутники", description: "союзники", required: false, payloadKind: "markdown" },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{ aspects: Array<{ payloadKind: string }> }>(
      t.app,
      `/api/books/${id}/stages/characters/playbook`,
      "POST",
      {},
    );
    expect(r.aspects).toHaveLength(3);
    for (const a of r.aspects) {
      expect(a.payloadKind).toBe("entity_set");
    }
  });

  it("/stages/world/playbook still returns markdown aspects", async () => {
    vi.mocked(runAspectPlaybook).mockResolvedValue({
      aspects: [
        { name: "география", description: "земли", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила", required: true, payloadKind: "markdown" },
        { name: "технологии", description: "уровень", required: false, payloadKind: "markdown" },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{ aspects: Array<{ payloadKind: string }> }>(
      t.app,
      `/api/books/${id}/stages/world/playbook`,
      "POST",
      {},
    );
    for (const a of r.aspects) {
      expect(a.payloadKind).toBe("markdown");
    }
  });
});

describe("/aspects/:aspectId/generate dispatches by payloadKind", () => {
  it("entity_set payloadKind → calls runAspectEntityVariants", async () => {
    vi.mocked(runAspectEntityVariants).mockResolvedValue({
      variants: [
        {
          label: "героические",
          candidates: [
            {
              tempId: "t1",
              kind: "character",
              profile: {
                name: "Айрис",
                role: "protagonist",
                description:
                  "Молодая страж границы, выросшая в горном монастыре среди старых рукописей и мечей.",
              },
            },
          ],
        },
        {
          label: "тёмные",
          candidates: [
            {
              tempId: "t2",
              kind: "character",
              profile: {
                name: "Кеан",
                role: "protagonist",
                description:
                  "Бывший палач, ищущий искупления после пятнадцати лет на службе тирана.",
              },
            },
          ],
        },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{
      variants: Array<{
        payloadKind: string;
        payload: { candidates: Array<{ tempId: string }> };
      }>;
    }>(
      t.app,
      `/api/books/${id}/stages/characters/aspects/asp1/generate`,
      "POST",
      {
        aspect: { id: "asp1", name: "Протагонист", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    expect(r.variants).toHaveLength(2);
    expect(r.variants[0]!.payloadKind).toBe("entity_set");
    expect(r.variants[0]!.payload.candidates[0]!.tempId).toBe("t1");
  });

  it("entity_set on non-entity stage → 400", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/generate`,
      "POST",
      {
        aspect: { id: "asp1", name: "география", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    expect(r.status).toBe(400);
  });
});

describe("/aspects/:aspectId/generate-stream", () => {
  const VARIANTS = {
    variants: [
      {
        label: "полевой набор",
        candidates: [
          {
            tempId: "i1",
            kind: "item" as const,
            profile: {
              name: "Зонд «Игла»",
              type: "инструмент",
              description:
                "Титановый щуп для чтения кристаллической решётки на глубину до метра.",
            },
          },
        ],
      },
      {
        label: "лабораторный набор",
        candidates: [
          {
            tempId: "i2",
            kind: "item" as const,
            profile: {
              name: "Резонатор «Зеркало»",
              type: "прибор",
              description:
                "Читает спектр решётки по обратному рассеянию инфракрасного импульса.",
            },
          },
        ],
      },
    ],
  };

  async function readEvents(
    res: Response,
  ): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
    const text = await res.text();
    return text
      .split("\n\n")
      .filter((frame) => frame.includes("data:"))
      .map((frame) => ({
        event: frame.match(/^event: (.+)$/m)?.[1] ?? "message",
        data: JSON.parse(frame.match(/^data: (.+)$/m)![1]!) as Record<
          string,
          unknown
        >,
      }));
  }

  it("streams progress phases and a final done event with variants", async () => {
    vi.mocked(runAspectEntityVariants).mockImplementation(
      async (_input, options) => {
        options?.onProgress?.({ kind: "attempt", attempt: 1 });
        options?.onProgress?.({ kind: "model_started" });
        options?.onProgress?.({ kind: "model_output", chars: 120 });
        options?.onProgress?.({ kind: "tool_call" });
        options?.onProgress?.({ kind: "validated" });
        return VARIANTS;
      },
    );
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/items/aspects/asp1/generate-stream`,
      "POST",
      {
        aspect: { id: "asp1", name: "Зонды", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    const progress = events.filter((e) => e.event === "progress");
    expect(progress.length).toBeGreaterThan(1);
    // Проценты монотонны и до `done` не достигают 100.
    const pcts = progress.map((e) => e.data.pct as number);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]!).toBeGreaterThanOrEqual(pcts[i - 1]!);
    }
    expect(progress.at(-1)!.data.pct).toBe(100);
    expect(progress.at(-1)!.data.phase).toBe("done");
    expect(progress.some((e) => e.data.phase === "writing")).toBe(true);

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    const variants = done!.data.variants as Array<{
      payloadKind: string;
      payload: { candidates: Array<{ tempId: string }> };
    }>;
    expect(variants).toHaveLength(2);
    expect(variants[0]!.payloadKind).toBe("entity_set");
    expect(variants[0]!.payload.candidates[0]!.tempId).toBe("i1");
  });

  it("rolls the percent back and reports attempt N/max on retry", async () => {
    vi.mocked(runAspectEntityVariants).mockImplementation(
      async (_input, options) => {
        options?.onProgress?.({ kind: "attempt", attempt: 1 });
        options?.onProgress?.({ kind: "model_started" });
        options?.onProgress?.({ kind: "model_output", chars: 400 });
        // Попытка 1 упала по таймауту, p-retry запустил вторую.
        options?.onProgress?.({ kind: "attempt", attempt: 2 });
        options?.onProgress?.({ kind: "model_started" });
        options?.onProgress?.({ kind: "tool_call" });
        return VARIANTS;
      },
    );
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/items/aspects/asp1/generate-stream`,
      "POST",
      {
        aspect: { id: "asp1", name: "Зонды", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    const events = await readEvents(res);
    const progress = events.filter((e) => e.event === "progress");
    const retryFrame = progress.find((e) => e.data.attempt === 2);
    expect(retryFrame).toBeDefined();
    expect(retryFrame!.data.maxAttempts).toBe(4);
    expect(retryFrame!.data.phase).toBe("dispatch");
    const beforeRetry = progress.filter((e) => e.data.attempt === 1).at(-1)!;
    expect(retryFrame!.data.pct as number).toBeLessThan(
      beforeRetry.data.pct as number,
    );
    expect(retryFrame!.data.attemptElapsedMs as number).toBeLessThanOrEqual(
      retryFrame!.data.elapsedMs as number,
    );
    expect(events.some((e) => e.event === "done")).toBe(true);
  });

  it("emits an error event when the agent throws", async () => {
    vi.mocked(runAspectEntityVariants).mockRejectedValue(
      new Error("model did not call submit tool"),
    );
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/items/aspects/asp1/generate-stream`,
      "POST",
      {
        aspect: { id: "asp1", name: "Зонды", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    const events = await readEvents(res);
    const err = events.find((e) => e.event === "error");
    expect(err).toBeDefined();
    expect(err!.data.message).toContain("submit tool");
    expect(events.some((e) => e.event === "done")).toBe(false);
  });

  it("rejects non-entity stages with 400", async () => {
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/generate-stream`,
      "POST",
      {
        aspect: { id: "asp1", name: "география", payloadKind: "entity_set" },
        accumulated: [],
      },
    );
    expect(res.status).toBe(400);
  });
});

describe("/aspects/:aspectId/materialize", () => {
  it("creates character rows for accepted candidates and returns ids", async () => {
    const id = await createBook();
    const r = await sendJson<{
      aspectId: string;
      createdEntityIds: number[];
      candidates: Array<{
        tempId: string;
        decision: string;
        materializedEntityId?: number;
      }>;
    }>(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Протагонист",
        candidates: [
          {
            tempId: "t1",
            decision: "accept",
            profile: {
              name: "Айрис",
              role: "protagonist",
              description: "Молодая страж границы.",
            },
          },
          {
            tempId: "t2",
            decision: "reject",
            profile: { name: "Кеан", role: "protagonist", description: "skipped" },
          },
        ],
      },
    );
    expect(r.createdEntityIds).toHaveLength(1);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]!.materializedEntityId).toBeDefined();
    expect(r.candidates[1]!.materializedEntityId).toBeUndefined();
  });

  it("creates item rows on items stageId", async () => {
    const id = await createBook();
    const r = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "items",
        aspectName: "Артефакты",
        candidates: [
          {
            tempId: "t1",
            decision: "accept",
            profile: {
              name: "Меч Заката",
              type: "оружие",
              description: "Древний клинок.",
            },
          },
        ],
      },
    );
    expect(r.createdEntityIds).toHaveLength(1);
  });

  it("returns 404 for unknown book", async () => {
    const r = await send(
      t.app,
      `/api/books/9999/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "x",
        candidates: [
          {
            tempId: "t1",
            decision: "accept",
            profile: {
              name: "x",
              description:
                "Достаточно длинное описание чтобы пройти валидацию.",
            },
          },
        ],
      },
    );
    expect(r.status).toBe(404);
  });

  it("returns 400 for invalid stageId", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "world",
        aspectName: "x",
        candidates: [
          { tempId: "t1", decision: "accept", profile: { name: "x" } },
        ],
      },
    );
    expect(r.status).toBe(400);
  });

  it("replays an identical retry instead of duplicating entities (ADR 0002, Step 7)", async () => {
    const id = await createBook();
    const body = {
      stageId: "characters",
      aspectName: "Протагонист",
      candidates: [
        {
          tempId: "t1",
          decision: "accept",
          profile: {
            name: "Айрис",
            role: "protagonist",
            description: "Молодая страж границы.",
          },
        },
      ],
    };
    const first = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      body,
    );
    // Network retry: byte-identical request → same response, no new rows.
    const second = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      body,
    );
    expect(second.createdEntityIds).toEqual(first.createdEntityIds);
    const chars = await sendJson<unknown[]>(
      t.app,
      `/api/books/${id}/characters`,
      "GET",
    );
    expect(chars).toHaveLength(1);
  });

  it("a different candidate set for the same aspect materializes fresh entities", async () => {
    const id = await createBook();
    const mk = (tempId: string, name: string) => ({
      stageId: "characters",
      aspectName: "Протагонист",
      candidates: [
        {
          tempId,
          decision: "accept",
          profile: { name, role: "protagonist", description: "Описание героя." },
        },
      ],
    });
    await sendJson(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      mk("t1", "Айрис"),
    );
    const second = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${id}/aspects/asp1/materialize`,
      "POST",
      mk("t2", "Кеан"),
    );
    expect(second.createdEntityIds).toHaveLength(1);
    const chars = await sendJson<unknown[]>(
      t.app,
      `/api/books/${id}/characters`,
      "GET",
    );
    expect(chars).toHaveLength(2);
  });
});

describe("AC-35: материализация с ревизией и профилем", () => {
  it("AC-35: role/age/background переживают материализацию и читаются через API", async () => {
    const bookId = await createBook();
    const res = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${bookId}/aspects/asp1/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Протагонист",
        candidates: [
          {
            tempId: "c1",
            decision: "accept",
            profile: {
              name: "Рин Даре",
              role: "протагонист",
              age: "34",
              description: "Старший инженер смены, держит вахту на себе.",
              background: "Выросла на орбитальной верфи.",
            },
          },
        ],
      },
    );
    const id = res.createdEntityIds[0]!;
    const c = await sendJson<{ profile: Record<string, unknown>; revision: number }>(
      t.app,
      `/api/characters/${id}`,
      "GET",
    );
    expect(c.profile.role).toBe("протагонист");
    expect(c.profile.age).toBe("34");
    expect(c.profile.background).toBe("Выросла на орбитальной верфи.");
    expect(c.profile.schemaVersion).toBe(2);
  });

  it("AC-35: повторная материализация не создаёт дубликат", async () => {
    const bookId = await createBook();
    const first = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${bookId}/aspects/asp2/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Протагонист",
        candidates: [
          {
            tempId: "c1",
            decision: "accept",
            profile: { name: "Рин", description: "Инженер смены на станции." },
          },
        ],
      },
    );
    const id = first.createdEntityIds[0]!;

    // Тот же раздел, другой набор tempId — это НЕ повтор запроса, поэтому
    // ключ идемпотентности не срабатывает и путь идёт до апдейта.
    await sendJson(
      t.app,
      `/api/books/${bookId}/aspects/asp2/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Протагонист",
        candidates: [
          {
            tempId: "c1",
            decision: "accept",
            materializedEntityId: id,
            profile: { name: "Рин Даре", description: "Старший инженер смены." },
          },
          {
            tempId: "c2",
            decision: "accept",
            profile: { name: "Сарек", description: "Навигатор дальнего хода." },
          },
        ],
      },
    );

    const all = await sendJson<Array<{ id: number; canonicalName: string; revision: number }>>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(all).toHaveLength(2);
    const rin = all.find((c) => c.id === id);
    expect(rin?.canonicalName).toBe("Рин Даре");
    expect(rin?.revision).toBe(1);
  });

  it("AC-30: mergedIntoId из другой книги отклоняется", async () => {
    const bookId = await createBook();
    const other = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
      title: "Чужая",
    });
    const alien = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${other.id}/characters`,
      "POST",
      { canonicalName: "Чужой", profile: { description: "X" } },
    );
    const r = await send(t.app, `/api/books/${bookId}/aspects/asp3/materialize`, "POST", {
      stageId: "characters",
      aspectName: "Протагонист",
      candidates: [
        {
          tempId: "c9",
          decision: "accept",
          mergedIntoId: alien.id,
          profile: { name: "Ч" },
        },
      ],
    });
    expect(r.status).toBe(400);
    const chars = await sendJson<unknown[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(chars).toHaveLength(0);
  });

  it("идемпотентность: один и тот же запрос возвращает тот же ответ без дублей", async () => {
    const bookId = await createBook();
    const body = {
      stageId: "characters" as const,
      aspectName: "Протагонист",
      candidates: [
        {
          tempId: "c1",
          decision: "accept" as const,
          profile: { name: "Айрис", description: "Герой" },
        },
      ],
    };
    const first = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${bookId}/aspects/asp4/materialize`,
      "POST",
      body,
    );
    const second = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${bookId}/aspects/asp4/materialize`,
      "POST",
      body,
    );
    expect(second.createdEntityIds).toEqual(first.createdEntityIds);
    const chars = await sendJson<unknown[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(chars).toHaveLength(1);
  });

  it("отредактированный профиль одного tempId обновляет строку и не создаёт дубликат", async () => {
    const bookId = await createBook();
    const first = await sendJson<{ createdEntityIds: number[] }>(
      t.app,
      `/api/books/${bookId}/aspects/asp5/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Протагонист",
        candidates: [
          {
            tempId: "c1",
            decision: "accept",
            profile: { name: "Айрис", role: "главная", description: "Герой" },
          },
        ],
      },
    );
    const id = first.createdEntityIds[0]!;

    // Автор отредактировал имя — одинаковые tempId, но разный профиль.
    // requestKey теперь включает профиль, поэтому это новый запрос и идёт в апдейт.
    await sendJson(
      t.app,
      `/api/books/${bookId}/aspects/asp5/materialize`,
      "POST",
      {
        stageId: "characters",
        aspectName: "Протагонист",
        candidates: [
          {
            tempId: "c1",
            decision: "accept",
            materializedEntityId: id,
            profile: { name: "Айрис Хэйр", role: "главная", description: "Герой" },
          },
        ],
      },
    );

    const updated = await sendJson<{ canonicalName: string; revision: number }>(
      t.app,
      `/api/characters/${id}`,
      "GET",
    );
    expect(updated.canonicalName).toBe("Айрис Хэйр");
    expect(updated.revision).toBe(1);

    const all = await sendJson<unknown[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(all).toHaveLength(1);
  });
});

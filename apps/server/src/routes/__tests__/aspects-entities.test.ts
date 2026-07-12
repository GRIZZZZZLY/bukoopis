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

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

import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import { runAspectVariants } from "@book-forge/agents/aspects/variants";
import { runAspectRefine } from "@book-forge/agents/aspects/refine";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;

beforeEach(() => {
  t = makeTestApp();
  vi.mocked(runAspectPlaybook).mockReset();
  vi.mocked(runAspectVariants).mockReset();
  vi.mocked(runAspectRefine).mockReset();
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Aspects test",
  });
  return r.id;
}

describe("POST /api/books/:id/stages/:stageId/playbook", () => {
  it("returns 404 for unknown book", async () => {
    const r = await send(
      t.app,
      "/api/books/9999/stages/world/playbook",
      "POST",
      {},
    );
    expect(r.status).toBe(404);
  });

  it("returns 400 for invalid stageId", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/wrong/playbook`,
      "POST",
      {},
    );
    expect(r.status).toBe(400);
  });

  it("returns aspects + contextRef on success", async () => {
    vi.mocked(runAspectPlaybook).mockResolvedValue({
      aspects: [
        { name: "география", description: "земли и воды", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила колдовства", required: true, payloadKind: "markdown" },
        { name: "технологии", description: "уровень развития", required: false, payloadKind: "markdown" },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{
      aspects: Array<{ name: string }>;
      contextRef: { hash: string };
    }>(t.app, `/api/books/${id}/stages/world/playbook`, "POST", {
      existingAspectNames: ["климат"],
    });
    expect(r.aspects).toHaveLength(3);
    expect(r.contextRef.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(runAspectPlaybook).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(runAspectPlaybook).mock.calls[0]![0];
    expect(arg.stageId).toBe("world");
    expect(arg.existingAspectNames).toEqual(["климат"]);
  });

  it("returns 500 on agent failure", async () => {
    vi.mocked(runAspectPlaybook).mockRejectedValue(new Error("LLM down"));
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/playbook`,
      "POST",
      {},
    );
    expect(r.status).toBe(500);
  });
});

describe("POST /api/books/:id/stages/:stageId/aspects/:aspectId/generate", () => {
  it("returns variants + contextRef on success", async () => {
    vi.mocked(runAspectVariants).mockResolvedValue({
      variants: [
        { label: "морской", payload: "Островная цепь, торговые ветры. " + "x".repeat(20) },
        { label: "горный", payload: "Снежные пики, узкие перевалы. " + "y".repeat(20) },
      ],
    });
    const id = await createBook();
    const r = await sendJson<{
      variants: Array<{ id: string; payload: string }>;
      contextRef: { hash: string };
    }>(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/generate`,
      "POST",
      {
        aspect: { id: "asp1", name: "география", description: "земли и воды" },
        accumulated: [{ id: "prev", name: "климат", finalPayload: "Тёплый муссон" }],
      },
    );
    expect(r.variants).toHaveLength(2);
    expect(r.variants[0]!.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.contextRef.hash).toMatch(/^[0-9a-f]{64}$/);
    const arg = vi.mocked(runAspectVariants).mock.calls[0]![0];
    expect(arg.aspect.name).toBe("география");
    expect(arg.accumulated[0]!.name).toBe("климат");
  });

  it("returns 400 for missing aspect body", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/x/generate`,
      "POST",
      {},
    );
    expect(r.status).toBe(400);
  });
});

describe("POST /api/books/:id/stages/:stageId/aspects/:aspectId/refine", () => {
  it("returns refined variant with parentVariantId", async () => {
    vi.mocked(runAspectRefine).mockResolvedValue({
      variant: { label: "темнее", payload: "Серые острова, постоянные шторма. " + "z".repeat(20) },
    });
    const id = await createBook();
    const r = await sendJson<{
      variant: { id: string; parentVariantId: string };
      contextRef: { hash: string };
    }>(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/refine`,
      "POST",
      {
        aspect: { id: "asp1", name: "география" },
        parentVariant: { id: "v1", label: "морской", payload: "old payload " + "p".repeat(20) },
        instructions: "сделай мрачнее",
        accumulated: [],
      },
    );
    expect(r.variant.parentVariantId).toBe("v1");
    expect(r.variant.id).toMatch(/[0-9a-f-]{36}/);
    expect(r.contextRef.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 400 for missing instructions", async () => {
    const id = await createBook();
    const r = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/refine`,
      "POST",
      {
        aspect: { id: "asp1", name: "география" },
        parentVariant: { id: "v1", label: "x", payload: "y payload " + "p".repeat(20) },
        accumulated: [],
      },
    );
    expect(r.status).toBe(400);
  });
});

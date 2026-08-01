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
    title: "Markdown stream test",
  });
  return r.id;
}

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

/** Прогоняет вехи диспетчера, как это делает subscription-бэкенд. */
function emitAllPhases(options?: {
  onProgress?: (e: {
    kind: string;
    attempt?: number;
    chars?: number;
  }) => void;
}): void {
  options?.onProgress?.({ kind: "attempt", attempt: 1 });
  options?.onProgress?.({ kind: "model_started" });
  options?.onProgress?.({ kind: "model_output", chars: 500 });
  options?.onProgress?.({ kind: "tool_call" });
  options?.onProgress?.({ kind: "validated" });
}

describe("markdown /generate-stream (world/lore)", () => {
  it("streams phases and returns markdown variants in done", async () => {
    vi.mocked(runAspectVariants).mockImplementation(async (_input, options) => {
      emitAllPhases(options as never);
      return {
        variants: [
          { label: "суровая", payload: "Соляные дюны тянутся на тысячи лиг." },
          { label: "мягкая", payload: "Дюны дышат солью и старым светом." },
        ],
      };
    });
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/generate-stream`,
      "POST",
      { aspect: { id: "asp1", name: "география" }, accumulated: [] },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(res);
    const progress = events.filter((e) => e.event === "progress");
    expect(progress.some((e) => e.data.phase === "writing")).toBe(true);
    expect(progress.at(-1)!.data.pct).toBe(100);

    const done = events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    const variants = done!.data.variants as Array<{
      payloadKind: string;
      payload: string;
    }>;
    expect(variants).toHaveLength(2);
    expect(variants[0]!.payloadKind).toBe("markdown");
    expect(variants[0]!.payload).toContain("Соляные дюны");
  });

  it("passes the draft through to the agent", async () => {
    vi.mocked(runAspectVariants).mockResolvedValue({
      variants: [
        { label: "a", payload: "x".repeat(30) },
        { label: "b", payload: "y".repeat(30) },
      ],
    });
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/lore/aspects/asp1/generate-stream`,
      "POST",
      {
        aspect: { id: "asp1", name: "мифы" },
        accumulated: [],
        draft: "начни с потопа",
      },
    );
    // Тело SSE ленивое: без чтения поток не запускается и агент не вызывается.
    await readEvents(res);
    expect(vi.mocked(runAspectVariants).mock.calls[0]![0]!.draft).toBe(
      "начни с потопа",
    );
  });

  it("emits an error event when the agent throws", async () => {
    vi.mocked(runAspectVariants).mockRejectedValue(new Error("schema mismatch"));
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/generate-stream`,
      "POST",
      { aspect: { id: "asp1", name: "география" }, accumulated: [] },
    );
    const events = await readEvents(res);
    const err = events.find((e) => e.event === "error");
    expect(err!.data.error).toBe("aspect_variants_failed");
    expect(err!.data.message).toContain("schema mismatch");
    expect(events.some((e) => e.event === "done")).toBe(false);
  });
});

describe("/refine-stream", () => {
  it("streams phases and returns the refined variant", async () => {
    vi.mocked(runAspectRefine).mockImplementation(async (_input, options) => {
      emitAllPhases(options as never);
      return {
        variant: { label: "мрачнее", payload: "Дюны молчат, и соль скрипит." },
      };
    });
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/world/aspects/asp1/refine-stream`,
      "POST",
      {
        aspect: { id: "asp1", name: "география" },
        parentVariant: { id: "v1", label: "исходный", payload: "Дюны." },
        instructions: "сделай мрачнее",
        accumulated: [],
      },
    );
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    const done = events.find((e) => e.event === "done");
    const variant = done!.data.variant as {
      payloadKind: string;
      parentVariantId: string;
      payload: string;
    };
    expect(variant.payloadKind).toBe("markdown");
    expect(variant.parentVariantId).toBe("v1");
    expect(variant.payload).toContain("соль скрипит");
  });
});

describe("/playbook-stream", () => {
  const ASPECTS = {
    aspects: [
      {
        name: "география",
        description: "земли",
        required: true,
        payloadKind: "markdown" as const,
      },
      {
        name: "магия",
        description: "правила",
        required: true,
        payloadKind: "markdown" as const,
      },
    ],
  };

  it("streams phases and returns markdown aspects for world", async () => {
    vi.mocked(runAspectPlaybook).mockImplementation(async (_input, options) => {
      emitAllPhases(options as never);
      return ASPECTS;
    });
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/world/playbook-stream`,
      "POST",
      {},
    );
    const events = await readEvents(res);
    const progress = events.filter((e) => e.event === "progress");
    // У плейбука своя оценка длительности — короче, чем у вариантов.
    expect(progress[0]!.data.estimateMs).toBe(40_000);
    const done = events.find((e) => e.event === "done");
    const aspects = done!.data.aspects as Array<{ payloadKind: string }>;
    expect(aspects).toHaveLength(2);
    expect(aspects.every((a) => a.payloadKind === "markdown")).toBe(true);
  });

  it("overrides payloadKind to entity_set for entity stages", async () => {
    vi.mocked(runAspectPlaybook).mockResolvedValue(ASPECTS);
    const id = await createBook();
    const res = await send(
      t.app,
      `/api/books/${id}/stages/characters/playbook-stream`,
      "POST",
      { existingAspectNames: ["Протагонист"] },
    );
    const events = await readEvents(res);
    const done = events.find((e) => e.event === "done");
    const aspects = done!.data.aspects as Array<{ payloadKind: string }>;
    expect(aspects.every((a) => a.payloadKind === "entity_set")).toBe(true);
    expect(
      vi.mocked(runAspectPlaybook).mock.calls[0]![0]!.existingAspectNames,
    ).toEqual(["Протагонист"]);
  });
});

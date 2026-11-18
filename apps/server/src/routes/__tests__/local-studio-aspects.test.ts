import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  playbook: vi.fn(),
  variants: vi.fn(),
  entity: vi.fn(),
  refine: vi.fn(),
}));
vi.mock("@book-forge/agents/aspects/playbook", () => ({
  runAspectPlaybook: (...a: unknown[]) => m.playbook(...a),
}));
vi.mock("@book-forge/agents/aspects/variants", () => ({
  runAspectVariants: (...a: unknown[]) => m.variants(...a),
  toStoredVariants: (_r: unknown, o: { modelId: string }) => [{ modelId: o.modelId }],
}));
vi.mock("@book-forge/agents/aspects/entity-variants", () => ({
  runAspectEntityVariants: (...a: unknown[]) => m.entity(...a),
  toStoredEntityVariants: (_r: unknown, o: { modelId: string }) => [{ modelId: o.modelId }],
}));
vi.mock("@book-forge/agents/aspects/refine", () => ({
  runAspectRefine: (...a: unknown[]) => m.refine(...a),
  toStoredRefinedVariant: (_r: unknown, o: { modelId: string }) => ({ modelId: o.modelId }),
}));

import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;
let bookId: number;

const aspect = { id: "a1", name: "Раздел" };
const generateBody = { aspect, accumulated: [] };
const entityBody = { aspect: { ...aspect, payloadKind: "entity_set" }, accumulated: [] };
const refineBody = {
  aspect,
  parentVariant: { id: "v1", label: "A", payload: "text" },
  instructions: "короче",
  accumulated: [],
};

const setLocal = (): void => {
  t.sqlite
    .prepare("UPDATE books SET studio_provider = 'ollama', studio_local_model = 'qwen:9b' WHERE id = ?")
    .run(bookId);
};

beforeEach(async () => {
  t = makeTestApp();
  for (const f of Object.values(m)) f.mockReset();
  m.playbook.mockResolvedValue({ aspects: [] });
  m.variants.mockResolvedValue({});
  m.entity.mockResolvedValue({});
  m.refine.mockResolvedValue({});
  const r = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Local aspects" });
  bookId = r.id;
});
afterEach(() => {
  t.cleanup();
});

describe("маршруты аспектов: переключатель локальной модели", () => {
  it("playbook, variants, entity-variants и refine передают local на локальной книге", async () => {
    setLocal();
    const base = `/api/books/${bookId}/stages`;
    await send(t.app, `${base}/world/playbook`, "POST", {});
    await send(t.app, `${base}/world/aspects/a1/generate`, "POST", generateBody);
    await send(t.app, `${base}/characters/aspects/a1/generate`, "POST", entityBody);
    await send(t.app, `${base}/world/aspects/a1/refine`, "POST", refineBody);
    for (const f of [m.playbook, m.variants, m.entity, m.refine]) {
      expect(f).toHaveBeenCalledTimes(1);
      expect(f.mock.calls[0]?.[1]).toMatchObject({ local: { model: "qwen:9b" } });
    }
  });

  it("вариант на локальной книге подписан ollama:<тег>, на обычной — прежней меткой", async () => {
    setLocal();
    const url = `/api/books/${bookId}/stages/world/aspects/a1/generate`;
    const local = (await (await send(t.app, url, "POST", generateBody)).json()) as {
      variants: Array<{ modelId: string }>;
    };
    expect(local.variants[0]?.modelId).toBe("ollama:qwen:9b");

    t.sqlite.prepare("UPDATE books SET studio_provider = 'anthropic' WHERE id = ?").run(bookId);
    const plain = (await (await send(t.app, url, "POST", generateBody)).json()) as {
      variants: Array<{ modelId: string }>;
    };
    expect(plain.variants[0]?.modelId).not.toContain("ollama:");
    expect(m.variants.mock.calls[1]?.[1]).not.toHaveProperty("local");
  });

  it("ollama без названия модели: понятная ошибка, Claude не вызывается", async () => {
    t.sqlite
      .prepare("UPDATE books SET studio_provider = 'ollama', studio_local_model = NULL WHERE id = ?")
      .run(bookId);
    const res = await send(t.app, `/api/books/${bookId}/stages/world/playbook`, "POST", {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { details: { message: string } };
    expect(body.details.message).toContain("название модели не задано");
    expect(m.playbook).not.toHaveBeenCalled();
  });
});

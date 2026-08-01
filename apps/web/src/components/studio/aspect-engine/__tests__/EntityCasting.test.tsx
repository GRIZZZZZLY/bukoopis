import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { EntityStageRunner } from "../EntityStageRunner";

function candidate(tempId: string, name: string, description = "") {
  return {
    tempId,
    kind: "character" as const,
    profile: { name, description },
    status: "proposed" as const,
  };
}

/** Two variants, the first one picked: the shape the author lands in after
 *  choosing a cast but before committing it to the canon. */
function makeAspect(): StageAspect {
  return {
    id: "asp1",
    name: "Протагонист",
    status: "reviewing",
    order: 0,
    required: true,
    source: "llm",
    payloadKind: "entity_set",
    selectedVariantId: "v1",
    variants: [
      {
        id: "v1",
        label: "первый",
        payloadKind: "entity_set",
        payload: { candidates: [candidate("t1", "Мира", "картограф")] },
        status: "generated",
        editSource: "llm",
        generatedAt: "2026-05-09T20:00:00.000Z",
      },
      {
        id: "v2",
        label: "второй",
        payloadKind: "entity_set",
        payload: { candidates: [candidate("t1", "Гарм", "боцман")] },
        status: "generated",
        editSource: "llm",
        generatedAt: "2026-05-09T20:00:00.000Z",
      },
    ],
  };
}

function makeStage(aspects: StageAspect[]): StageState {
  return { status: "in_progress", playbookGenerated: true, aspects };
}

const materialize = vi.fn();
const generator = { generate: vi.fn() };

beforeEach(() => {
  materialize.mockReset();
  generator.generate.mockReset();
  materialize.mockResolvedValue({
    aspectId: "asp1",
    createdEntityIds: [1],
    candidates: [{ tempId: "t1", decision: "accept", materializedEntityId: 1 }],
  });
});

function renderRunner(onPatch = vi.fn().mockResolvedValue({ revision: 2 })) {
  render(
    <EntityStageRunner
      stage={makeStage([makeAspect()])}
      revision={1}
      stageId="characters"
      generator={generator as never}
      onPatch={onPatch}
      onMaterialize={materialize}
    />,
  );
  return onPatch;
}

describe("editing a candidate before it reaches the canon", () => {
  it("sends the author's corrected name, not the generated one", async () => {
    renderRunner();
    const nameBox = screen.getByLabelText(/Имя Мира/);
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, "Мирра");
    await userEvent.click(
      screen.getByRole("button", { name: /Добавить в канон книги/ }),
    );
    await waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
    const body = materialize.mock.calls[0]![1] as {
      candidates: Array<{ profile: { name: string } }>;
    };
    expect(body.candidates[0]!.profile.name).toBe("Мирра");
  });

  it("keeps the rest of the profile when only the description changes", async () => {
    renderRunner();
    const descBox = screen.getByLabelText(/Описание Мира/);
    await userEvent.clear(descBox);
    await userEvent.type(descBox, "картограф, боится воды");
    await userEvent.click(
      screen.getByRole("button", { name: /Добавить в канон книги/ }),
    );
    await waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
    const body = materialize.mock.calls[0]![1] as {
      candidates: Array<{ profile: { name: string; description: string } }>;
    };
    expect(body.candidates[0]!.profile).toEqual({
      name: "Мира",
      description: "картограф, боится воды",
    });
  });
});

describe("mixing candidates across variants", () => {
  it("pulls one person out of the variant that was not picked", async () => {
    renderRunner();
    await userEvent.click(
      screen.getByRole("button", { name: /Взять из другого варианта/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /\+ Гарм/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Добавить в канон книги/ }),
    );
    await waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
    const body = materialize.mock.calls[0]![1] as {
      candidates: Array<{ tempId: string; profile: { name: string } }>;
    };
    expect(body.candidates.map((c) => c.profile.name)).toEqual([
      "Мира",
      "Гарм",
    ]);
    // Both variants numbered their first candidate "t1" — the collision has to
    // be resolved or the server would overwrite one with the other.
    expect(new Set(body.candidates.map((c) => c.tempId)).size).toBe(2);
  });

  it("offers nothing to borrow when there is only one variant", () => {
    const solo = makeAspect();
    solo.variants = [solo.variants[0]!];
    render(
      <EntityStageRunner
        stage={makeStage([solo])}
        revision={1}
        stageId="characters"
        generator={generator as never}
        onPatch={vi.fn()}
        onMaterialize={materialize}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Взять из другого варианта/ }),
    ).toBeNull();
  });
});

describe("going back to the variant list", () => {
  it("clears the pick instead of stranding the author on it", async () => {
    const onPatch = renderRunner();
    await userEvent.click(
      screen.getByRole("button", { name: /Назад к вариантам/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const patched = onPatch.mock.calls[0]![1] as StageState;
    const aspect = patched.aspects[0]!;
    expect(aspect.selectedVariantId).toBeUndefined();
    expect(aspect.variants).toHaveLength(2);
    expect(aspect.status).toBe("reviewing");
  });
});

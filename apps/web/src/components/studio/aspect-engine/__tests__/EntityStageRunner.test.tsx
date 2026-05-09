import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { EntityStageRunner } from "../EntityStageRunner";

function makeAspect(partial?: Partial<StageAspect>): StageAspect {
  return {
    id: "asp1",
    name: "Протагонист",
    status: "pending",
    order: 0,
    required: true,
    source: "llm",
    payloadKind: "entity_set",
    variants: [],
    ...partial,
  };
}

function makeStage(aspects: StageAspect[]): StageState {
  return {
    status: "in_progress",
    playbookGenerated: true,
    aspects,
  };
}

const generator = {
  generate: vi.fn(),
};

const materialize = vi.fn();

beforeEach(() => {
  generator.generate.mockReset();
  materialize.mockReset();
});

describe("EntityStageRunner", () => {
  it("pending aspect shows Generate button", () => {
    render(
      <EntityStageRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        stageId="characters"
        generator={generator as never}
        onPatch={vi.fn()}
        onMaterialize={materialize}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    ).toBeInTheDocument();
  });

  it("clicking Принять on variant enters review-entities mode", async () => {
    const reviewing = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "героические",
          payloadKind: "entity_set",
          payload: {
            candidates: [
              {
                tempId: "t1",
                kind: "character",
                profile: {
                  name: "Айрис",
                  role: "protagonist",
                  description: "x",
                },
                status: "proposed",
              },
              {
                tempId: "t2",
                kind: "character",
                profile: {
                  name: "Кеан",
                  role: "protagonist",
                  description: "y",
                },
                status: "proposed",
              },
            ],
          },
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <EntityStageRunner
        stage={makeStage([reviewing])}
        revision={0}
        stageId="characters"
        generator={generator as never}
        onPatch={onPatch}
        onMaterialize={materialize}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Принять/ }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.selectedVariantId).toBe("v1");
    expect(next.aspects[0]!.status).toBe("reviewing");
  });

  it("Materialize calls onMaterialize and patches aspect to accepted", async () => {
    const reviewing = makeAspect({
      status: "reviewing",
      selectedVariantId: "v1",
      variants: [
        {
          id: "v1",
          label: "героические",
          payloadKind: "entity_set",
          payload: {
            candidates: [
              {
                tempId: "t1",
                kind: "character",
                profile: {
                  name: "Айрис",
                  role: "protagonist",
                  description: "x",
                },
                status: "proposed",
              },
            ],
          },
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-10T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    materialize.mockResolvedValue({
      aspectId: "asp1",
      createdEntityIds: [42],
      candidates: [
        { tempId: "t1", decision: "accept", materializedEntityId: 42 },
      ],
    });
    render(
      <EntityStageRunner
        stage={makeStage([reviewing])}
        revision={0}
        stageId="characters"
        generator={generator as never}
        onPatch={onPatch}
        onMaterialize={materialize}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Материализовать/ }),
    );
    await waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.status).toBe("accepted");
    expect(next.aspects[0]!.emits?.entityIds).toEqual([42]);
  });
});

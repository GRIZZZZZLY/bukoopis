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

  it("shows a progress bar with phase and percent while generating", async () => {
    let release: (() => void) | undefined;
    generator.generate.mockImplementation(
      (_input: unknown, onProgress?: (p: unknown) => void) => {
        onProgress?.({
          phase: "writing",
          pct: 42,
          attempt: 1,
          maxAttempts: 4,
          elapsedMs: 31_000,
          attemptElapsedMs: 31_000,
          attemptTimeoutMs: 180_000,
          estimateMs: 75_000,
        });
        return new Promise((resolve) => {
          release = () => resolve([]);
        });
      },
    );
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <EntityStageRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        stageId="items"
        generator={generator as never}
        onPatch={onPatch}
        onMaterialize={materialize}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText(/Модель пишет ответ/)).toBeInTheDocument();
    expect(screen.getByText(/42% · 31 c/)).toBeInTheDocument();

    release?.();
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
    );
  });

  it("labels a retry with attempt number, per-attempt time and total", async () => {
    generator.generate.mockImplementation(
      (_input: unknown, onProgress?: (p: unknown) => void) => {
        onProgress?.({
          phase: "dispatch",
          pct: 8,
          attempt: 2,
          maxAttempts: 4,
          elapsedMs: 190_000,
          attemptElapsedMs: 4_000,
          attemptTimeoutMs: 180_000,
          estimateMs: 75_000,
        });
        return new Promise(() => {});
      },
    );
    render(
      <EntityStageRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        stageId="items"
        generator={generator as never}
        onPatch={vi.fn()}
        onMaterialize={materialize}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    expect(await screen.findByText(/попытка 2\/4/)).toBeInTheDocument();
    expect(screen.getByText(/8% · 4 c \(всего 190 c\)/)).toBeInTheDocument();
    expect(screen.getByText(/таймаут попытки 180 c/)).toBeInTheDocument();
    expect(
      screen.getByText(/Предыдущая попытка не уложилась в таймаут/),
    ).toBeInTheDocument();
  });

  it("marks the aspect payloadKind as entity_set when generating", async () => {
    generator.generate.mockResolvedValue([]);
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <EntityStageRunner
        stage={makeStage([makeAspect({ payloadKind: "markdown" })])}
        revision={0}
        stageId="items"
        generator={generator as never}
        onPatch={onPatch}
        onMaterialize={materialize}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.payloadKind).toBe("entity_set");
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
      screen.getByRole("button", { name: /Добавить в канон/ }),
    );
    await waitFor(() => expect(materialize).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.status).toBe("accepted");
    expect(next.aspects[0]!.emits?.entityIds).toEqual([42]);
  });
});

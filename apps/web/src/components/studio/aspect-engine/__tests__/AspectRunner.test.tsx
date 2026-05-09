import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { AspectRunner } from "../AspectRunner";
import { createMarkdownAdapter } from "../markdownAdapter";
import { createMockMarkdownGenerator } from "../mockGenerator";

const adapter = createMarkdownAdapter("world");
const generator = createMockMarkdownGenerator();
const generateSpy = vi.spyOn(generator, "generate");

function makeAspect(partial?: Partial<StageAspect>): StageAspect {
  return {
    id: "a1",
    name: "география",
    status: "pending",
    order: 0,
    required: true,
    source: "system",
    payloadKind: "markdown",
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

beforeEach(() => {
  generateSpy.mockClear();
});

describe("AspectRunner", () => {
  it("shows empty state when stage has no aspects", () => {
    render(
      <AspectRunner
        stage={makeStage([])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.getByText(/нет аспектов/i)).toBeInTheDocument();
  });

  it("pending aspect shows Generate + Skip buttons", () => {
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Пропустить/ }),
    ).toBeInTheDocument();
  });

  it("clicking Generate calls generator and patches with reviewing+variants", async () => {
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={3}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(generateSpy).toHaveBeenCalledTimes(1);
    const [rev, next] = onPatch.mock.calls[0]!;
    expect(rev).toBe(3);
    expect(next.aspects[0]!.status).toBe("reviewing");
    expect(next.aspects[0]!.variants).toHaveLength(2);
  });

  it("clicking Принять on a reviewing aspect patches with accepted+finalPayload", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Variant payload one",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
        {
          id: "v2",
          label: "второй",
          payloadKind: "markdown",
          payload: "Variant payload two",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    const acceptButtons = screen.getAllByRole("button", { name: /Принять/ });
    await userEvent.click(acceptButtons[0]!);
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects[0]!.status).toBe("accepted");
    expect(next.aspects[0]!.selectedVariantId).toBe("v1");
    expect(next.aspects[0]!.finalPayload).toBe("Variant payload one");
    expect(next.aspects[0]!.variants[0]!.status).toBe("accepted");
  });

  it("clicking Skip on pending patches with status=skipped", async () => {
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Пропустить/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch.mock.calls[0]![1].aspects[0]!.status).toBe("skipped");
  });

  it("accepted aspect renders renderFinal and Edit/Delete buttons", () => {
    const acceptedAspect = makeAspect({
      status: "accepted",
      selectedVariantId: "v1",
      finalPayload: "Окончательный текст об острове",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "Окончательный текст об острове",
          status: "accepted",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    render(
      <AspectRunner
        stage={makeStage([acceptedAspect])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Окончательный текст об острове/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Изменить/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Удалить/ })).toBeInTheDocument();
  });

  it("Перегенерировать calls generator a second time", async () => {
    const reviewingAspect = makeAspect({
      status: "reviewing",
      variants: [
        {
          id: "v1",
          label: "первый",
          payloadKind: "markdown",
          payload: "p1",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
        {
          id: "v2",
          label: "второй",
          payloadKind: "markdown",
          payload: "p2",
          status: "generated",
          editSource: "llm",
          generatedAt: "2026-05-09T20:00:00.000Z",
        },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <AspectRunner
        stage={makeStage([reviewingAspect])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Перегенерировать/ }),
    );
    await waitFor(() => expect(generateSpy).toHaveBeenCalled());
  });

  it("error from onPatch shows inline alert", async () => {
    const onPatch = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={0}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
  });
});

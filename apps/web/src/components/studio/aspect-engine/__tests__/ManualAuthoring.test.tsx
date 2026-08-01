import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { AspectRunner } from "../AspectRunner";
import { createMarkdownAdapter } from "../markdownAdapter";
import { createMockMarkdownGenerator } from "../mockGenerator";

const adapter = createMarkdownAdapter("world");

function makeAspect(partial?: Partial<StageAspect>): StageAspect {
  return {
    id: "a1",
    name: "география",
    status: "pending",
    order: 0,
    required: true,
    source: "llm",
    payloadKind: "markdown",
    variants: [],
    ...partial,
  };
}

function makeStage(aspects: StageAspect[]): StageState {
  return { status: "in_progress", playbookGenerated: true, aspects };
}

function okPatch() {
  return vi.fn().mockResolvedValue({ stage: makeStage([]), revision: 2 });
}

describe("author's own starting text", () => {
  it("hands the seed to the generator", async () => {
    const generator = createMockMarkdownGenerator();
    const spy = vi.spyOn(generator, "generate");
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={okPatch()}
      />,
    );
    await userEvent.type(
      screen.getByLabelText(/Свой черновик для/),
      "Острова тонут по одному",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![0].draft).toBe("Острова тонут по одному");
  });

  it("sends no draft field when the author typed nothing", async () => {
    const generator = createMockMarkdownGenerator();
    const spy = vi.spyOn(generator, "generate");
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={okPatch()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать варианты/ }),
    );
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("draft");
  });
});

describe("editing an accepted section by hand", () => {
  const accepted = makeAspect({
    status: "accepted",
    selectedVariantId: "v1",
    finalPayload: "Машинный текст",
    variants: [
      {
        id: "v1",
        label: "первый",
        payloadKind: "markdown",
        payload: "Машинный текст",
        status: "accepted",
        editSource: "llm",
        generatedAt: "2026-05-09T20:00:00.000Z",
      },
    ],
  });

  it("saves the edit as a new accepted variant and supersedes the model's", async () => {
    const onPatch = okPatch();
    render(
      <AspectRunner
        stage={makeStage([accepted])}
        revision={1}
        adapter={adapter}
        generator={createMockMarkdownGenerator()}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Редактировать текст/ }),
    );
    const box = screen.getByLabelText(/Текст раздела/);
    expect(box).toHaveValue("Машинный текст");
    await userEvent.clear(box);
    await userEvent.type(box, "Мой текст");
    await userEvent.click(
      screen.getByRole("button", { name: /Сохранить правку/ }),
    );

    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const aspect = (onPatch.mock.calls[0]![1] as StageState).aspects[0]!;
    expect(aspect.status).toBe("accepted");
    expect(aspect.finalPayload).toBe("Мой текст");
    const parent = aspect.variants.find((v) => v.id === "v1")!;
    expect(parent.status).toBe("superseded");
    const mine = aspect.variants.find((v) => v.id !== "v1")!;
    expect(mine.status).toBe("accepted");
    expect(mine.editSource).toBe("manual");
    expect(mine.parentVariantId).toBe("v1");
    expect(aspect.selectedVariantId).toBe(mine.id);
  });

  it("refuses to save an empty text", async () => {
    render(
      <AspectRunner
        stage={makeStage([accepted])}
        revision={1}
        adapter={adapter}
        generator={createMockMarkdownGenerator()}
        onPatch={okPatch()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Редактировать текст/ }),
    );
    await userEvent.clear(screen.getByLabelText(/Текст раздела/));
    expect(
      screen.getByRole("button", { name: /Сохранить правку/ }),
    ).toBeDisabled();
  });
});

describe("adding a section by hand", () => {
  it("appends a user-sourced pending section", async () => {
    const onPatch = okPatch();
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={1}
        adapter={adapter}
        generator={createMockMarkdownGenerator()}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Свой раздел/ }));
    await userEvent.type(
      screen.getByLabelText(/Название своего раздела/),
      "устав гильдии",
    );
    await userEvent.click(screen.getByRole("button", { name: /^Добавить$/ }));

    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const stage = onPatch.mock.calls[0]![1] as StageState;
    expect(stage.aspects).toHaveLength(2);
    const added = stage.aspects[1]!;
    expect(added.name).toBe("устав гильдии");
    expect(added.source).toBe("user");
    expect(added.status).toBe("pending");
    expect(added.required).toBe(false);
    expect(added.payloadKind).toBe("markdown");
    expect(added.order).toBe(1);
  });

  it("blocks a name that already exists on the stage", async () => {
    const onPatch = okPatch();
    render(
      <AspectRunner
        stage={makeStage([makeAspect()])}
        revision={1}
        adapter={adapter}
        generator={createMockMarkdownGenerator()}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Свой раздел/ }));
    await userEvent.type(
      screen.getByLabelText(/Название своего раздела/),
      "География",
    );
    expect(screen.getByText(/уже есть/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Добавить$/ })).toBeDisabled();
    expect(onPatch).not.toHaveBeenCalled();
  });
});

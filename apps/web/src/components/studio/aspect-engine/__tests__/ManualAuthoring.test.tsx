import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageAspect, StageState } from "@book-forge/shared";
import { DocumentStageRunner } from "../DocumentStageRunner";

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

function renderRunner(stage: StageState, onPatch = okPatch()) {
  render(
    <DocumentStageRunner
      bookId={1}
      stageId="world"
      stageLabel="Мир"
      stage={stage}
      revision={1}
      onPatch={onPatch}
      onReloadStage={vi.fn().mockResolvedValue({ stage, revision: 1 })}
    />,
  );
  return onPatch;
}

// Раздел, добавленный автором вручную — `ManualAspectForm`, который остался
// общим для документного и старого сущностного раннера. Здесь он проверяется
// через DocumentStageRunner: AspectRunner снесён вместе с планом этапа.
describe("adding a section by hand", () => {
  it("appends a user-sourced pending section", async () => {
    const onPatch = renderRunner(makeStage([makeAspect()]));
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
    const onPatch = renderRunner(makeStage([makeAspect()]));
    await userEvent.click(screen.getByRole("button", { name: /Свой раздел/ }));
    await userEvent.type(
      screen.getByLabelText(/Название своего раздела/),
      "География",
    );
    // Точная фраза ManualAspectForm: общий подсказочный текст сборки документа
    // («Разделы, где уже есть текст…») тоже содержит «уже есть» и без уточнения
    // ломает совпадение неоднозначностью.
    expect(
      screen.getByText("Раздел с таким названием уже есть."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Добавить$/ })).toBeDisabled();
    expect(onPatch).not.toHaveBeenCalled();
  });
});

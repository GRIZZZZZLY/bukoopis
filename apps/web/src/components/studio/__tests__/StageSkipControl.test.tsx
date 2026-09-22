import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageState } from "@book-forge/shared";
import {
  StageSkipControl,
  StageOptionalBadge,
} from "../StageSkipControl";

function stage(over: Partial<StageState> = {}): StageState {
  return { status: "not_started", playbookGenerated: false, aspects: [], ...over };
}

describe("StageSkipControl", () => {
  it("skips the stage with a recorded reason", async () => {
    const onPatch = vi
      .fn()
      .mockResolvedValue({ stage: stage({ status: "skipped" }), revision: 4 });
    render(
      // Обязательный этап: у него кнопка называется «Пропустить этап», а не
      // «Этап не нужен» — эта разница проверяется отдельными тестами ниже.
      <StageSkipControl
        stageId="characters"
        stage={stage({ playbookGenerated: true })}
        revision={3}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Пропустить этап/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [revision, next] = onPatch.mock.calls[0]! as [number, StageState];
    expect(revision).toBe(3);
    expect(next.status).toBe("skipped");
    expect(next.skippedReason).toBeTruthy();
    expect(next.playbookGenerated).toBe(true);
  });

  it("offers a way back and clears the skip reason", async () => {
    const onPatch = vi
      .fn()
      .mockResolvedValue({ stage: stage(), revision: 5 });
    render(
      <StageSkipControl
        stageId="items"
        stage={stage({ status: "skipped", skippedReason: "Пропущен автором" })}
        revision={4}
        onPatch={onPatch}
      />,
    );
    expect(screen.queryByRole("button", { name: /Пропустить этап/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Вернуть этап/ }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const next = onPatch.mock.calls[0]![1] as StageState;
    expect(next.status).toBe("not_started");
    expect(next.skippedReason).toBeUndefined();
  });

  it("surfaces a conflict instead of pretending the skip landed", async () => {
    const onPatch = vi.fn().mockRejectedValue(new Error("revision_conflict"));
    render(
      <StageSkipControl
        stageId="characters"
        stage={stage()}
        revision={1}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Пропустить этап/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/revision_conflict/),
    );
  });

  it("у необязательного этапа кнопка называет решение, а не действие", () => {
    render(
      <StageSkipControl
        stageId="lore"
        stage={stage()}
        revision={1}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Этап не нужен" }),
    ).toBeInTheDocument();
  });

  it("у обязательного этапа остаётся «Пропустить этап»", () => {
    render(
      <StageSkipControl
        stageId="plot"
        stage={stage()}
        revision={1}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Пропустить этап" }),
    ).toBeInTheDocument();
  });
});

describe("StageOptionalBadge", () => {
  it("marks world, lore and items as optional", () => {
    const { container } = render(
      <>
        <StageOptionalBadge stageId="world" />
        <StageOptionalBadge stageId="lore" />
        <StageOptionalBadge stageId="items" />
      </>,
    );
    expect(container.querySelectorAll("span")).toHaveLength(3);
  });

  it("says nothing on stages the book actually needs", () => {
    const { container } = render(
      <>
        <StageOptionalBadge stageId="concept" />
        <StageOptionalBadge stageId="characters" />
        <StageOptionalBadge stageId="plot" />
        <StageOptionalBadge stageId="chapters" />
      </>,
    );
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });
});

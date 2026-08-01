import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StageState } from "@book-forge/shared";
import { PlaybookRunner } from "../PlaybookRunner";
import type { PlaybookGenerator } from "../llmGenerators";

function makeEmptyStage(): StageState {
  return {
    status: "not_started",
    playbookGenerated: false,
    aspects: [],
  };
}

function makeGenerator(
  result: Awaited<ReturnType<PlaybookGenerator["generate"]>>,
): PlaybookGenerator {
  return {
    generate: vi.fn().mockResolvedValue(result),
  };
}

describe("PlaybookRunner", () => {
  it("shows a progress bar while the playbook is generating", async () => {
    let release: ((value: { aspects: [] }) => void) | undefined;
    const generator: PlaybookGenerator = {
      generate: vi.fn((_args: unknown, onProgress?: (p: unknown) => void) => {
        onProgress?.({
          phase: "model",
          pct: 22,
          attempt: 1,
          maxAttempts: 4,
          elapsedMs: 9_000,
          attemptElapsedMs: 9_000,
          attemptTimeoutMs: 180_000,
          estimateMs: 40_000,
        });
        return new Promise((resolve) => {
          release = resolve;
        });
      }) as never,
    };
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={0}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Составить план разделов/ }),
    );
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "22");
    expect(screen.getByText(/обычно ~40 c/)).toBeInTheDocument();

    release?.({ aspects: [] });
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
    );
  });

  it("renders Generate button when stage has no aspects", () => {
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={0}
        generator={makeGenerator({ aspects: [] })}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Составить план разделов/ }),
    ).toBeInTheDocument();
  });

  it("clicking Generate shows proposed aspects for review", async () => {
    const generator = makeGenerator({
      aspects: [
        { name: "география", description: "земли и воды", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила колдовства", required: true, payloadKind: "markdown" },
        { name: "технологии", description: "уровень развития", required: false, payloadKind: "markdown" },
      ],
    });
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={0}
        generator={generator}
        onPatch={vi.fn()}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Составить план разделов/ }),
    );
    await waitFor(() =>
      expect(screen.getByText("география")).toBeInTheDocument(),
    );
    expect(screen.getByText("магия")).toBeInTheDocument();
    expect(screen.getByText("технологии")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Принять список/ }),
    ).toBeInTheDocument();
  });

  it("Принять список materializes aspects with new IDs and patches", async () => {
    const generator = makeGenerator({
      aspects: [
        { name: "география", description: "земли и воды", required: true, payloadKind: "markdown" },
        { name: "магия", description: "правила колдовства", required: false, payloadKind: "markdown" },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={2}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Составить план разделов/ }),
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Принять список/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Принять список/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const [rev, next] = onPatch.mock.calls[0]!;
    expect(rev).toBe(2);
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects[0]!.name).toBe("география");
    expect(next.aspects[0]!.required).toBe(true);
    expect(next.aspects[1]!.required).toBe(false);
    expect(next.aspects[0]!.id).toMatch(/[0-9a-f-]{36}/);
    expect(next.aspects[0]!.status).toBe("pending");
    expect(next.aspects[0]!.payloadKind).toBe("markdown");
    expect(next.aspects[0]!.source).toBe("llm");
    expect(next.playbookGenerated).toBe(true);
  });

  it("toggling off an aspect excludes it from materialization", async () => {
    const generator = makeGenerator({
      aspects: [
        { name: "география", description: "x", required: true, payloadKind: "markdown" },
        { name: "магия", description: "y", required: true, payloadKind: "markdown" },
      ],
    });
    const onPatch = vi.fn(async (rev: number, next: StageState) => ({
      stage: next,
      revision: rev + 1,
    }));
    render(
      <PlaybookRunner
        stage={makeEmptyStage()}
        revision={0}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Составить план разделов/ }),
    );
    await waitFor(() =>
      screen.getByRole("button", { name: /Принять список/ }),
    );
    const includes = screen.getAllByRole("checkbox", { name: /Включить/ });
    expect(includes.length).toBe(2);
    await userEvent.click(includes[1]!);
    await userEvent.click(
      screen.getByRole("button", { name: /Принять список/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    const [, next] = onPatch.mock.calls[0]!;
    expect(next.aspects).toHaveLength(1);
    expect(next.aspects[0]!.name).toBe("география");
  });
});

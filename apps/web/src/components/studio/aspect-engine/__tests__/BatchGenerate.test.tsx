import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AspectVariant, StageAspect, StageState } from "@book-forge/shared";
import { AspectRunner } from "../AspectRunner";
import { createMarkdownAdapter } from "../markdownAdapter";
import type { VariantGenerator } from "../types";

const adapter = createMarkdownAdapter("world");

function makeAspect(id: string, over?: Partial<StageAspect>): StageAspect {
  return {
    id,
    name: `раздел-${id}`,
    status: "pending",
    order: Number(id.replace(/\D/g, "")) || 0,
    required: true,
    source: "llm",
    payloadKind: "markdown",
    variants: [],
    ...over,
  };
}

function makeStage(aspects: StageAspect[]): StageState {
  return { status: "in_progress", playbookGenerated: true, aspects };
}

function variantFor(id: string): AspectVariant {
  return {
    id: `v-${id}`,
    label: "вариант",
    payloadKind: "markdown",
    payload: `текст ${id}`,
    status: "generated",
    editSource: "llm",
    generatedAt: "2026-05-09T20:00:00.000Z",
  };
}

/** Records how many generations were in flight at once. */
function makeTrackingGenerator(): {
  generator: VariantGenerator<string>;
  peak: () => number;
  release: () => void;
} {
  let inFlight = 0;
  let peak = 0;
  let draining = false;
  const pending: Array<() => void> = [];
  const generator: VariantGenerator<string> = {
    generate: (input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        const finish = () => {
          inFlight -= 1;
          resolve([variantFor(input.aspect.id)]);
        };
        // Once draining, later starters must not block the batch from finishing.
        if (draining) finish();
        else pending.push(finish);
      });
    },
  };
  return {
    generator,
    peak: () => peak,
    release: () => {
      draining = true;
      while (pending.length > 0) pending.shift()!();
    },
  };
}

describe("generating every remaining section at once", () => {
  it("lands all results in a single patch so they cannot collide on revision", async () => {
    const onPatch = vi.fn().mockResolvedValue({ stage: makeStage([]), revision: 2 });
    const generator: VariantGenerator<string> = {
      generate: async (input) => [variantFor(input.aspect.id)],
    };
    render(
      <AspectRunner
        stage={makeStage([makeAspect("a1"), makeAspect("a2"), makeAspect("a3")])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать все оставшиеся \(3\)/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch.mock.calls[0]![0]).toBe(1);
    const patched = onPatch.mock.calls[0]![1] as StageState;
    expect(patched.aspects.map((a) => a.status)).toEqual([
      "reviewing",
      "reviewing",
      "reviewing",
    ]);
    expect(patched.aspects[1]!.variants[0]!.payload).toBe("текст a2");
  });

  it("runs at most three at a time", async () => {
    const { generator, peak, release } = makeTrackingGenerator();
    const onPatch = vi.fn().mockResolvedValue({ stage: makeStage([]), revision: 2 });
    render(
      <AspectRunner
        stage={makeStage(["a1", "a2", "a3", "a4", "a5"].map((id) => makeAspect(id)))}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать все оставшиеся \(5\)/ }),
    );
    await waitFor(() => expect(peak()).toBe(3));
    release();
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(peak()).toBe(3);
  });

  it("keeps the sections that succeeded and reports the ones that did not", async () => {
    const onPatch = vi.fn().mockResolvedValue({ stage: makeStage([]), revision: 2 });
    const generator: VariantGenerator<string> = {
      generate: async (input) => {
        if (input.aspect.id === "a2") throw new Error("модель отказала");
        return [variantFor(input.aspect.id)];
      },
    };
    render(
      <AspectRunner
        stage={makeStage([makeAspect("a1"), makeAspect("a2")])}
        revision={1}
        adapter={adapter}
        generator={generator}
        onPatch={onPatch}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Сгенерировать все оставшиеся \(2\)/ }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    const patched = onPatch.mock.calls[0]![1] as StageState;
    expect(patched.aspects[0]!.status).toBe("reviewing");
    expect(patched.aspects[1]!.status).toBe("pending");
    expect(await screen.findByRole("alert")).toHaveTextContent(/модель отказала/);
  });

  it("stays hidden when only one section is left — the single button covers it", () => {
    render(
      <AspectRunner
        stage={makeStage([
          makeAspect("a1"),
          makeAspect("a2", { status: "accepted", finalPayload: "готово" }),
        ])}
        revision={1}
        adapter={adapter}
        generator={{ generate: async () => [] }}
        onPatch={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Сгенерировать все оставшиеся/ }),
    ).toBeNull();
  });
});

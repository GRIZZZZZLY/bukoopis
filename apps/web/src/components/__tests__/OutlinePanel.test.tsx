import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Book } from "@book-forge/shared";
import { OutlinePanel } from "../OutlinePanel";

vi.mock("@/api/client", () => ({
  api: {
    generateBookOutline: vi.fn(),
    selectBookOutline: vi.fn(),
  },
}));

function makeBook(outlineJson: string | null): Book {
  return {
    id: 1,
    title: "Тёмный лес",
    language: "ru",
    premise: "p",
    outlineJson,
    styleProfileId: null,
    status: "draft",
    writerModel: "opus",
    plotModel: "sonnet",
    criticModel: "sonnet",
    writerProvider: "anthropic",
    writerLocalModel: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
}

const variant = {
  label: "тёмный",
  logline: "Логлайн",
  synopsis: "Синопсис",
  themes: ["предательство"],
  protagonist: "Ратибор",
  antagonist: null,
  setting: "Лес",
  arcs: [{ title: "Арка", summary: "s", keyBeats: ["b"] }],
  estimatedChapters: 12,
};

describe("OutlinePanel — architecture sheet", () => {
  it("shows the architecture decisions in Russian when the variant has them", async () => {
    const outline = {
      variants: [
        {
          ...variant,
          architecture: {
            themeHandling: "implied",
            subplot: "contrasting",
            resolutionDriver: "external",
            endingMode: "partial",
            timeStructure: "moderate_anachrony",
            revelationPacing: "back_loaded",
            emotionMode: "behavior_led",
            rarityMove: "Победа достаётся антагонисту.",
            humanMoves: ["тема не проговаривается"],
          },
        },
      ],
      selectedIndex: null,
      generatedAt: "2026-09-04T00:00:00.000Z",
    };
    render(<OutlinePanel book={makeBook(JSON.stringify(outline))} onUpdated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Подробнее" }));

    expect(screen.getByText(/Финал:/)).toBeInTheDocument();
    expect(screen.getByText(/частичный/)).toBeInTheDocument();
    expect(screen.getByText(/Победа достаётся антагонисту/)).toBeInTheDocument();
  });

  it("renders a legacy variant without architecture and without the block", async () => {
    const outline = {
      variants: [variant],
      selectedIndex: null,
      generatedAt: "2026-09-04T00:00:00.000Z",
    };
    render(<OutlinePanel book={makeBook(JSON.stringify(outline))} onUpdated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Подробнее" }));

    expect(screen.getByText("Синопсис")).toBeInTheDocument();
    expect(screen.queryByText(/Финал:/)).not.toBeInTheDocument();
  });
});

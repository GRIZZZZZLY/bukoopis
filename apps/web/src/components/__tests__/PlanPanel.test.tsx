import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Chapter } from "@book-forge/shared";
import { PlanPanel } from "../PlanPanel";

vi.mock("@/api/client", () => ({
  api: {
    generateChapterPlan: vi.fn(),
    selectChapterPlan: vi.fn(),
  },
}));

function makeChapter(planJson: string | null): Chapter {
  return {
    id: 1,
    bookId: 1,
    orderIndex: 0,
    title: "Глава 1",
    intent: "intent",
    planJson,
    currentVersionId: null,
    status: "draft",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
  };
}

const beatSheet = {
  label: "v1",
  pov: "Ратибор",
  emotionalGoal: "тревога",
  estimatedWords: 4000,
  beats: [{ index: 0, type: "hook", summary: "s", goal: "g", conflict: "c", outcome: "o" }],
};

describe("PlanPanel — chapter closing", () => {
  it("shows the closing mode and note when the variant has them", () => {
    const plan = {
      variants: [
        {
          ...beatSheet,
          closing: { mode: "cut_mid_action", note: "Обрыв на пороге." },
        },
      ],
      selectedIndex: null,
      generatedAt: "2026-09-04T00:00:00.000Z",
    };
    render(
      <PlanPanel
        chapter={makeChapter(JSON.stringify(plan))}
        onUpdated={vi.fn()}
        onPlanReady={vi.fn()}
      />,
    );

    expect(screen.getByText(/Финал главы:/)).toBeInTheDocument();
    expect(screen.getByText(/обрыв посреди действия/)).toBeInTheDocument();
    expect(screen.getByText(/Обрыв на пороге/)).toBeInTheDocument();
  });

  it("renders a legacy variant without closing", () => {
    const plan = {
      variants: [beatSheet],
      selectedIndex: null,
      generatedAt: "2026-09-04T00:00:00.000Z",
    };
    render(
      <PlanPanel
        chapter={makeChapter(JSON.stringify(plan))}
        onUpdated={vi.fn()}
        onPlanReady={vi.fn()}
      />,
    );

    expect(screen.getByText(/Эмоциональная цель:/)).toBeInTheDocument();
    expect(screen.queryByText(/Финал главы:/)).not.toBeInTheDocument();
  });
});

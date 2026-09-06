import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Chapter } from "@book-forge/shared";
import { PlanPanel } from "../PlanPanel";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    generateChapterPlan: vi.fn(),
    selectChapterPlan: vi.fn(),
  },
}));

function makeChapter(over: Partial<Chapter> = {}): Chapter {
  return {
    id: 1,
    bookId: 1,
    orderIndex: 0,
    title: "Глава 1",
    intent: "intent",
    planJson: null,
    currentVersionId: null,
    status: "draft",
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...over,
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
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ planJson: JSON.stringify(plan) })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
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
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ planJson: JSON.stringify(plan) })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Эмоциональная цель:/)).toBeInTheDocument();
    expect(screen.queryByText(/Финал главы:/)).not.toBeInTheDocument();
  });
});

describe("PlanPanel — намерение приходит из плана", () => {
  it("показывает намерение главы и не даёт поля ввода", () => {
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: "Порог\nPOV: Рин", planJson: null })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/POV: Рин/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("без намерения отправляет автора на экран плана, а не просит печатать", () => {
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: null, planJson: null, bookId: 7 })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /план/i });
    expect(link).toHaveAttribute("href", "/books/7/studio/plot");
    expect(screen.getByRole("button", { name: /Сгенерировать план/ })).toBeDisabled();
  });

  it("генерация плана передаёт намерение главы", async () => {
    vi.mocked(api.generateChapterPlan).mockResolvedValue({
      variants: [],
      selectedIndex: null,
      generatedAt: "2026-09-06T00:00:00.000Z",
    } as never);
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: "Порог", planJson: null })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Сгенерировать план/ }));
    expect(api.generateChapterPlan).toHaveBeenCalledWith(expect.any(Number), "Порог", {
      variants: 2,
    });
  });
});

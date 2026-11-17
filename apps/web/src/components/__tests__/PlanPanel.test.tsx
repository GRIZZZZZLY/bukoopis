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
    updateChapter: vi.fn(),
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
    activePlanKind: null,
    scenePlan: null,
    scenePlanStale: false,
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

describe("PlanPanel — контракт главы", () => {
  function renderPlan(contract: unknown): void {
    const plan = {
      variants: [{ ...beatSheet, ...(contract === undefined ? {} : { contract }) }],
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
  }

  it("показывает обязательства варианта до выбора", () => {
    renderPlan({
      mustHappen: ["Рин находит медальон"],
      mustNotHappen: ["Сарек называет имя убийцы"],
      expectedRevelations: [],
      allowedCanonSupersessions: [
        { factId: "fact_12", statement: "брат погиб", becomes: "брат жив" },
      ],
    });
    expect(screen.getByText(/Обязано случиться:/)).toBeInTheDocument();
    expect(screen.getByText(/Рин находит медальон/)).toBeInTheDocument();
    expect(screen.getByText(/Чего быть не должно:/)).toBeInTheDocument();
    expect(screen.getByText(/Отменяет в каноне:/)).toBeInTheDocument();
    expect(screen.getByText(/брат жив/)).toBeInTheDocument();
    // Пустой список не печатается: заголовок без строк читается как «ничего
    // не раскрывается», тогда как это «не задано».
    expect(screen.queryByText(/Раскрывается здесь:/)).not.toBeInTheDocument();
  });

  it("план без контракта не рисует заголовков", () => {
    renderPlan(undefined);
    expect(screen.queryByText(/Обязано случиться:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Чего быть не должно:/)).not.toBeInTheDocument();
  });

  it("контракт со всеми пустыми списками не рисует ничего", () => {
    renderPlan({
      mustHappen: [],
      mustNotHappen: [],
      expectedRevelations: [],
      allowedCanonSupersessions: [],
    });
    expect(screen.queryByText(/Обязано случиться:/)).not.toBeInTheDocument();
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

  it("без содержания даёт ввести его, а не отсылает на экран плана", () => {
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: null, planJson: null, bookId: 7 })}
          onUpdated={vi.fn()}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Содержание главы")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /план/i })).not.toBeInTheDocument();
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

describe("PlanPanel — содержание главы", () => {
  it("без содержания показывает поле и сохраняет его", async () => {
    vi.mocked(api.updateChapter).mockResolvedValue({} as never);
    const onUpdated = vi.fn();
    render(
      <MemoryRouter>
        <PlanPanel
          chapter={makeChapter({ intent: null })}
          onUpdated={onUpdated}
          onPlanReady={vi.fn()}
        />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Содержание главы"), "Лис идёт к шлюзам");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(api.updateChapter).toHaveBeenCalledWith(1, { intent: "Лис идёт к шлюзам" });
  });

  function renderWith(intent: string | null): void {
    render(
      <MemoryRouter>
        <PlanPanel chapter={makeChapter({ intent })} onUpdated={vi.fn()} onPlanReady={vi.fn()} />
      </MemoryRouter>,
    );
  }

  it("поле ограничено 20000 символов и считает их", async () => {
    renderWith(null);
    const field = screen.getByLabelText("Содержание главы");
    expect(field).toHaveAttribute("maxLength", "20000");
    // Тот же вид, что у счётчика поля «Мир» в настройках.
    expect(screen.getByText("0 / 20000")).toHaveClass("field-hint");
    await userEvent.type(field, "Лис");
    expect(screen.getByText("3 / 20000")).toBeInTheDocument();
  });

  it("«Сохранить» неактивна, пока текст не изменён", async () => {
    renderWith("Лис идёт");
    await userEvent.click(screen.getByRole("button", { name: "Изменить" }));
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Содержание главы"), " к шлюзам");
    expect(save).toBeEnabled();
  });

  it("«Отмена» возвращает прежнее содержание без сохранения", async () => {
    vi.mocked(api.updateChapter).mockClear();
    renderWith("Лис идёт");
    await userEvent.click(screen.getByRole("button", { name: "Изменить" }));
    await userEvent.type(screen.getByLabelText("Содержание главы"), " к шлюзам");
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Лис идёт")).toBeInTheDocument();
    expect(api.updateChapter).not.toHaveBeenCalled();
  });

  it("у пустого содержания «Отмены» нет — отменять нечего", () => {
    renderWith(null);
    expect(screen.queryByRole("button", { name: "Отмена" })).not.toBeInTheDocument();
  });
});

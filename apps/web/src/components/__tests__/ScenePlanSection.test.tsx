import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    generateScenePlan: vi.fn(),
    saveScenePlan: vi.fn(),
  },
}));

const ev = (p: string) => [`${p}1`, `${p}2`, `${p}3`];

function ch(over: Partial<Chapter> = {}): Chapter {
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

function show(chapter: Chapter, showScenePlan = true) {
  return render(
    <MemoryRouter>
      <PlanPanel
        chapter={chapter}
        onUpdated={vi.fn()}
        onPlanReady={vi.fn()}
        showScenePlan={showScenePlan}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("План сцен", () => {
  it("скрыт, когда писатель не наша модель", () => {
    show(ch(), false);
    expect(screen.queryByText("План сцен")).toBeNull();
  });

  it("генерация заполняет поля", async () => {
    vi.mocked(api.generateScenePlan).mockResolvedValue(
      ch({ scenePlan: { scenes: [{ events: ev("a") }], basedOn: 1 } }),
    );
    show(ch());
    await userEvent.click(screen.getByRole("button", { name: "Составить план сцен" }));
    expect(await screen.findByRole("textbox")).toHaveValue("a1\na2\na3");
  });

  it("правка и сохранение шлют обрезанный план без пустой сцены", async () => {
    const plan = { scenes: [{ events: ev("a") }, { events: ev("b") }], basedOn: 1 };
    vi.mocked(api.saveScenePlan).mockResolvedValue(ch({ scenePlan: plan }));
    show(ch({ scenePlan: plan }));
    const [first, second] = screen.getAllByRole("textbox");
    await userEvent.clear(second!);
    await userEvent.clear(first!);
    await userEvent.type(first!, "  x1 \n\n x2\nx3  ");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(api.saveScenePlan).toHaveBeenCalledWith(1, {
        scenes: [{ events: ["x1", "x2", "x3"] }],
      }),
    );
  });

  it("устаревший план предупреждает", () => {
    show(ch({ scenePlan: { scenes: [{ events: ev("a") }], basedOn: 1 }, scenePlanStale: true }));
    expect(
      screen.getByText("План сцен составлен по прежнему содержанию главы"),
    ).toBeInTheDocument();
  });

  it("«Сохранить» неактивна без правок", () => {
    show(ch({ scenePlan: { scenes: [{ events: ev("a") }], basedOn: 1 } }));
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  it("ошибку сервера показывает на месте", async () => {
    vi.mocked(api.saveScenePlan).mockRejectedValue(new Error("HTTP 400: в сцене 2 события"));
    show(ch({ scenePlan: { scenes: [{ events: ev("a") }], basedOn: 1 } }));
    await userEvent.type(screen.getAllByRole("textbox")[0]!, "z");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("в сцене 2 события");
  });
});

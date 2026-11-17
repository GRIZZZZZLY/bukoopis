import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Chapter } from "@book-forge/shared";
import { PlanPanel } from "../PlanPanel";
import { api } from "@/api/client";
import { getJob } from "@/lib/jobs";

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
const A = "a1\na2\na3";

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
const withPlan = (over: Partial<Chapter> = {}) =>
  ch({ scenePlan: { scenes: [{ events: ev("a") }], basedOn: 1 }, ...over });
const apiError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

/** Родитель: после onUpdated отдаёт панели главу, которую вернул сервер. */
let serverChapter: Chapter;
function Harness({ initial, on }: { initial: Chapter; on: boolean }) {
  const [chapter, setChapter] = useState(initial);
  return (
    <PlanPanel
      chapter={chapter}
      onUpdated={() => setChapter(serverChapter)}
      onPlanReady={vi.fn()}
      showScenePlan={on}
    />
  );
}
function show(chapter: Chapter, on = true) {
  serverChapter = chapter;
  return render(
    <MemoryRouter>
      <Harness initial={chapter} on={on} />
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
    vi.mocked(api.generateScenePlan).mockResolvedValue(withPlan());
    show(ch());
    serverChapter = withPlan();
    await userEvent.click(screen.getByRole("button", { name: "Составить план сцен" }));
    expect(await screen.findByRole("textbox")).toHaveValue(A);
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
    show(withPlan({ scenePlanStale: true }));
    expect(
      screen.getByText("План сцен составлен по прежнему содержанию главы"),
    ).toBeInTheDocument();
  });

  it("«Сохранить» неактивна без правок", () => {
    show(withPlan());
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  });

  it("ошибку сохранения показывает как есть", async () => {
    vi.mocked(api.saveScenePlan).mockRejectedValue(apiError(400, "HTTP 400: в сцене 2 события"));
    show(withPlan());
    await userEvent.type(screen.getAllByRole("textbox")[0]!, "z");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("в сцене 2 события");
  });

  it("«Очистить» шлёт null", async () => {
    vi.mocked(api.saveScenePlan).mockResolvedValue(ch());
    show(withPlan());
    serverChapter = ch();
    await userEvent.click(screen.getByRole("button", { name: "Очистить" }));
    await waitFor(() => expect(api.saveScenePlan).toHaveBeenCalledWith(1, null));
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("генерация публикует и снимает работу", async () => {
    let resolve!: (c: Chapter) => void;
    vi.mocked(api.generateScenePlan).mockReturnValue(
      new Promise<Chapter>((r) => (resolve = r)),
    );
    show(ch());
    await userEvent.click(screen.getByRole("button", { name: "Составить план сцен" }));
    expect(getJob()?.label).toBe("Составляет план сцен");
    await act(async () => resolve(withPlan()));
    expect(getJob()).toBeNull();
  });

  it("правки не затираются перечитыванием главы", async () => {
    const panel = (c: Chapter) => (
      <MemoryRouter>
        <PlanPanel chapter={c} onUpdated={vi.fn()} onPlanReady={vi.fn()} showScenePlan />
      </MemoryRouter>
    );
    const { rerender } = render(panel(withPlan()));
    await userEvent.type(screen.getByRole("textbox"), "z");
    rerender(panel(withPlan()));
    expect(screen.getByRole("textbox")).toHaveValue(A + "z");
  });

  it("генерация поверх правок просит подтверждения", async () => {
    vi.mocked(api.generateScenePlan).mockResolvedValue(withPlan());
    show(withPlan());
    await userEvent.type(screen.getByRole("textbox"), "z");
    await userEvent.click(screen.getByRole("button", { name: "Составить план сцен" }));
    expect(api.generateScenePlan).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Заменить правки?" }));
    await waitFor(() => expect(api.generateScenePlan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(A));
  });

  it("409 при генерации объясняет по-русски", async () => {
    vi.mocked(api.generateScenePlan).mockRejectedValue(apiError(409, "HTTP 409: x"));
    show(ch());
    await userEvent.click(screen.getByRole("button", { name: "Составить план сцен" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ваш план сохранён");
  });

  it("400 при генерации: нечего разворачивать", async () => {
    vi.mocked(api.generateScenePlan).mockRejectedValue(apiError(400, "HTTP 400: x"));
    show(ch());
    await userEvent.click(screen.getByRole("button", { name: "Составить план сцен" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нечего разворачивать");
  });
});

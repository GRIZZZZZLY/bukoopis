import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickStartPanel } from "../QuickStartPanel";

vi.mock("@/api/client", () => ({
  api: { cancelQuickStart: vi.fn(), getQuickStartInflight: vi.fn() },
  streamQuickStart: vi.fn(),
}));

import { api, streamQuickStart } from "@/api/client";

beforeEach(() => {
  vi.mocked(api.getQuickStartInflight).mockResolvedValue(null as never);
  vi.mocked(streamQuickStart).mockReset();
});

describe("QuickStartPanel", () => {
  it("говорит, что ничего не будет утверждено без автора", () => {
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    expect(screen.getByText(/ничего не утвержда/i)).toBeInTheDocument();
  });

  it("показывает этапы по мере их прохождения", async () => {
    vi.mocked(streamQuickStart).mockImplementation(async (_id, handlers) => {
      handlers.onBegin({ total: 5 });
      handlers.onStage({ index: 0, total: 5, stageId: "world", status: "started" });
      handlers.onStage({ index: 0, total: 5, stageId: "world", status: "done" });
      handlers.onDone({ stages: [], cancelled: false, revision: 2 });
    });
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Собрать всё до первой главы/ }));
    expect(await screen.findByText("Мир")).toBeInTheDocument();
  });

  it("отказавший этап назван вместе с причиной", async () => {
    vi.mocked(streamQuickStart).mockImplementation(async (_id, handlers) => {
      handlers.onBegin({ total: 5 });
      handlers.onStage({
        index: 4,
        total: 5,
        stageId: "plot",
        status: "failed",
        message: "бэкенд недоступен",
      });
      handlers.onDone({ stages: [], cancelled: false, revision: 2 });
    });
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Собрать всё до первой главы/ }));
    expect(await screen.findByText(/бэкенд недоступен/)).toBeInTheDocument();
  });

  it("останавливает сбор по кнопке", async () => {
    vi.mocked(api.cancelQuickStart).mockResolvedValue({ stopping: true } as never);
    // Поток держим открытым, пока тест не нажмёт «Остановить»: закройся он
    // раньше, кнопка исчезла бы из-под клика.
    let finish = (): void => {};
    vi.mocked(api.cancelQuickStart).mockImplementation(async () => {
      finish();
      return { stopping: true } as never;
    });
    vi.mocked(streamQuickStart).mockImplementation(async (_id, handlers) => {
      handlers.onBegin({ total: 5 });
      await new Promise<void>((r) => {
        finish = r;
      });
      handlers.onDone({ stages: [], cancelled: true, revision: 2 });
    });
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Собрать всё до первой главы/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Остановить" }));
    await waitFor(() => expect(api.cancelQuickStart).toHaveBeenCalledWith(3));
  });

  it("подхватывает идущий сбор при монтировании", async () => {
    vi.mocked(api.getQuickStartInflight).mockResolvedValue({
      total: 5,
      startedAt: "2026-09-06T10:00:00.000Z",
      rows: [{ stageId: "world", status: "done" }],
    } as never);
    render(<QuickStartPanel bookId={3} onFinished={vi.fn()} />);
    expect(await screen.findByText(/Собираем этапы/i)).toBeInTheDocument();
    expect(screen.getByText(/идёт на сервере/i)).toBeInTheDocument();
    expect(screen.getByText("Мир")).toBeInTheDocument();
  });
});

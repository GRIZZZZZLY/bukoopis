import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakeProgress } from "../IntakeProgress";

const ROWS = [
  { filename: "00_Оглавление.md", status: "done" as const, targets: ["concept" as const, "plot" as const] },
  { filename: "Связи.md", status: "failed" as const, message: "LLM failure" },
  { filename: "Карта.md", status: "running" as const },
];

describe("IntakeProgress", () => {
  it("counts the files it has finished against the total", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} canStop onStop={vi.fn()} />);
    expect(screen.getByText(/2 из 11/)).toBeInTheDocument();
  });

  it("names each file and, for the finished ones, where the material went", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} canStop onStop={vi.fn()} />);
    expect(screen.getByText("00_Оглавление.md")).toBeInTheDocument();
    expect(screen.getByText(/Замысел/)).toBeInTheDocument();
    expect(screen.getByText(/План книги/)).toBeInTheDocument();
  });

  it("shows a failed file's reason without hiding the rest", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} canStop onStop={vi.fn()} />);
    expect(screen.getByText(/LLM failure/)).toBeInTheDocument();
    expect(screen.getByText("Карта.md")).toBeInTheDocument();
  });

  it("stops on request and says the current file will finish first", async () => {
    const onStop = vi.fn();
    render(<IntakeProgress total={11} rows={ROWS} stopping={false} canStop onStop={onStop} />);
    await userEvent.click(screen.getByRole("button", { name: /Остановить/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("while stopping, the button is spent and the promise is honest", () => {
    render(<IntakeProgress total={11} rows={ROWS} stopping={true} canStop onStop={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Останавливаем/ })).toBeDisabled();
    expect(screen.getByText(/текущий файл/i)).toBeInTheDocument();
  });

  it("keeps the stop button out of reach until the run can be stopped", () => {
    // Без ключа прогона останавливать нечего: живая кнопка, молча глотающая
    // клик, врёт автору — пусть лучше будет видно, что она ещё не работает.
    render(
      <IntakeProgress total={11} rows={ROWS} stopping={false} canStop={false} onStop={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Остановить/ })).toBeDisabled();
  });

  it("renders same-named files from different subfolders without a duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <IntakeProgress
        total={2}
        rows={[
          { filename: "заметки.md", status: "done", targets: ["world"] },
          { filename: "заметки.md", status: "running" },
        ]}
        stopping={false}
        canStop
        onStop={vi.fn()}
      />,
    );
    expect(screen.getAllByText("заметки.md")).toHaveLength(2);
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
    spy.mockRestore();
  });
});

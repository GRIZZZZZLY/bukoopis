import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sheet } from "../Sheet";

/** Регрессия: закрытая панель уводилась за край классом translate-x-full,
    но Tailwind в этой сборке не генерирует transform-утилиты — панель
    оставалась поверх контента и на мобиле перекрывала главу целиком. */
describe("Sheet", () => {
  it("renders nothing while closed", () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Панели">
        <p>содержимое</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("содержимое")).not.toBeInTheDocument();
  });

  it("renders the panel when open", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Панели">
        <p>содержимое</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Панели" })).toBeInTheDocument();
    expect(screen.getByText("содержимое")).toBeInTheDocument();
  });

  it("closes on the × button", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Панели">
        <p>содержимое</p>
      </Sheet>,
    );
    screen.getByRole("button", { name: "Закрыть" }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

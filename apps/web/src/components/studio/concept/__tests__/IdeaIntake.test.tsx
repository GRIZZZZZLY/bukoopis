import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IdeaIntake } from "../IdeaIntake";

describe("IdeaIntake", () => {
  it("disables the button until the idea is long enough", async () => {
    const onIdeaChange = vi.fn();
    render(
      <IdeaIntake idea="книга" onIdeaChange={onIdeaChange} onGenerate={vi.fn()} busy={false} error={null} />,
    );
    expect(screen.getByRole("button", { name: /Предложить питчи/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("О чём книга?"), " про");
    expect(onIdeaChange).toHaveBeenCalled();
  });

  it("calls onGenerate when the idea is ready", async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    render(
      <IdeaIntake
        idea="Шестеро героев из двух враждующих миров."
        onIdeaChange={vi.fn()}
        onGenerate={onGenerate}
        busy={false}
        error={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Предложить питчи/ }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("shows the error and blocks the button while busy", () => {
    render(
      <IdeaIntake
        idea="Шестеро героев из двух враждующих миров."
        onIdeaChange={vi.fn()}
        onGenerate={vi.fn()}
        busy={true}
        error="LLM failure"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("LLM failure");
    expect(screen.getByRole("button", { name: /Думаем/ })).toBeDisabled();
  });
});

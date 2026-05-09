import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptForm } from "../ConceptForm";
import { emptyBookConcept, type BookConcept } from "@book-forge/shared";

describe("ConceptForm", () => {
  const noopRefine = vi.fn(async () => ({ variants: [] }));

  it("renders fields preloaded from initialConcept", () => {
    const c: BookConcept = emptyBookConcept();
    c.genres = ["fantasy"];
    c.tones = ["dark"];
    c.audience = "ya";
    c.premise = { logline: "Тестовая премиса" };
    render(
      <ConceptForm
        initialConcept={c}
        onSave={vi.fn().mockResolvedValue(c)}
        onRefine={noopRefine}
      />,
    );
    expect(screen.getByDisplayValue("Тестовая премиса")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Фэнтези$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Save button is disabled when nothing changed", () => {
    const c = emptyBookConcept();
    render(<ConceptForm initialConcept={c} onSave={vi.fn()} onRefine={noopRefine} />);
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeDisabled();
  });

  it("Save button enables after a change and calls onSave with merged concept", async () => {
    const c = emptyBookConcept();
    const onSave = vi.fn().mockResolvedValue(c);
    render(<ConceptForm initialConcept={c} onSave={onSave} onRefine={noopRefine} />);
    const logline = screen.getByLabelText(/Логлайн/);
    await userEvent.type(logline, "Г");
    const saveBtn = screen.getByRole("button", { name: /Сохранить/ });
    expect(saveBtn).toBeEnabled();
    await userEvent.click(saveBtn);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const arg = onSave.mock.calls[0]![0] as BookConcept;
    expect(arg.premise.logline).toBe("Г");
  });

  it("renders error when onSave rejects", async () => {
    const c = emptyBookConcept();
    const onSave = vi.fn().mockRejectedValue(new Error("boom"));
    render(<ConceptForm initialConcept={c} onSave={onSave} onRefine={noopRefine} />);
    await userEvent.type(screen.getByLabelText(/Логлайн/), "x");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/boom/);
    });
  });
});

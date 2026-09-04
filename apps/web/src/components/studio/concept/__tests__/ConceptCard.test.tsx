import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptCard } from "../ConceptCard";
import { emptyBookConcept, type BookConcept } from "@book-forge/shared";

const LOCKED: BookConcept = {
  ...emptyBookConcept(),
  lockedAt: "2026-09-04T10:00:00.000Z",
  genre: "фантастика выживания",
  tone: "холодный",
  hook: "В архивах — невозможная правка.",
  premise: {
    protagonist: "Нейла, проводница.",
    conflict: "Карта расходится с морем.",
    stakes: "Караван.",
    logline: "Когда карта врёт, Нейла должна выбрать.",
  },
};

describe("ConceptCard", () => {
  it("shows the locked concept with human labels", () => {
    render(<ConceptCard concept={LOCKED} onSave={vi.fn()} onRefine={vi.fn()} onUnlock={vi.fn()} busy={false} />);
    expect(screen.getByDisplayValue("Когда карта врёт, Нейла должна выбрать.")).toBeInTheDocument();
    expect(screen.getByLabelText("О чём книга, одной фразой")).toBeInTheDocument();
    expect(screen.getByLabelText("Кто главный и чего хочет")).toBeInTheDocument();
    expect(screen.getByLabelText("Жанр")).toHaveValue("фантастика выживания");
    expect(screen.queryByText(/Логлайн/)).toBeNull();
    expect(screen.queryByText(/Ставки/)).toBeNull();
  });

  it("save is disabled until something changes, then sends the edited concept", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ConceptCard concept={LOCKED} onSave={onSave} onRefine={vi.fn()} onUnlock={vi.fn()} busy={false} />);
    const save = screen.getByRole("button", { name: /Сохранить правки/ });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Крючок"), " Ещё.");
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0].hook).toBe("В архивах — невозможная правка. Ещё.");
    expect(onSave.mock.calls[0]?.[0].lockedAt).toBe(LOCKED.lockedAt);
  });

  it("offers other phrasings for a premise line", async () => {
    const onRefine = vi.fn().mockResolvedValue({
      variants: [{ id: "v1", label: "жёстче", payload: "Когда карта лжёт, Нейла выбирает." }],
    });
    render(<ConceptCard concept={LOCKED} onSave={vi.fn()} onRefine={onRefine} onUnlock={vi.fn()} busy={false} />);
    // Строки идут в порядке PREMISE_ROWS: первая — «О чём книга, одной фразой» (logline).
    const buttons = screen.getAllByRole("button", { name: /Другие формулировки/ });
    await userEvent.click(buttons[0]!);
    await waitFor(() => expect(onRefine).toHaveBeenCalledWith("logline", "Когда карта врёт, Нейла должна выбрать."));
    await userEvent.click(await screen.findByRole("button", { name: /Принять/ }));
    expect(screen.getByDisplayValue("Когда карта лжёт, Нейла выбирает.")).toBeInTheDocument();
  });

  it("unlock goes back to the pitches", async () => {
    const onUnlock = vi.fn().mockResolvedValue(undefined);
    render(<ConceptCard concept={LOCKED} onSave={vi.fn()} onRefine={vi.fn()} onUnlock={onUnlock} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: /Изменить замысел/ }));
    expect(onUnlock).toHaveBeenCalled();
  });

  it("shows an error and recovers when unlock fails", async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error("offline"));
    render(<ConceptCard concept={LOCKED} onSave={vi.fn()} onRefine={vi.fn()} onUnlock={onUnlock} busy={false} />);
    const unlockButton = screen.getByRole("button", { name: /Изменить замысел/ });
    await userEvent.click(unlockButton);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/offline/));
    expect(unlockButton).toBeEnabled();
  });

  it("disables the re-phrase rows while a save is in flight, so they can't fire concurrently", async () => {
    let resolveSave: () => void = () => {};
    const onSave = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => (resolveSave = resolve)),
    );
    render(<ConceptCard concept={LOCKED} onSave={onSave} onRefine={vi.fn()} onUnlock={vi.fn()} busy={false} />);
    await userEvent.type(screen.getByLabelText("Крючок"), " Ещё.");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить правки/ }));
    for (const button of screen.getAllByRole("button", { name: /Другие формулировки/ })) {
      expect(button).toBeDisabled();
    }
    resolveSave();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptForm } from "../ConceptForm";
import { emptyBookConcept, type BookConcept } from "@book-forge/shared";

const EXPANDED: BookConcept = {
  schemaVersion: 1,
  pitches: [],
  genres: ["fantasy"],
  tones: ["melancholic"],
  audience: "ya",
  premise: {
    protagonist: "Девочка-картограф",
    conflict: "Город не хочет быть найденным",
    stakes: "Потеряет мать",
    logline: "Когда карта показывает город, которого нет, девочка идёт туда.",
  },
};

const IDEA = "Девочка находит карту города, которого нет ни на одной карте.";

describe("ConceptForm braindump entry", () => {
  const noopRefine = vi.fn(async () => ({ variants: [] }));

  beforeEach(() => {
    localStorage.clear();
  });

  it("is absent when the host page does not wire it up", () => {
    render(
      <ConceptForm
        initialConcept={emptyBookConcept()}
        onSave={vi.fn()}
        onRefine={noopRefine}
      />,
    );
    expect(screen.queryByLabelText(/Свободное описание идеи/)).toBeNull();
  });

  it("keeps the expand button disabled until the idea has some substance", async () => {
    render(
      <ConceptForm
        initialConcept={emptyBookConcept()}
        onSave={vi.fn()}
        onRefine={noopRefine}
        bookId={1}
        onFromIdea={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /Разложить в концепт/ });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Свободное описание идеи/), IDEA);
    expect(button).toBeEnabled();
  });

  it("fills empty concept fields from the expanded idea", async () => {
    const onFromIdea = vi.fn().mockResolvedValue(EXPANDED);
    render(
      <ConceptForm
        initialConcept={emptyBookConcept()}
        onSave={vi.fn()}
        onRefine={noopRefine}
        bookId={1}
        onFromIdea={onFromIdea}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Свободное описание идеи/), IDEA);
    await userEvent.click(
      screen.getByRole("button", { name: /Разложить в концепт/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByDisplayValue(EXPANDED.premise.logline!),
      ).toBeInTheDocument(),
    );
    expect(onFromIdea).toHaveBeenCalledWith(IDEA);
    expect(screen.getByRole("button", { name: /^Фэнтези$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("never overwrites a premise field the author already wrote", async () => {
    const mine = emptyBookConcept();
    mine.premise = { logline: "Мой логлайн" };
    render(
      <ConceptForm
        initialConcept={mine}
        onSave={vi.fn()}
        onRefine={noopRefine}
        bookId={1}
        onFromIdea={vi.fn().mockResolvedValue(EXPANDED)}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Свободное описание идеи/), IDEA);
    await userEvent.click(
      screen.getByRole("button", { name: /Разложить в концепт/ }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue(/Девочка-картограф/)).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("Мой логлайн")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(EXPANDED.premise.logline!)).toBeNull();
  });

  it("surfaces the failure instead of silently doing nothing", async () => {
    render(
      <ConceptForm
        initialConcept={emptyBookConcept()}
        onSave={vi.fn()}
        onRefine={noopRefine}
        bookId={1}
        onFromIdea={vi.fn().mockRejectedValue(new Error("LLM упал"))}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Свободное описание идеи/), IDEA);
    await userEvent.click(
      screen.getByRole("button", { name: /Разложить в концепт/ }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/LLM упал/),
    );
  });

  it("saves the idea with the concept so it survives more than a reload", async () => {
    const onSave = vi.fn(async (c: BookConcept) => c);
    render(
      <ConceptForm
        initialConcept={emptyBookConcept()}
        onSave={onSave}
        onRefine={noopRefine}
        bookId={42}
        onFromIdea={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Свободное описание идеи/), IDEA);
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].idea).toBe(IDEA);
  });

  it("shows an idea that was already saved on the concept", () => {
    render(
      <ConceptForm
        initialConcept={{ ...emptyBookConcept(), idea: IDEA }}
        onSave={vi.fn()}
        onRefine={noopRefine}
        bookId={42}
        onFromIdea={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Свободное описание идеи/)).toHaveValue(IDEA);
  });

  it("adopts an idea stranded in localStorage by the previous build", async () => {
    localStorage.setItem("bf-idea-42", IDEA);
    render(
      <ConceptForm
        initialConcept={emptyBookConcept()}
        onSave={vi.fn()}
        onRefine={noopRefine}
        bookId={42}
        onFromIdea={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/Свободное описание идеи/)).toHaveValue(IDEA),
    );
    expect(localStorage.getItem("bf-idea-42")).toBeNull();
  });

  it("does not let a stranded value overwrite the saved idea", () => {
    localStorage.setItem("bf-idea-42", "старый мусор");
    render(
      <ConceptForm
        initialConcept={{ ...emptyBookConcept(), idea: IDEA }}
        onSave={vi.fn()}
        onRefine={noopRefine}
        bookId={42}
        onFromIdea={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Свободное описание идеи/)).toHaveValue(IDEA);
  });
});

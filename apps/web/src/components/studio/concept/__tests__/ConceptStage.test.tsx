import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConceptStage } from "../ConceptStage";
import { api } from "@/api/client";
import { emptyBookConcept, type BookConcept, type Pitch } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    patchConcept: vi.fn(),
    generatePitches: vi.fn(),
    blendPitch: vi.fn(),
    lockConcept: vi.fn(),
    unlockConcept: vi.fn(),
    refineConceptField: vi.fn(),
  },
}));
const m = vi.mocked(api);

const PITCH: Pitch = {
  id: "a",
  workingTitle: "Архив",
  logline: "Логлайн",
  protagonist: "Герой",
  conflict: "Конфликт",
  stakes: "Ставки",
  hook: "Крючок",
  genre: "фантастика",
  tone: "холодный",
  audience: "adult",
  strength: "Сила",
  risk: "Риск",
};

describe("ConceptStage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("starts with the idea intake, saves the idea and generates pitches", async () => {
    const onConceptChange = vi.fn();
    const withIdea: BookConcept = { ...emptyBookConcept(), idea: "Шестеро героев из двух миров." };
    m.patchConcept.mockResolvedValue(withIdea as never);
    m.generatePitches.mockResolvedValue({
      concept: { ...withIdea, pitches: [PITCH] },
      questions: ["Для кого?"],
      newPitchIds: ["a"],
    } as never);
    render(<ConceptStage bookId={3} concept={emptyBookConcept()} onConceptChange={onConceptChange} />);
    await userEvent.type(screen.getByLabelText("О чём книга?"), "Шестеро героев из двух миров.");
    await userEvent.click(screen.getByRole("button", { name: /Предложить питчи/ }));
    await waitFor(() => expect(m.generatePitches).toHaveBeenCalledWith(3, {}));
    expect(m.patchConcept).toHaveBeenCalledWith(3, expect.objectContaining({ idea: "Шестеро героев из двух миров." }));
    expect(onConceptChange).toHaveBeenLastCalledWith(expect.objectContaining({ pitches: [PITCH] }));
  });

  it("shows the board when pitches exist and locks on choose", async () => {
    const onConceptChange = vi.fn();
    const withPitches: BookConcept = { ...emptyBookConcept(), idea: "Задумка длиннее десяти.", pitches: [PITCH] };
    const locked: BookConcept = { ...withPitches, lockedAt: "2026-09-04T10:00:00.000Z", premise: { logline: "Логлайн" } };
    m.lockConcept.mockResolvedValue(locked as never);
    render(<ConceptStage bookId={3} concept={withPitches} onConceptChange={onConceptChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Выбрать этот/ }));
    await waitFor(() => expect(m.lockConcept).toHaveBeenCalledWith(3, "a"));
    expect(onConceptChange).toHaveBeenCalledWith(locked);
  });

  it("shows the concept card when locked", () => {
    const locked: BookConcept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Логлайн", protagonist: "Герой", conflict: "Конфликт", stakes: "Ставки" },
    };
    render(<ConceptStage bookId={3} concept={locked} onConceptChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Изменить замысел/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Предложить питчи/ })).toBeNull();
  });
});

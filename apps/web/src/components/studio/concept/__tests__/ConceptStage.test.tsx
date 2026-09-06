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

  it("shows a failed unlock's error message on the concept card", async () => {
    const locked: BookConcept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Логлайн", protagonist: "Герой", conflict: "Конфликт", stakes: "Ставки" },
    };
    m.unlockConcept.mockRejectedValue(new Error("offline"));
    render(<ConceptStage bookId={3} concept={locked} onConceptChange={vi.fn()} />);
    const unlockButton = screen.getByRole("button", { name: /Изменить замысел/ });
    await userEvent.click(unlockButton);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/offline/));
    expect(unlockButton).toBeEnabled();
  });

  it("offers a legacy premise (no pitches, not locked) a one-click confirm bridge", async () => {
    const onConceptChange = vi.fn();
    const legacy: BookConcept = {
      ...emptyBookConcept(),
      idea: "Задумка, записанная до этой ветки.",
      pitches: [],
      premise: {
        logline: "Картограф ищет остров, которого нет.",
        protagonist: "Старый картограф",
        conflict: "Карта расходится с морем",
        stakes: "Последний рейс",
      },
    };
    const locked: BookConcept = { ...legacy, lockedAt: "2026-09-04T10:00:00.000Z" };
    m.lockConcept.mockResolvedValue(locked as never);
    render(<ConceptStage bookId={3} concept={legacy} onConceptChange={onConceptChange} />);

    // The stored premise is visible read-only, with human labels — no jargon.
    expect(screen.getByText("Картограф ищет остров, которого нет.")).toBeInTheDocument();
    expect(screen.getByText("О чём книга, одной фразой")).toBeInTheDocument();
    expect(screen.queryByText(/Логлайн/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: "О чём книга?" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Утвердить как есть/ }));
    await waitFor(() => expect(m.lockConcept).toHaveBeenCalledWith(3));
    expect(onConceptChange).toHaveBeenCalledWith(locked);
  });

  it("the legacy bridge can also start over into the idea intake", async () => {
    const legacy: BookConcept = {
      ...emptyBookConcept(),
      pitches: [],
      premise: { logline: "Старая задумка." },
    };
    render(<ConceptStage bookId={3} concept={legacy} onConceptChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Начать заново с питчей/ }));
    expect(screen.getByLabelText("О чём книга?")).toBeInTheDocument();
  });

  it("shows an idea that arrived from outside — import fills it on the server", async () => {
    // Приём материалов пишет замысел в концепт, страница перечитывает его и
    // передаёт сюда новым пропом. Поле держало значение с момента монтирования,
    // и автор видел пустую форму, хотя замысел уже лежал в базе.
    const empty = emptyBookConcept();
    const { rerender } = render(
      <ConceptStage bookId={3} concept={empty} onConceptChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("О чём книга?")).toHaveValue("");

    rerender(
      <ConceptStage
        bookId={3}
        concept={{ ...empty, idea: "Книга о городе за барьером." }}
        onConceptChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("О чём книга?")).toHaveValue("Книга о городе за барьером.");
  });

  it("does not throw away what the author is typing", async () => {
    const empty = emptyBookConcept();
    const { rerender } = render(
      <ConceptStage bookId={3} concept={empty} onConceptChange={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText("О чём книга?"), "Моя задумка");

    rerender(
      <ConceptStage
        bookId={3}
        concept={{ ...empty, idea: "Пришедшее извне." }}
        onConceptChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("О чём книга?")).toHaveValue("Моя задумка");
  });
});

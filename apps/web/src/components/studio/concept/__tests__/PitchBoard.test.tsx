import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PitchBoard } from "../PitchBoard";
import type { Pitch } from "@book-forge/shared";

function pitch(id: string, title: string): Pitch {
  return {
    id,
    workingTitle: title,
    logline: `Логлайн ${title}`,
    protagonist: `Герой ${title}`,
    conflict: `Конфликт ${title}`,
    stakes: `Ставки ${title}`,
    hook: `Крючок ${title}`,
    genre: "фантастика",
    tone: "холодный",
    audience: "adult",
    strength: `Сила ${title}`,
    risk: `Риск ${title}`,
  };
}

const PITCHES = [pitch("a", "Архив"), pitch("b", "Барьер"), pitch("c", "Волна")];

function renderBoard(over: Partial<ComponentProps<typeof PitchBoard>> = {}) {
  const props: ComponentProps<typeof PitchBoard> = {
    pitches: PITCHES,
    newPitchIds: ["c"],
    questions: [],
    busy: false,
    error: null,
    onMore: vi.fn().mockResolvedValue(undefined),
    onBlend: vi.fn().mockResolvedValue(undefined),
    onChoose: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onAnswer: vi.fn().mockResolvedValue(undefined),
    onBackToIdea: vi.fn(),
    ...over,
  };
  render(<PitchBoard {...props} />);
  return props;
}

describe("PitchBoard", () => {
  it("renders one card per pitch with human labels and no jargon", () => {
    renderBoard();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByText("Архив")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("О чём книга, одной фразой")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Кто главный и чего хочет")).toBeInTheDocument();
    expect(screen.queryByText(/Логлайн$/)).toBeNull();
    expect(screen.queryByText(/Протагонист/)).toBeNull();
    expect(screen.queryByText(/Премиса/)).toBeNull();
  });

  it("marks freshly generated pitches", () => {
    renderBoard();
    expect(screen.getAllByText("новый")).toHaveLength(1);
  });

  it("choosing a pitch calls onChoose with its id", async () => {
    const p = renderBoard();
    const cards = screen.getAllByRole("article");
    await userEvent.click(within(cards[1]!).getByRole("button", { name: /Выбрать этот/ }));
    expect(p.onChoose).toHaveBeenCalledWith("b");
  });

  it("removing a pitch calls onRemove", async () => {
    const p = renderBoard();
    const cards = screen.getAllByRole("article");
    await userEvent.click(within(cards[0]!).getByRole("button", { name: /Убрать/ }));
    expect(p.onRemove).toHaveBeenCalledWith("a");
  });

  it("asks for more pitches with a direction", async () => {
    const p = renderBoard();
    await userEvent.type(screen.getByLabelText("Куда сместить"), "мрачнее");
    await userEvent.click(screen.getByRole("button", { name: /Ещё варианты/ }));
    expect(p.onMore).toHaveBeenCalledWith("мрачнее");
  });

  it("mix mode collects picks from at least two pitches before blending", async () => {
    const p = renderBoard();
    await userEvent.click(screen.getByRole("button", { name: /^Смешать$/ }));
    const blend = screen.getByRole("button", { name: /Собрать из выбранного/ });
    expect(blend).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Кто главный и чего хочет: взять из «Архив»" }));
    expect(blend).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Что ему мешает: взять из «Барьер»" }));
    expect(blend).toBeEnabled();
    await userEvent.click(blend);
    expect(p.onBlend).toHaveBeenCalledWith({ protagonist: "a", conflict: "b" });
  });

  it("answers a clarifying question", async () => {
    const p = renderBoard({ questions: ["Для кого книга?"] });
    await userEvent.type(screen.getByLabelText("Для кого книга?"), "для взрослых");
    await userEvent.click(screen.getByRole("button", { name: /Добавить к задумке/ }));
    expect(p.onAnswer).toHaveBeenCalledWith("Для кого книга?", "для взрослых");
  });

  it("goes back to the idea", async () => {
    const p = renderBoard();
    await userEvent.click(screen.getByRole("button", { name: /Изменить задумку/ }));
    expect(p.onBackToIdea).toHaveBeenCalled();
  });
});

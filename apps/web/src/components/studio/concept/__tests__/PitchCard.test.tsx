import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PitchCard } from "../PitchCard";
import type { Pitch } from "@book-forge/shared";

const BASE: Pitch = {
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

function renderCard(pitch: Pitch) {
  return render(
    <PitchCard
      pitch={pitch}
      isNew={false}
      mixMode={false}
      picks={{}}
      onPick={vi.fn()}
      onChoose={vi.fn()}
      onRemove={vi.fn()}
      busy={false}
    />,
  );
}

describe("PitchCard", () => {
  it("shows «локальная: qwen:9b» for a local pitch", () => {
    renderCard({ ...BASE, generatedBy: "ollama:qwen:9b" });
    expect(screen.getByText("локальная: qwen:9b")).toBeTruthy();
  });

  it("shows no badge otherwise", () => {
    renderCard(BASE);
    expect(screen.queryByText(/локальная/)).toBeNull();
  });
});

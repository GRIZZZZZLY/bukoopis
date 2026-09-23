import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StageStepper } from "../StageStepper";
import { emptyBookConcept, emptyStudioState, type StudioState } from "@book-forge/shared";

function stateWith(
  statuses: Partial<Record<string, "complete" | "skipped">>,
): StudioState {
  const s = emptyStudioState();
  for (const [id, status] of Object.entries(statuses)) {
    s.stages[id] = { status: status!, playbookGenerated: false, aspects: [] };
  }
  return s;
}

function renderStepper(props?: Partial<Parameters<typeof StageStepper>[0]>) {
  return render(
    <MemoryRouter>
      <StageStepper
        bookId={3}
        concept={emptyBookConcept()}
        studioState={props?.studioState ?? emptyStudioState()}
        activeStageId={props?.activeStageId}
      />
    </MemoryRouter>,
  );
}

describe("StageStepper", () => {
  it("renders all 7 stages as links with correct targets", () => {
    renderStepper();
    const nav = screen.getByRole("navigation", { name: "Этапы книги" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(within(nav).getByRole("link", { name: /Замысел/ })).toHaveAttribute(
      "href",
      "/books/3/studio",
    );
    expect(within(nav).getByRole("link", { name: /Главы/ })).toHaveAttribute(
      "href",
      "/books/3/studio/chapters",
    );
    expect(within(nav).getByRole("link", { name: /Мир/ })).toHaveAttribute(
      "href",
      "/books/3/studio/world",
    );
  });

  it("подписывает статус каждого этапа словами", () => {
    renderStepper({ studioState: stateWith({ concept: "complete", world: "skipped" }) });
    // Счётчик «2/7» ушёл: у каждого этапа теперь свой статус под названием.
    expect(screen.getByRole("link", { name: /Замысел.*готов/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Мир.*пропущен/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Лор.*не начат/ })).toBeInTheDocument();
  });

  it("marks the active stage with aria-current=step", () => {
    renderStepper({ activeStageId: "lore" });
    const active = screen.getByRole("link", { name: /Лор/ });
    expect(active).toHaveAttribute("aria-current", "step");
  });

  it("no aria-current when activeStageId is undefined (e.g. settings)", () => {
    renderStepper({ activeStageId: undefined });
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("aria-current") === "step")).toBe(
      false,
    );
  });
});

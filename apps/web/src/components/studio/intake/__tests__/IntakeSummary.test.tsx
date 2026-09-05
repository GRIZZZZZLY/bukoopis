import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { IntakeSummary } from "../IntakeSummary";

const RESULT = {
  summary: [
    { target: "world" as const, label: "Мир", count: 2, titles: ["Карта", "Кухня"] },
    { target: "chapters" as const, label: "Готовые главы", count: 1, titles: ["Глава 01"] },
  ],
  ideaSet: true,
  chapters: [{ chapterId: 1, title: "Глава 01", words: 120 }],
  failures: [{ filename: "битый.md", message: "LLM failure" }],
  revision: 4,
};

function renderSummary() {
  const onDismiss = vi.fn();
  render(
    <MemoryRouter>
      <IntakeSummary result={RESULT} bookId={3} onDismiss={onDismiss} />
    </MemoryRouter>,
  );
  return onDismiss;
}

describe("IntakeSummary", () => {
  it("shows every stage that received material, with its titles", () => {
    renderSummary();
    expect(screen.getByText("Мир")).toBeInTheDocument();
    expect(screen.getByText(/Карта/)).toBeInTheDocument();
    expect(screen.getByText(/Кухня/)).toBeInTheDocument();
  });

  it("links a stage row to that stage", () => {
    renderSummary();
    expect(screen.getByRole("link", { name: /Мир/ })).toHaveAttribute("href", "/books/3/studio/world");
  });

  it("says plainly that nothing was approved automatically", () => {
    renderSummary();
    expect(screen.getByText(/ничего не утверждено/i)).toBeInTheDocument();
  });

  it("names the files it could not read, with the reason the server gave", () => {
    renderSummary();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("битый.md");
    expect(alert).toHaveTextContent("LLM failure");
    expect(alert).toHaveTextContent(/перетащить ещё раз/);
  });

  it("dismisses", async () => {
    const onDismiss = renderSummary();
    await userEvent.click(screen.getByRole("button", { name: /Понятно/ }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

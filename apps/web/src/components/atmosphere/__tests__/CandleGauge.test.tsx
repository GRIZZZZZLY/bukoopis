import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CandleGauge } from "../CandleGauge";

vi.mock("@/api/client", () => ({
  api: {
    getWritingProgress: vi
      .fn()
      .mockResolvedValue({ date: "2026-07-12", wordsAdded: 250 }),
  },
}));

describe("CandleGauge", () => {
  beforeEach(() => localStorage.clear());

  it("shows today's words and goal in accessible label", async () => {
    render(<CandleGauge />);
    const btn = await screen.findByRole("button", {
      name: /слов сегодня: 250 из 500/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("opens goal popover and saves new goal", async () => {
    const user = userEvent.setup();
    render(<CandleGauge />);
    await user.click(
      await screen.findByRole("button", { name: /слов сегодня/i }),
    );
    const input = screen.getByLabelText("Цель на день");
    await user.clear(input);
    await user.type(input, "800");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(localStorage.getItem("bf-word-goal")).toBe("800");
  });
});

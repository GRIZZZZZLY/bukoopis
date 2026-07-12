import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { shouldShowDust } from "../DustLayer";
import { CatCompanion } from "../CatCompanion";

describe("shouldShowDust", () => {
  it("only in full atmosphere and never on chapter route", () => {
    expect(shouldShowDust("full", "books")).toBe(true);
    expect(shouldShowDust("full", "chapter")).toBe(false);
    expect(shouldShowDust("calm", "books")).toBe(false);
    expect(shouldShowDust("off", "books")).toBe(false);
  });
});

describe("CatCompanion", () => {
  beforeEach(() => localStorage.clear());

  it("stretches on poke and settles back", () => {
    vi.useFakeTimers();
    render(<CatCompanion />);
    const cat = screen.getByRole("button", { name: "Погладить кота" });
    fireEvent.click(cat);
    expect(cat.className).toContain("cat-stretch");
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(cat.className).not.toContain("cat-stretch");
    vi.useRealTimers();
  });

  it("does not render under prefers-reduced-motion even in full atmosphere", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    render(<CatCompanion />);
    expect(
      screen.queryByRole("button", { name: "Погладить кота" }),
    ).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

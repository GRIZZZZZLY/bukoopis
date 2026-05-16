import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StudioPage } from "./StudioPage";
import { api } from "@/api/client";
import { emptyBookConcept, emptyStudioState } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getConcept: vi.fn(),
    getStudioState: vi.fn(),
    getStudioWarnings: vi.fn(),
    patchConcept: vi.fn(),
    refineConceptField: vi.fn(),
  },
}));

const m = vi.mocked(api);

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio"]}>
      <Routes>
        <Route path="/books/:bookId/studio" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StudioPage progress", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shows done count and a Продолжить link to the recommended stage", async () => {
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    m.getStudioWarnings.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByText(/Готово 0\/7/));
    const cont = screen.getByRole("link", { name: /Продолжить/ });
    expect(cont).toHaveAttribute("href", "/books/3/studio");
    expect(
      screen.getByRole("navigation", { name: "Этапы книги" }),
    ).toBeInTheDocument();
  });
});

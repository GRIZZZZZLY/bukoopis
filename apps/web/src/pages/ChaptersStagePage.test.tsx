import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ChaptersStagePage } from "./ChaptersStagePage";
import { api } from "@/api/client";
import { emptyBookConcept, emptyStudioState } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    listChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: vi.fn(),
    getConcept: vi.fn(),
    getStudioState: vi.fn(),
  },
}));


const m = vi.mocked(api);

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio/chapters"]}>
      <Routes>
        <Route
          path="/books/:bookId/studio/chapters"
          element={<ChaptersStagePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const book = {
  id: 3,
  title: "Тест",
  status: "draft",
  premise: null,
  styleProfileId: null,
  writerModel: "opus",
  plotModel: "sonnet",
  criticModel: "sonnet",
  writerProvider: "anthropic",
  writerLocalModel: null,
  createdAt: new Date().toISOString(),
};

describe("ChaptersStagePage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders chapter list from api", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listChapters.mockResolvedValue([
      { id: 11, title: "Глава раз", orderIndex: 10, status: "draft" },
    ] as never);
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    renderAt();
    await waitFor(() =>
      expect(screen.getByText("Глава раз")).toBeInTheDocument(),
    );
  });

  it("shows an error for a non-numeric bookId instead of an infinite skeleton", () => {
    render(
      <MemoryRouter initialEntries={["/books/abc/studio/chapters"]}>
        <Routes>
          <Route
            path="/books/:bookId/studio/chapters"
            element={<ChaptersStagePage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Книга не найдена/)).toBeInTheDocument();
    expect(m.getBook).not.toHaveBeenCalled();
  });

  it("показывает, у каких глав есть план, и ведёт к списку глав книги", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listChapters.mockResolvedValue([
      { id: 11, title: "С планом", orderIndex: 10, status: "draft", planJson: "{}", currentVersionId: null },
      { id: 12, title: "Без плана", orderIndex: 20, status: "draft", planJson: null, currentVersionId: null },
    ] as never);
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    renderAt();
    expect(await screen.findByText("план главы есть у 1 из 2")).toBeInTheDocument();
    // Правка, порядок и экспорт — в доме книги, а не в этапе.
    expect(screen.getByRole("link", { name: "Главы книги" })).toHaveAttribute(
      "href",
      "/books/3/chapters",
    );
  });
});

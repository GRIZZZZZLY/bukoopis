import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ChaptersStagePage } from "./ChaptersStagePage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    listChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: vi.fn(),
  },
}));

vi.mock("@/components/OutlinePanel", () => ({ OutlinePanel: () => <div /> }));
vi.mock("@/components/KnowledgePanel", () => ({ KnowledgePanel: () => <div /> }));
vi.mock("@/components/ImportExportPanel", () => ({ ImportExportPanel: () => <div /> }));
vi.mock("@/components/SearchPanel", () => ({ SearchPanel: () => <div /> }));

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
    renderAt();
    await waitFor(() =>
      expect(screen.getByText("Глава раз")).toBeInTheDocument(),
    );
  });

  it("adds a chapter via the form", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listChapters.mockResolvedValue([] as never);
    m.createChapter.mockResolvedValue({} as never);
    renderAt();
    await waitFor(() => screen.getByPlaceholderText("Название главы"));
    await userEvent.type(
      screen.getByPlaceholderText("Название главы"),
      "Новая",
    );
    await userEvent.click(screen.getByRole("button", { name: /Новая глава/ }));
    await waitFor(() =>
      expect(m.createChapter).toHaveBeenCalledWith(3, { title: "Новая" }),
    );
  });
});

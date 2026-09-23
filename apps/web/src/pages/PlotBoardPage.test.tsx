import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PlotBoardPage } from "./PlotBoardPage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    listBookNotes: vi.fn(),
    listChapters: vi.fn(),
  },
}));

const m = vi.mocked(api);

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/7/board"]}>
      <Routes>
        <Route path="/books/:bookId/board" element={<PlotBoardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlotBoardPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Подписи колонок — порядковые номера глав книги, поэтому доска читает
    // их список; без него она рисует номер со знаком «#».
    m.listChapters.mockResolvedValue([
      { id: 1, orderIndex: 1 },
      { id: 2, orderIndex: 2 },
      { id: 3, orderIndex: 3 },
    ] as never);
  });

  it("renders a sticky note per book note", async () => {
    m.getBook.mockResolvedValue({ id: 7, title: "Маяк" } as never);
    m.listBookNotes.mockResolvedValue([
      { id: 1, bookId: 7, kind: "thread", introduced: 1, resolved: 3,
        title: "Письмо без подписи", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 2, bookId: 7, kind: "mystery", introduced: 2, resolved: null,
        title: "Кто в башне", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ] as never);
    renderAt();
    expect(await screen.findByText("Письмо без подписи")).toBeInTheDocument();
    expect(screen.getByText("Кто в башне")).toBeInTheDocument();
  });

  it("labels each column with its chapter number", async () => {
    m.getBook.mockResolvedValue({ id: 7, title: "Маяк" } as never);
    m.listBookNotes.mockResolvedValue([
      { id: 1, bookId: 7, kind: "thread", introduced: 1, resolved: 3,
        title: "Письмо без подписи", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 2, bookId: 7, kind: "mystery", introduced: 2, resolved: null,
        title: "Кто в башне", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ] as never);
    renderAt();
    expect(await screen.findByText("гл. 1")).toBeInTheDocument();
  });

  it("marks open threads", async () => {
    m.getBook.mockResolvedValue({ id: 7, title: "Маяк" } as never);
    m.listBookNotes.mockResolvedValue([
      { id: 1, bookId: 7, kind: "thread", introduced: 1, resolved: 3,
        title: "Письмо без подписи", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
      { id: 2, bookId: 7, kind: "mystery", introduced: 2, resolved: null,
        title: "Кто в башне", body: "…", tags: [], createdAt: "2026-01-01T00:00:00.000Z" },
    ] as never);
    renderAt();
    const open = await screen.findByLabelText(/Открытая линия: Кто в башне/);
    expect(open).toBeInTheDocument();
  });

  it("shows an empty state when there are no notes", async () => {
    m.getBook.mockResolvedValue({ id: 7, title: "Маяк" } as never);
    m.listBookNotes.mockResolvedValue([] as never);
    renderAt();
    expect(await screen.findByText(/Заметок пока нет/)).toBeInTheDocument();
  });
});

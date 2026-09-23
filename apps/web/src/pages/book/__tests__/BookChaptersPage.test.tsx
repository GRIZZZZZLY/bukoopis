import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { BookChaptersPage } from "../BookChaptersPage";
import { api } from "@/api/client";
import type { BookRoomContext } from "@/components/book/BookLayout";

vi.mock("@/api/client", () => ({
  api: {
    listChapters: vi.fn(),
    createChapter: vi.fn(),
    reorderChapters: vi.fn(),
  },
  exportBookUrl: (id: number, f: string) => `/api/books/${id}/export.${f}`,
}));
vi.mock("@/components/SearchPanel", () => ({ SearchPanel: () => <div /> }));

const m = vi.mocked(api);

function renderPage(ctx: Partial<BookRoomContext> = {}) {
  const room: BookRoomContext = {
    bookId: 3,
    book: null,
    reloadBook: vi.fn(),
    openMaterials: vi.fn(),
    ...ctx,
  };
  render(
    <MemoryRouter initialEntries={["/books/3/chapters"]}>
      <Routes>
        <Route path="/books/:bookId" element={<Outlet context={room} />}>
          <Route path="chapters" element={<BookChaptersPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  return room;
}

describe("BookChaptersPage — главы в доме книги", () => {
  beforeEach(() => vi.resetAllMocks());

  it("нумерует главы по порядку в книге и подписывает статус", async () => {
    m.listChapters.mockResolvedValue([
      { id: 11, title: "Сети на рассвете", orderIndex: 10, status: "final", currentVersionId: 1, planJson: null, updatedAt: "" },
      { id: 12, title: "Капитан Горн", orderIndex: 20, status: "draft", currentVersionId: null, planJson: null, updatedAt: "" },
    ] as never);
    renderPage();
    expect(await screen.findByRole("link", { name: "Капитан Горн" })).toHaveAttribute(
      "href",
      "/books/3/chapters/12",
    );
    expect(screen.getByText("02")).toBeInTheDocument();
    expect(screen.getAllByText("готова").length).toBeGreaterThan(0);
    expect(screen.getAllByText("без версии").length).toBeGreaterThan(0);
  });

  it("создаёт главу и перечитывает шапку книги", async () => {
    m.listChapters.mockResolvedValue([] as never);
    m.createChapter.mockResolvedValue({} as never);
    const room = renderPage();
    await userEvent.click((await screen.findAllByRole("button", { name: "Новая глава" }))[0]!);
    await userEvent.type(screen.getByLabelText("Название главы"), "Отлив");
    await userEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() => expect(m.createChapter).toHaveBeenCalledWith(3, { title: "Отлив" }));
    await waitFor(() => expect(room.reloadBook).toHaveBeenCalled());
  });

  it("пустая книга предлагает добавить материалы", async () => {
    m.listChapters.mockResolvedValue([] as never);
    const room = renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Добавить материалы" }));
    expect(room.openMaterials).toHaveBeenCalled();
  });
});

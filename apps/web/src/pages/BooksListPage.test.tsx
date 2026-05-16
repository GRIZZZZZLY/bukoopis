import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BooksListPage } from "./BooksListPage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: { listBooks: vi.fn(), createBook: vi.fn() },
}));

const m = vi.mocked(api);

describe("BooksListPage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("navigates to Studio after creating a book", async () => {
    m.listBooks.mockResolvedValue([] as never);
    m.createBook.mockResolvedValue({ id: 42, title: "Новая" } as never);
    render(
      <MemoryRouter initialEntries={["/books"]}>
        <Routes>
          <Route path="/books" element={<BooksListPage />} />
          <Route
            path="/books/:bookId/studio"
            element={<div>STUDIO 42</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByLabelText("Название книги"));
    await userEvent.type(screen.getByLabelText("Название книги"), "Новая");
    await userEvent.click(screen.getByRole("button", { name: /Создать/ }));
    await waitFor(() =>
      expect(screen.getByText("STUDIO 42")).toBeInTheDocument(),
    );
  });
});

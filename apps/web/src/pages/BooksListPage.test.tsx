import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { BooksListPage } from "./BooksListPage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    listBooks: vi.fn(),
    createBook: vi.fn(),
    listRecommended: vi.fn(),
    getConcept: vi.fn(() => Promise.resolve({ idea: null, premise: { logline: "Смотритель находит рыбу" } })),
    getBooksStats: vi.fn().mockResolvedValue({
      "7": { chapters: 12, done: 6, words: 34000 },
    }),
  },
}));

const m = vi.mocked(api);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/books"]}>
      <Routes>
        <Route path="/books" element={<BooksListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("BooksListPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.listRecommended.mockResolvedValue({} as never);
    m.getConcept.mockResolvedValue({ idea: null, premise: { logline: "Смотритель находит рыбу" } } as never);
    m.getBooksStats.mockResolvedValue({
      "7": { chapters: 12, done: 6, words: 34000 },
    } as never);
  });

  it("creates a book from an idea and navigates to Studio", async () => {
    m.listBooks.mockResolvedValue([] as never);
    m.createBook.mockResolvedValue({ id: 42, title: "Новая книга" } as never);
    render(
      <MemoryRouter initialEntries={["/books"]}>
        <Routes>
          <Route path="/books" element={<BooksListPage />} />
          <Route path="/books/:bookId/studio" element={<div>STUDIO 42</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByRole("button", { name: /Новая книга/ }));
    await userEvent.click(screen.getByRole("button", { name: /Новая книга/ }));
    const start = screen.getByRole("button", { name: /Начать/ });
    expect(start).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("О чём книга?"),
      "Шестеро героев из двух враждующих миров.",
    );
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(m.createBook).toHaveBeenCalledWith({
      idea: "Шестеро героев из двух враждующих миров.",
    });
    await waitFor(() => expect(screen.getByText("STUDIO 42")).toBeInTheDocument());
  });

  const MAYAK = [{ id: 7, title: "Маяк", status: "draft", createdAt: new Date().toISOString() }];

  // jsdom не даёт WebGL — страница показывает плоскую витрину с тем же
  // поведением: книги лицом, раскрытие, аннотация.
  it("книги стоят лицом; нажатие раскрывает разворот с аннотацией и следующим шагом", async () => {
    m.listBooks.mockResolvedValue(MAYAK as never);
    m.listRecommended.mockResolvedValue({ 7: "plot" } as never);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Маяк — раскрыть" }));
    const spread = await screen.findByRole("article", { name: "Книга «Маяк»" });
    expect(spread).toHaveTextContent("Смотритель находит рыбу");
    expect(spread).toHaveTextContent("Следующий шаг");
    expect(spread).toHaveTextContent("План");
    expect(spread).toHaveTextContent("12 · готово 6");
    expect(screen.getByRole("button", { name: "Открыть книгу" })).toBeInTheDocument();
  });

  it("«Открыть книгу» ведёт в дом книги", async () => {
    m.listBooks.mockResolvedValue(MAYAK as never);
    m.listRecommended.mockResolvedValue({} as never);
    render(
      <MemoryRouter initialEntries={["/books"]}>
        <Routes>
          <Route path="/books" element={<BooksListPage />} />
          <Route path="/books/:bookId" element={<div>ДОМ КНИГИ</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Маяк — раскрыть" }));
    await userEvent.click(screen.getByRole("button", { name: "Открыть книгу" }));
    expect(await screen.findByText("ДОМ КНИГИ")).toBeInTheDocument();
  });

  it("без замысла аннотация не выдумывается", async () => {
    m.listBooks.mockResolvedValue(MAYAK as never);
    m.listRecommended.mockRejectedValue(new Error("boom") as never);
    m.getConcept.mockResolvedValue({ premise: {} } as never);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Маяк — раскрыть" }));
    expect(await screen.findByText(/Аннотация появится, когда вы утвердите замысел/)).toBeInTheDocument();
    expect(screen.getByText("книга проработана")).toBeInTheDocument();
  });

  it("клавиатура: стрелка выбирает, Enter раскрывает, Esc закрывает", async () => {
    m.listBooks.mockResolvedValue(MAYAK as never);
    m.listRecommended.mockResolvedValue({} as never);
    renderPage();
    const showcase = await screen.findByLabelText(/Витрина книг/);
    showcase.focus();
    fireEvent.keyDown(showcase, { key: "ArrowRight" });
    fireEvent.keyDown(showcase, { key: "Enter" });
    expect(await screen.findByRole("article", { name: "Книга «Маяк»" })).toBeInTheDocument();
    fireEvent.keyDown(showcase, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SettingsStagePage } from "./SettingsStagePage";
import { api } from "@/api/client";
import { emptyBookConcept, emptyStudioState } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    listStyleProfiles: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
    getConcept: vi.fn(),
    getStudioState: vi.fn(),
  },
}));

const m = vi.mocked(api);

const book = {
  id: 3,
  title: "Тест",
  status: "draft",
  premise: "СТАРЫЙ ЗАМЫСЕЛ",
  styleProfileId: null,
  writerModel: "opus",
  plotModel: "sonnet",
  criticModel: "sonnet",
  writerProvider: "anthropic",
  writerLocalModel: null,
  createdAt: new Date().toISOString(),
};

function renderAt() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio/settings"]}>
      <Routes>
        <Route
          path="/books/:bookId/studio/settings"
          element={<SettingsStagePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingsStagePage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the synopsis from the book in the Досье section", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    expect(screen.getByLabelText("Синопсис")).toHaveValue("СТАРЫЙ ЗАМЫСЕЛ");
  });

  it("shows an error for a non-numeric bookId instead of an infinite skeleton", () => {
    render(
      <MemoryRouter initialEntries={["/books/abc/studio/settings"]}>
        <Routes>
          <Route
            path="/books/:bookId/studio/settings"
            element={<SettingsStagePage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Книга не найдена/)).toBeInTheDocument();
    expect(m.getBook).not.toHaveBeenCalled();
  });

  it("saves without sending premise or world when they were not changed", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    m.updateBook.mockResolvedValue(book as never);
    m.getConcept.mockResolvedValue(emptyBookConcept() as never);
    m.getStudioState.mockResolvedValue(emptyStudioState() as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(m.updateBook).toHaveBeenCalled());
    const arg = m.updateBook.mock.calls[0]![1] as Record<string, unknown>;
    // Устаревшая вкладка не должна затирать синопсис, обновлённый в другом месте.
    expect("premise" in arg).toBe(false);
    expect("worldNotes" in arg).toBe(false);
    // Название меняет и выбор питча в Мастерской — старая вкладка его не возвращает.
    expect("title" in arg).toBe(false);
  });

  it("изменённое название уходит", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    m.updateBook.mockResolvedValue(book as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    await userEvent.clear(screen.getByLabelText("Название книги"));
    await userEvent.type(screen.getByLabelText("Название книги"), "Шлюзы");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(m.updateBook).toHaveBeenCalled());
    expect((m.updateBook.mock.calls[0]![1] as Record<string, unknown>).title).toBe("Шлюзы");
  });

  it("очищенный синопсис уходит как null", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    m.updateBook.mockResolvedValue(book as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    await userEvent.clear(screen.getByLabelText("Синопсис"));
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(m.updateBook).toHaveBeenCalled());
    const arg = m.updateBook.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg.premise).toBeNull();
    expect("worldNotes" in arg).toBe(false);
  });

  it("сохраняет синопсис и мир", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    m.updateBook.mockResolvedValue(book as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    await userEvent.clear(screen.getByLabelText("Синопсис"));
    await userEvent.type(screen.getByLabelText("Синопсис"), "Лис ищет шлюзы");
    await userEvent.type(screen.getByLabelText("Мир"), "Город на воде");
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(m.updateBook).toHaveBeenCalled());
    expect(m.updateBook.mock.calls[0]![1]).toMatchObject({
      premise: "Лис ищет шлюзы",
      worldNotes: "Город на воде",
    });
  });

  it("поле «Мир» ограничено 25000 символов и считает их", async () => {
    m.getBook.mockResolvedValue({ ...book, worldNotes: "Шлюзы" } as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    expect(screen.getByLabelText("Мир")).toHaveAttribute("maxLength", "25000");
    expect(screen.getByText("5 / 25000")).toBeInTheDocument();
  });

  it("под пустым синопсисом показывает, что модель видит из замысла", async () => {
    m.getBook.mockResolvedValue({
      ...book,
      premise: null,
      derivedPremise: "Лис ищет шлюзы\nКонфликт: Город против реки",
    } as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    expect(screen.getByText("Сейчас модель видит синопсис из замысла:")).toBeInTheDocument();
    expect(screen.getByText(/Конфликт: Город против реки/)).toBeInTheDocument();
  });

  it("при заполненном синопсисе подсказки нет", async () => {
    m.getBook.mockResolvedValue({ ...book, derivedPremise: null } as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    expect(screen.queryByText(/модель видит синопсис из замысла/)).not.toBeInTheDocument();
  });
});

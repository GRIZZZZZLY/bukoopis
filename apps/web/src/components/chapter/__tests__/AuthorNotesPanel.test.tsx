import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthorNotesPanel } from "../AuthorNotesPanel";

vi.mock("@/api/client", () => ({
  api: { updateBook: vi.fn() },
}));

import { api } from "@/api/client";

beforeEach(() => {
  vi.mocked(api.updateBook).mockReset();
  vi.mocked(api.updateBook).mockResolvedValue({} as never);
});

describe("AuthorNotesPanel", () => {
  it("показывает начальный текст и подпись о промпте", () => {
    render(<AuthorNotesPanel bookId={3} initialNotes="зонт у скамейки" delayMs={10} />);
    expect(screen.getByDisplayValue("зонт у скамейки")).toBeTruthy();
    expect(screen.getByText(/в запросы к модели не уходит/i)).toBeTruthy();
  });

  it("сохраняет набранное с задержкой", async () => {
    render(<AuthorNotesPanel bookId={3} initialNotes={null} delayMs={10} />);
    await userEvent.type(screen.getByRole("textbox"), "не забыть письмо");
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenLastCalledWith(3, {
        authorNotes: "не забыть письмо",
      }),
    );
  });

  it("пустое поле сохраняется как null", async () => {
    render(<AuthorNotesPanel bookId={3} initialNotes="x" delayMs={10} />);
    await userEvent.clear(screen.getByRole("textbox"));
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenLastCalledWith(3, { authorNotes: null }),
    );
  });

  it("не даёт заметкам, догрузившимся вместе с книгой, затереть набранный текст", async () => {
    // ChapterPage монтирует панель с initialNotes=null, пока книга ещё не
    // пришла с сервера; книга догружается и проп меняется вторым рендером.
    // Если автор успел напечатать до этого момента, догрузка не должна
    // затереть его текст — тот же класс потери, что чинили для
    // concept.idea на этапе «Замысел» (см. ConceptStage).
    const { rerender } = render(
      <AuthorNotesPanel bookId={3} initialNotes={null} delayMs={10} />,
    );
    await userEvent.type(screen.getByRole("textbox"), "не забыть письмо");

    rerender(<AuthorNotesPanel bookId={3} initialNotes="старые заметки" delayMs={10} />);

    expect(screen.getByRole("textbox")).toHaveValue("не забыть письмо");
  });

  it("подхватывает заметки, догрузившиеся вместе с книгой, пока автор ничего не печатал", async () => {
    const { rerender } = render(
      <AuthorNotesPanel bookId={3} initialNotes={null} delayMs={10} />,
    );
    rerender(<AuthorNotesPanel bookId={3} initialNotes="пришедшие заметки" delayMs={10} />);
    expect(screen.getByRole("textbox")).toHaveValue("пришедшие заметки");
  });

  it("сохраняет набранное при уходе со страницы, не дожидаясь паузы", async () => {
    const { unmount } = render(
      <AuthorNotesPanel bookId={3} initialNotes={null} delayMs={10_000} />,
    );
    await userEvent.type(screen.getByRole("textbox"), "успеть до ухода");
    // Пауза автосохранения — 10 секунд, тест столько не ждёт: без сброса на
    // размонтировании api.updateBook здесь бы вообще не вызвался.
    unmount();
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenLastCalledWith(3, {
        authorNotes: "успеть до ухода",
      }),
    );
  });

  it("сохраняет набранное при уходе фокуса, не дожидаясь паузы", async () => {
    render(<AuthorNotesPanel bookId={3} initialNotes={null} delayMs={10_000} />);
    await userEvent.type(screen.getByRole("textbox"), "правка на бегу");
    await userEvent.tab();
    await waitFor(() =>
      expect(api.updateBook).toHaveBeenLastCalledWith(3, {
        authorNotes: "правка на бегу",
      }),
    );
  });
});

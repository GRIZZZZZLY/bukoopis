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
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SettingsStagePage } from "./SettingsStagePage";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    listStyleProfiles: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
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

  it("renders settings without a Замысел/premise field", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    expect(screen.queryByText(/Замысел/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("СТАРЫЙ ЗАМЫСЕЛ")).not.toBeInTheDocument();
  });

  it("saves without sending premise", async () => {
    m.getBook.mockResolvedValue(book as never);
    m.listStyleProfiles.mockResolvedValue([] as never);
    m.updateBook.mockResolvedValue(book as never);
    renderAt();
    await waitFor(() => screen.getByDisplayValue("Тест"));
    await userEvent.click(screen.getByRole("button", { name: /Сохранить/ }));
    await waitFor(() => expect(m.updateBook).toHaveBeenCalled());
    const arg = m.updateBook.mock.calls[0]![1] as Record<string, unknown>;
    expect("premise" in arg).toBe(false);
  });
});

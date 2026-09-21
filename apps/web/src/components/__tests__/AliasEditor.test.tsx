import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AliasEditor } from "../AliasEditor";

vi.mock("@/api/client", () => ({
  api: {
    listCharacterAliases: vi.fn(),
    addCharacterAlias: vi.fn(),
    deleteAlias: vi.fn(),
  },
}));

import { api } from "@/api/client";

beforeEach(() => {
  vi.mocked(api.listCharacterAliases).mockReset();
  vi.mocked(api.addCharacterAlias).mockReset();
  vi.mocked(api.deleteAlias).mockReset();
});

describe("AliasEditor", () => {
  it("показывает имена и добавляет новое по Enter", async () => {
    vi.mocked(api.listCharacterAliases).mockResolvedValue([
      { id: 1, alias: "Ваше Сиятельство", createdAt: "2026-09-21T00:00:00Z" },
    ]);
    vi.mocked(api.addCharacterAlias).mockResolvedValue([
      { id: 1, alias: "Ваше Сиятельство", createdAt: "2026-09-21T00:00:00Z" },
      { id: 2, alias: "Алёша", createdAt: "2026-09-21T00:00:01Z" },
    ]);
    render(<AliasEditor bookId={7} characterId={3} />);
    expect(await screen.findByText("Ваше Сиятельство")).toBeTruthy();

    const input = screen.getByPlaceholderText(/прозвище/i);
    await userEvent.type(input, "Алёша{enter}");
    await waitFor(() =>
      expect(api.addCharacterAlias).toHaveBeenCalledWith(7, 3, "Алёша"),
    );
    expect(await screen.findByText("Алёша")).toBeTruthy();
  });

  it("имя, закреплённое за другим героем, объясняется словами", async () => {
    vi.mocked(api.listCharacterAliases).mockResolvedValue([]);
    vi.mocked(api.addCharacterAlias).mockRejectedValue(
      new Error("HTTP 400: bad_request — alias already maps to entity 9"),
    );
    render(<AliasEditor bookId={7} characterId={3} />);
    await screen.findByPlaceholderText(/прозвище/i);
    await userEvent.type(screen.getByPlaceholderText(/прозвище/i), "Нина{enter}");
    expect(
      await screen.findByText(/уже закреплено за другим героем/i),
    ).toBeTruthy();
  });

  it("крестик удаляет имя", async () => {
    vi.mocked(api.listCharacterAliases)
      .mockResolvedValueOnce([{ id: 5, alias: "Граф", createdAt: "x" }])
      .mockResolvedValueOnce([]);
    vi.mocked(api.deleteAlias).mockResolvedValue(undefined);
    render(<AliasEditor bookId={7} characterId={3} />);
    await screen.findByText("Граф");
    await userEvent.click(screen.getByRole("button", { name: /убрать имя «Граф»/i }));
    await waitFor(() => expect(api.deleteAlias).toHaveBeenCalledWith(7, 5));
    await waitFor(() => expect(screen.queryByText("Граф")).toBeNull());
  });
});

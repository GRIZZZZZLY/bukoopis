import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThingCanon } from "../ThingCanon";
import { api } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: {
    listItems: vi.fn(),
    listLocations: vi.fn(),
    updateItem: vi.fn(),
    updateLocation: vi.fn(),
    createItem: vi.fn(),
    createLocation: vi.fn(),
    deleteItem: vi.fn(),
    deleteLocation: vi.fn(),
  },
}));

const m = vi.mocked(api);

describe("ThingCanon — правка предметов и мест", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.listItems.mockResolvedValue([
      { id: 3, bookId: 1, name: "Трость Горна", profile: { description: "чёрная", origin: null }, createdAt: "", updatedAt: "" },
    ] as never);
    m.listLocations.mockResolvedValue([] as never);
  });

  it("сохраняет правку предмета и перечитывает список", async () => {
    m.updateItem.mockResolvedValue({} as never);
    render(<ThingCanon bookId={1} kind="item" />);
    await userEvent.type(await screen.findByLabelText("Происхождение"), "с корабля");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(m.updateItem).toHaveBeenCalledWith(3, {
        name: "Трость Горна",
        profile: { description: "чёрная", origin: "с корабля", significance: null, notes: null },
      }),
    );
    expect(m.listItems).toHaveBeenCalledTimes(2);
  });

  it("пустой список мест предлагает добавить", async () => {
    render(<ThingCanon bookId={1} kind="place" />);
    expect(await screen.findByText(/Мест пока нет/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "+ Новое место" }));
    expect(screen.getByRole("heading", { name: "Новое место" })).toBeInTheDocument();
  });
});

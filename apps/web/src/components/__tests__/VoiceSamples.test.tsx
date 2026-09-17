import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoiceSamples } from "../VoiceSamples";

const api = {
  listVoiceSamples: vi.fn(),
  createVoiceSample: vi.fn(),
  updateVoiceSample: vi.fn(),
  deleteVoiceSample: vi.fn(),
};
vi.mock("@/api/client", () => ({ api: new Proxy({}, { get: (_t, k) => api[k as keyof typeof api] }) }));

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listVoiceSamples.mockResolvedValue([]);
});

describe("VoiceSamples", () => {
  it("подписи ситуаций по-русски, внутренних кодов нет", async () => {
    api.listVoiceSamples.mockResolvedValue([
      { id: 1, characterId: 7, text: "Не надо. Я сама.", situation: "conflict",
        addresseeCharacterId: null, note: null, origin: "author", status: "accepted",
        sourceVersionId: null, sourceChapterOrder: null, bookId: 3,
        createdAt: "", updatedAt: "" },
    ]);
    render(<VoiceSamples bookId={3} characterId={7} characters={[]} />);
    expect(await screen.findByText("конфликт")).toBeTruthy();
    expect(screen.queryByText("conflict")).toBeNull();
  });

  it("добавление образца зовёт API и перечитывает список", async () => {
    api.createVoiceSample.mockResolvedValue({ id: 2 });
    render(<VoiceSamples bookId={3} characterId={7} characters={[]} />);
    await userEvent.type(await screen.findByLabelText("Текст образца"), "Хорошо.");
    await userEvent.click(screen.getByRole("button", { name: "Добавить образец" }));
    await waitFor(() => expect(api.createVoiceSample).toHaveBeenCalled());
    expect(api.listVoiceSamples).toHaveBeenCalledTimes(2);
  });

  it("предложение модели можно принять", async () => {
    api.listVoiceSamples.mockResolvedValue([
      { id: 3, characterId: 7, text: "Посмотрим.", situation: "neutral",
        addresseeCharacterId: null, note: null, origin: "llm", status: "proposed",
        sourceVersionId: null, sourceChapterOrder: null, bookId: 3,
        createdAt: "", updatedAt: "" },
    ]);
    api.updateVoiceSample.mockResolvedValue({ id: 3, status: "accepted" });
    render(<VoiceSamples bookId={3} characterId={7} characters={[]} />);
    await userEvent.click(await screen.findByRole("button", { name: "Принять" }));
    await waitFor(() =>
      expect(api.updateVoiceSample).toHaveBeenCalledWith(3, { status: "accepted" }),
    );
  });
});

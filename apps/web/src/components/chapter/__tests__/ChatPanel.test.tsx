import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "../ChatPanel";

vi.mock("@/api/client", () => ({
  api: {
    listChatThreads: vi.fn(),
    createChatThread: vi.fn(),
    deleteChatThread: vi.fn(),
    listChatMessages: vi.fn(),
  },
  streamChatMessage: vi.fn(),
}));

import { api, streamChatMessage } from "@/api/client";

const THREAD = { id: 1, bookId: 1, chapterId: 2, title: "Про Нину", createdAt: "x", updatedAt: "x" };

beforeEach(() => {
  vi.mocked(api.listChatThreads).mockReset();
  vi.mocked(api.createChatThread).mockReset();
  vi.mocked(api.listChatMessages).mockReset();
  vi.mocked(streamChatMessage).mockReset();
});

describe("ChatPanel", () => {
  it("без тредов предлагает начать разговор, создаёт тред при первой отправке", async () => {
    vi.mocked(api.listChatThreads).mockResolvedValue([]);
    vi.mocked(api.createChatThread).mockResolvedValue(THREAD);
    vi.mocked(api.listChatMessages).mockResolvedValue([]);
    vi.mocked(streamChatMessage).mockImplementation(async (_id, _content, h) => {
      h.onChunk("Она ");
      h.onChunk("уйдёт.");
      h.onDone({ message: { id: 9, threadId: 1, role: "assistant", content: "Она уйдёт.", createdAt: "x" } });
    });
    render(<ChatPanel chapterId={2} />);
    expect(await screen.findByText(/разговоров пока нет/i)).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox"), "Что дальше?");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));
    await waitFor(() => expect(api.createChatThread).toHaveBeenCalledWith(2));
    await waitFor(() => expect(streamChatMessage).toHaveBeenCalledWith(1, "Что дальше?", expect.anything()));
    expect(await screen.findByText("Она уйдёт.")).toBeTruthy();
    expect(screen.getByText("Что дальше?")).toBeTruthy();
  });

  it("тред получает настоящее название из первого сообщения, а не «Без названия»", async () => {
    // Сервер отдаёт новый тред без названия — оно выставляется из первого
    // сообщения (см. CHAT_TITLE_CHARS), но это отдельный маршрут, чей ответ
    // сюда не долетает: onDone несёт только реплику ассистента.
    const created = { ...THREAD, title: null };
    vi.mocked(api.listChatThreads).mockResolvedValue([]);
    vi.mocked(api.createChatThread).mockResolvedValue(created);
    vi.mocked(api.listChatMessages).mockResolvedValue([]);
    vi.mocked(streamChatMessage).mockImplementation(async (_id, _content, h) => {
      h.onDone({ message: { id: 9, threadId: 1, role: "assistant", content: "Она уйдёт.", createdAt: "x" } });
    });
    render(<ChatPanel chapterId={2} />);
    expect(await screen.findByText(/разговоров пока нет/i)).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox"), "Что дальше?");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));
    await waitFor(() => expect(streamChatMessage).toHaveBeenCalled());
    const select = await screen.findByLabelText("Разговор");
    expect(within(select).getByText("Что дальше?")).toBeTruthy();
    expect(within(select).queryByText("Без названия")).toBeNull();
  });

  it("показывает историю выбранного треда", async () => {
    vi.mocked(api.listChatThreads).mockResolvedValue([THREAD]);
    vi.mocked(api.listChatMessages).mockResolvedValue([
      { id: 1, threadId: 1, role: "user", content: "Почему молчит?", createdAt: "x" },
      { id: 2, threadId: 1, role: "assistant", content: "Не доверяет.", createdAt: "x" },
    ]);
    render(<ChatPanel chapterId={2} />);
    expect(await screen.findByText("Почему молчит?")).toBeTruthy();
    expect(screen.getByText("Не доверяет.")).toBeTruthy();
  });

  it("ошибку потока печатает и оставляет вопрос в поле", async () => {
    vi.mocked(api.listChatThreads).mockResolvedValue([THREAD]);
    vi.mocked(api.listChatMessages).mockResolvedValue([]);
    vi.mocked(streamChatMessage).mockImplementation(async (_id, _c, h) => h.onError("backend down"));
    render(<ChatPanel chapterId={2} />);
    await screen.findByRole("textbox");
    await userEvent.type(screen.getByRole("textbox"), "Вопрос");
    await userEvent.click(screen.getByRole("button", { name: /отправить/i }));
    expect(await screen.findByText(/backend down/)).toBeTruthy();
    expect(screen.getByDisplayValue("Вопрос")).toBeTruthy();
  });
});

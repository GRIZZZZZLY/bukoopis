import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

// Экраны настоящие, вызовы сервера — моки: любой неизвестный метод отвечает {}.
const { book, chapter, proposals, streamWriteChapter } = vi.hoisted(() => ({
  proposals: [] as unknown[],
  streamWriteChapter: vi.fn(() => Promise.resolve()),
  book: {
    id: 1,
    title: "Книга",
    language: "ru",
    premise: null,
    worldNotes: null,
    outlineJson: null,
    styleProfileId: null,
    status: "draft",
    writerModel: "opus",
    plotModel: "sonnet",
    criticModel: "sonnet",
    writerProvider: "anthropic",
    writerLocalModel: null,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  },
  chapter: {
    id: 10,
    bookId: 1,
    orderIndex: 10,
    title: "Проверка",
    status: "draft",
    currentVersionId: null as number | null,
    planJson: null,
    activePlanKind: null,
    intent: "Лис идёт к шлюзам",
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  },
}));

vi.mock("@/api/client", () => {
  const handlers: Record<string, () => unknown> = {
    getBook: () => Promise.resolve(book),
    getChapter: () => Promise.resolve(chapter),
    getStudioState: () => Promise.resolve({ schemaVersion: 1, revision: 1, stages: {} }),
    listVersions: () => Promise.resolve([]),
    listChapters: () => Promise.resolve([]),
    getWritingProgress: () => Promise.resolve({ days: [], streak: 0, todayWords: 0 }),
    listCharacters: () => Promise.resolve([]),
    listLocations: () => Promise.resolve([]),
    listItems: () => Promise.resolve([]),
    listHooks: () => Promise.resolve([]),
    listChatThreads: () => Promise.resolve([]),
    getSceneState: () =>
      Promise.resolve({ chapterId: 10, versionId: null, state: null, origin: null, updatedAt: null, carry: null }),
    getCritique: () => Promise.resolve({ report: null }),
    listProposals: () => Promise.resolve(proposals),
  };
  const api = new Proxy(
    {},
    {
      get: (_t, prop) =>
        typeof prop !== "string" || prop === "then" || prop === "__esModule"
          ? undefined
          : () => (handlers[prop] ? handlers[prop]!() : Promise.resolve({})),
    },
  );
  const noop = () => Promise.resolve();
  return {
    api,
    streamWriteChapter,
    streamQuickStart: noop,
    streamCritique: noop,
    streamRepair: noop,
    streamIntake: noop,
  };
});

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { ChapterPage } from "@/pages/ChapterPage";
import { DOSSIER_LABELS } from "@/lib/labels";

function renderPage() {
  render(
    <RouterProvider
      router={createMemoryRouter(
        [{ path: "/books/:bookId/chapters/:chapterId", element: <ChapterPage /> }],
        { initialEntries: ["/books/1/chapters/10"] },
      )}
    />,
  );
}

describe("ChapterPage без плана", () => {
  it("Написать главу доступна без плана; «По беатам» выключен", async () => {
    renderPage();
    const write = await screen.findByRole("button", { name: "Написать главу" });
    expect(write).not.toBeDisabled();
    expect(write).toHaveAttribute("title", expect.stringContaining("Будет написано по содержанию главы"));
    // Подпись видна рядом с кнопкой, а не только при наведении.
    expect(screen.getByText(DOSSIER_LABELS.writeFromContent)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Как писать" }));
    expect(screen.getByRole("checkbox", { name: /По беатам/ })).toBeDisabled();
  });

  it("без содержания подпись предупреждает, что модель продолжит от прошлой главы", async () => {
    const saved = chapter.intent;
    chapter.intent = null as unknown as string;
    try {
      renderPage();
      await screen.findByRole("button", { name: "Написать главу" });
      expect(screen.getByText(DOSSIER_LABELS.writeFromPrevious)).toBeVisible();
    } finally {
      chapter.intent = saved;
    }
  });

  describe("частично принятая глава", () => {
    beforeEach(() => {
      chapter.currentVersionId = 5;
      proposals.splice(0, proposals.length, {
        id: 7,
        acceptedVersionId: 5,
        beatsDone: 1,
        beatsTotal: 3,
      });
      streamWriteChapter.mockClear();
    });
    afterEach(() => {
      chapter.currentVersionId = null;
      proposals.length = 0;
      book.writerProvider = "anthropic";
    });

    it("наша модель: «Дописать со сцены» доступна без беат-плана", async () => {
      book.writerProvider = "ollama";
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Как писать" }));
      const resume = await screen.findByRole("menuitem", { name: "Дописать со сцены 2" });
      expect(resume).not.toBeDisabled();
      await userEvent.click(resume);
      expect(streamWriteChapter).toHaveBeenCalledWith(
        10,
        undefined,
        expect.anything(),
        expect.anything(),
        { mode: "beats", fromBeat: 1 },
      );
    });

    const FAIL = "Модель bookopis:latest недоступна в Ollama: запустите Ollama и повторите.";
    type WriteArgs = [number, unknown, { onError: (m: string) => void }, unknown, unknown];
    function failOnce() {
      toastError.mockClear();
      (streamWriteChapter as unknown as { mockImplementationOnce: (f: (...a: WriteArgs) => Promise<void>) => void })
        .mockImplementationOnce((...a: WriteArgs) => {
          a[2].onError(FAIL);
          return Promise.resolve();
        });
    }
    async function retryFromToast() {
      expect(toastError).toHaveBeenCalledWith(
        "Не удалось написать главу",
        expect.objectContaining({ description: FAIL }),
      );
      const opts = toastError.mock.calls[0]![1] as { action: { onClick: () => void } };
      opts.action.onClick();
      await waitFor(() => expect(streamWriteChapter).toHaveBeenCalledTimes(2));
    }

    it("сбой дописывания: тост с сообщением сервера, «Повторить» дописывает с той же сцены", async () => {
      book.writerProvider = "ollama";
      failOnce();
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Как писать" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Дописать со сцены 2" }));
      await retryFromToast();
      expect(streamWriteChapter).toHaveBeenLastCalledWith(
        10,
        undefined,
        expect.anything(),
        expect.anything(),
        { mode: "beats", fromBeat: 1 },
      );
    });

    it("сбой целой главы: «Повторить» снова пишет целиком", async () => {
      failOnce();
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Написать главу" }));
      await retryFromToast();
      expect(streamWriteChapter).toHaveBeenLastCalledWith(
        10,
        undefined,
        expect.anything(),
        expect.anything(),
        { mode: "whole" },
      );
    });

    it("Claude без беат-плана: «Дописать с беата» выключена", async () => {
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Как писать" }));
      expect(await screen.findByRole("menuitem", { name: "Дописать с беата 2" })).toBeDisabled();
    });
  });
});

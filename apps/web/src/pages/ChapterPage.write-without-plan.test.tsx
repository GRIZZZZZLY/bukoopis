import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

// Экраны настоящие, вызовы сервера — моки: любой неизвестный метод отвечает {}.
const { book, chapter } = vi.hoisted(() => ({
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
    currentVersionId: null,
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
    streamWriteChapter: noop,
    streamQuickStart: noop,
    streamCritique: noop,
    streamRepair: noop,
    streamIntake: noop,
  };
});

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
});

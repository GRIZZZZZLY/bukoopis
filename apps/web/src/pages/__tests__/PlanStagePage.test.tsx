import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PlanStagePage } from "../PlanStagePage";

vi.mock("@/api/client", () => ({
  api: {
    getBook: vi.fn(),
    getConcept: vi.fn(),
    getStudioState: vi.fn(),
    generateBookOutline: vi.fn(),
    selectBookOutline: vi.fn(),
    approvePlan: vi.fn(),
  },
}));

import { api } from "@/api/client";

const BOOK = {
  id: 3,
  title: "Инженеры тишины",
  language: "ru",
  premise: "p",
  outlineJson: JSON.stringify({
    variants: [
      {
        label: "из ваших материалов: Оглавление",
        estimatedChapters: 2,
        source: "author_material",
        chapters: [
          { title: "Порог", pov: "Рин", goal: "Уйти незамеченной" },
          { title: "Мост" },
        ],
      },
      { label: "сгенерированный", logline: "Логлайн", estimatedChapters: 12 },
    ],
    selectedIndex: 0,
    generatedAt: "2026-09-06T10:00:00.000Z",
  }),
  styleProfileId: null,
  status: "draft",
  writerModel: "opus",
  plotModel: "sonnet",
  criticModel: "sonnet",
  writerProvider: "anthropic",
  writerLocalModel: null,
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

const STUDIO_WITH_NOTE = {
  schemaVersion: 1 as const,
  revision: 4,
  stages: {
    plot: {
      status: "in_progress" as const,
      playbookGenerated: false,
      aspects: [
        {
          id: "a1",
          name: "Мысли о структуре",
          status: "reviewing" as const,
          order: 0,
          required: false,
          source: "import" as const,
          payloadKind: "markdown" as const,
          variants: [
            {
              id: "v1",
              label: "из ваших материалов",
              payloadKind: "markdown" as const,
              payload: "Хочу три части.",
              status: "generated" as const,
              editSource: "manual" as const,
              generatedAt: "2026-09-06T00:00:00.000Z",
            },
          ],
        },
      ],
    },
  },
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/books/3/studio/plot"]}>
      <Routes>
        <Route path="/books/:bookId/studio/:stageId" element={<PlanStagePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getBook).mockResolvedValue(BOOK as never);
  vi.mocked(api.getConcept).mockResolvedValue({ schemaVersion: 1, pitches: [] } as never);
  vi.mocked(api.getStudioState).mockResolvedValue(STUDIO_WITH_NOTE as never);
  vi.mocked(api.approvePlan).mockResolvedValue({ created: 2, updated: 0, chapters: [] } as never);
});

describe("PlanStagePage", () => {
  it("показывает поглавные строки выбранного варианта", async () => {
    renderPage();
    expect(await screen.findByText("Порог")).toBeInTheDocument();
    expect(screen.getByText(/Рин/)).toBeInTheDocument();
    expect(screen.getByText("Мост")).toBeInTheDocument();
  });

  it("помечает вариант, пришедший из материалов автора", async () => {
    renderPage();
    // Слова стоят и в подписи варианта (её дал интейк), и отдельным бейджем от
    // поля source: подпись автор может переписать, а source — нет.
    expect((await screen.findAllByText(/из ваших материалов/i)).length).toBeGreaterThan(0);
  });

  it("показывает заметки, приземлённые интейком на этап сюжета", async () => {
    renderPage();
    expect(await screen.findByText("Мысли о структуре")).toBeInTheDocument();
    expect(screen.getByText(/Хочу три части/)).toBeInTheDocument();
  });

  it("утверждает план и сообщает, сколько глав создано", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Утвердить план" }));
    await waitFor(() => expect(api.approvePlan).toHaveBeenCalledWith(3));
    expect(await screen.findByText(/создано глав: 2/i)).toBeInTheDocument();
  });

  it("без поглавных строк кнопка утверждения недоступна и сказано почему", async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...BOOK,
      outlineJson: JSON.stringify({
        variants: [{ label: "только синопсис", estimatedChapters: 10 }],
        selectedIndex: 0,
        generatedAt: "2026-09-06T10:00:00.000Z",
      }),
    } as never);
    renderPage();
    expect(await screen.findByRole("button", { name: "Утвердить план" })).toBeDisabled();
    expect(screen.getByText(/нет поглавных строк/i)).toBeInTheDocument();
  });

  it("без выбранного варианта утверждать нечего", async () => {
    vi.mocked(api.getBook).mockResolvedValue({
      ...BOOK,
      outlineJson: JSON.stringify({
        variants: [{ label: "в", estimatedChapters: 2, chapters: [{ title: "Порог" }] }],
        selectedIndex: null,
        generatedAt: "2026-09-06T10:00:00.000Z",
      }),
    } as never);
    renderPage();
    expect(await screen.findByRole("button", { name: "Утвердить план" })).toBeDisabled();
  });
});

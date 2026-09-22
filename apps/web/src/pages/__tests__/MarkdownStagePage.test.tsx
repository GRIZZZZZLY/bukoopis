import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { MarkdownStagePage } from "../MarkdownStagePage";
import { api } from "@/api/client";
import { emptyBookConcept, emptyStudioState } from "@book-forge/shared";
import type { StageState } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getStudioState: vi.fn(),
    getConcept: vi.fn(),
    patchStudioState: vi.fn(),
  },
  streamStageDocument: vi.fn(),
}));

const m = vi.mocked(api);

function renderStage(stageOver: Partial<StageState>) {
  const stage: StageState = {
    status: "not_started",
    playbookGenerated: false,
    aspects: [],
    ...stageOver,
  };
  const studio = { ...emptyStudioState(), stages: { world: stage } };
  m.getStudioState.mockResolvedValue(studio as never);
  m.getConcept.mockResolvedValue(emptyBookConcept() as never);
  return render(
    <MemoryRouter initialEntries={["/books/3/studio/world"]}>
      <Routes>
        <Route path="/books/:bookId/studio/:stageId" element={<MarkdownStagePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MarkdownStagePage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("этап открывается сразу документом, без шага «сначала план»", async () => {
    // Пустой этап: раньше здесь стоял PlaybookRunner и требовал отдельного
    // вызова модели за списком разделов.
    renderStage({ status: "not_started", playbookGenerated: false, aspects: [] });
    expect(await screen.findByRole("button", { name: "Собрать мир" })).toBeInTheDocument();
    expect(screen.queryByText(/план этапа/i)).not.toBeInTheDocument();
  });

  it("пропущенный этап говорит «не нужен» и возвращается", async () => {
    renderStage({ status: "skipped", playbookGenerated: false, aspects: [] });
    expect(await screen.findByText(/не нужен/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Вернуть этап" })).toBeInTheDocument();
  });
});

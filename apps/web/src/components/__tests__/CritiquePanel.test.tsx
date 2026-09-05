import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CritiquePanel } from "../CritiquePanel";
import type { CritiqueReport, ProseProposal } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    getCritique: vi.fn(),
    runCritique: vi.fn(),
    getProposalChanges: vi.fn(),
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
    cancelProposal: vi.fn(),
  },
  streamRepair: vi.fn(),
}));

import { api, streamRepair } from "@/api/client";

const REPORT: CritiqueReport = {
  id: 1,
  chapterVersionId: 10,
  status: "done",
  report: {
    critics: [{ critic: "canon", overallNotes: "ок", issues: [] }],
    requestedCritics: ["canon", "style", "editor", "reader"],
    failedCritics: [],
    blockingCount: 1,
    suggestionCount: 0,
    nitCount: 0,
    generatedAt: "2026-09-05T10:00:00.000Z",
  },
  errorMessage: null,
  createdAt: "2026-09-05T10:00:00.000Z",
  completedAt: "2026-09-05T10:00:00.000Z",
};

const REPAIR_PROPOSAL: ProseProposal = {
  id: 42,
  bookId: 1,
  chapterId: 2,
  kind: "repair",
  status: "ready",
  baseVersionId: 10,
  baseDraftRevision: 7,
  contextFingerprint: "fp",
  contentText: "Один.\n\nДва.",
  contentJson: "{}",
  wordCount: 2,
  completion: "confirmed",
  stopReason: "end_turn",
  modelId: "test",
  backend: "anthropic",
  acceptedVersionId: null,
  acceptRequestId: null,
  errorMessage: null,
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T10:01:00.000Z",
};

const REPAIR_CHANGES = [
  {
    id: "c0",
    kind: "replace" as const,
    baseFrom: 0,
    baseTo: 1,
    baseText: ["Было."],
    candidateText: ["Один."],
  },
];

beforeEach(() => {
  vi.mocked(api.getCritique).mockReset().mockResolvedValue(REPORT);
  vi.mocked(api.getProposalChanges)
    .mockReset()
    .mockResolvedValue({ baseVersionId: 10, changes: REPAIR_CHANGES });
  vi.mocked(api.acceptProposal)
    .mockReset()
    .mockResolvedValue({ version: { id: 99 }, replayed: false } as never);
  vi.mocked(streamRepair)
    .mockReset()
    .mockImplementation(async (_versionId, _severities, handlers) => {
      handlers.onProposal?.(42);
      await handlers.onDone({ proposal: REPAIR_PROPOSAL, cancelled: false });
    });
});

describe("CritiquePanel — self-repair proposal wiring", () => {
  it("fetches the repair candidate's own change list instead of showing an empty diff", async () => {
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={7}
        onRepairDone={vi.fn()}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Запустить self-repair" }),
    );

    expect(api.getProposalChanges).toHaveBeenCalledWith(42);
    expect(await screen.findByText(/Что меняется/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Один\./ })).toBeInTheDocument();
  });

  it("accepts a repair candidate against the real draft revision, not a hardcoded null", async () => {
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={7}
        onRepairDone={vi.fn()}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Запустить self-repair" }),
    );
    await screen.findByText(/Что меняется/i);
    await userEvent.click(
      screen.getByRole("button", { name: "Принять целиком" }),
    );

    expect(api.acceptProposal).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        expectedVersionId: 10,
        expectedDraftRevision: 7,
      }),
    );
  });
});

const ERROR_REPORT: CritiqueReport = {
  id: 2,
  chapterVersionId: 10,
  status: "error",
  // Отчёт пишется всегда, даже когда не ответил никто: раньше панель гасила
  // сообщение об отказе по `!report.report` и рисовала зелёный отчёт из нуля
  // критиков.
  report: {
    critics: [],
    requestedCritics: ["canon", "style", "editor", "reader"],
    failedCritics: ["canon", "style", "editor", "reader"],
    blockingCount: 0,
    suggestionCount: 0,
    nitCount: 0,
    generatedAt: "2026-09-05T10:00:00.000Z",
  },
  errorMessage: "[canon] таймаут | [style] таймаут | [editor] таймаут | [reader] таймаут",
  createdAt: "2026-09-05T10:00:00.000Z",
  completedAt: "2026-09-05T10:00:00.000Z",
};

const PARTIAL_REPORT: CritiqueReport = {
  id: 3,
  chapterVersionId: 10,
  status: "partial",
  report: {
    critics: [{ critic: "canon", overallNotes: "ок", issues: [] }],
    requestedCritics: ["canon", "style"],
    failedCritics: ["style"],
    blockingCount: 0,
    suggestionCount: 0,
    nitCount: 0,
    generatedAt: "2026-09-05T10:00:00.000Z",
  },
  errorMessage: "[style] таймаут",
  createdAt: "2026-09-05T10:00:00.000Z",
  completedAt: "2026-09-05T10:00:00.000Z",
};

function renderPanel() {
  render(
    <CritiquePanel
      versionId={10}
      expectedVersionId={10}
      expectedDraftRevision={7}
      onRepairDone={vi.fn()}
    />,
  );
}

describe("CritiquePanel — честный статус разбора", () => {
  it("четыре падения из четырёх не выглядят зелёным отчётом", async () => {
    vi.mocked(api.getCritique).mockResolvedValue(ERROR_REPORT);
    renderPanel();

    expect(
      await screen.findByText(/ни один критик не ответил/i),
    ).toBeInTheDocument();
    // Кого просили — названо поимённо.
    expect(screen.getByText(/Canon Guard, Style, Editor, Reader/)).toBeInTheDocument();
    expect(screen.getByText(/\[canon\] таймаут/)).toBeInTheDocument();
    // Ни счётчиков «blocking: 0», ни блока self-repair над пустым отчётом.
    expect(screen.queryByText(/blocking:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Запустить self-repair" }),
    ).not.toBeInTheDocument();
  });

  it("частичный разбор назван частичным, с именем отвалившегося критика", async () => {
    vi.mocked(api.getCritique).mockResolvedValue(PARTIAL_REPORT);
    renderPanel();

    expect(await screen.findByText(/Разбор неполный/i)).toBeInTheDocument();
    expect(screen.getByText(/не ответили Style/)).toBeInTheDocument();
    expect(screen.getByText(/Ответили 1 из 2/)).toBeInTheDocument();
    // То, что успело ответить, всё-таки показано.
    expect(screen.getByText(/Canon Guard · 0 замечаний/)).toBeInTheDocument();
  });

  it("полный разбор не поминает ни отказов, ни неполноты", async () => {
    renderPanel();
    expect(await screen.findByText(/blocking: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Разбор неполный/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ни один критик не ответил/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Ответили 1 из 4/)).toBeInTheDocument();
  });
});

describe("CritiquePanel — остановка self-repair", () => {
  it("идущий self-repair можно остановить по кнопке", async () => {
    vi.mocked(api.cancelProposal).mockReset().mockResolvedValue({ stopping: true });
    // Поток, который сообщает id кандидата и дальше молчит, — это и есть
    // «Reviser пишет»: именно в этот момент нужна кнопка.
    let finish: (() => void) | undefined;
    vi.mocked(streamRepair).mockImplementation(
      async (_versionId, _severities, handlers) => {
        handlers.onProposal?.(42);
        await new Promise<void>((resolve) => {
          finish = () => {
            handlers.onDone({ proposal: REPAIR_PROPOSAL, cancelled: true });
            resolve();
          };
        });
      },
    );
    renderPanel();

    await userEvent.click(
      await screen.findByRole("button", { name: "Запустить self-repair" }),
    );
    const stop = await screen.findByRole("button", { name: "Остановить" });
    await userEvent.click(stop);
    expect(api.cancelProposal).toHaveBeenCalledWith(42);

    finish?.();
    expect(
      await screen.findByText(/Self-repair остановлен/i),
    ).toBeInTheDocument();
    // Остановленного кандидата принять нельзя — его и не предлагают.
    expect(
      screen.queryByRole("button", { name: "Принять целиком" }),
    ).not.toBeInTheDocument();
  });
});

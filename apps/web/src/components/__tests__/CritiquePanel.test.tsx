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
    skippedCritics: [],
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
  beatsDone: null,
  beatsTotal: null,
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

describe("CritiquePanel — правка: привязка кандидата", () => {
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
      await screen.findByRole("button", { name: "Исправить главу" }),
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
      await screen.findByRole("button", { name: "Исправить главу" }),
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
skippedCritics: [],
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
skippedCritics: [],
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
    // Ни счётчиков «blocking: 0», ни блока правка над пустым отчётом.
    expect(screen.queryByText(/blocking:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Исправить главу" }),
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

describe("CritiquePanel — остановка правки", () => {
  it("идущую правку можно остановить по кнопке", async () => {
    vi.mocked(api.cancelProposal).mockReset().mockResolvedValue({ stopping: true });
    // Поток, который сообщает id кандидата и дальше молчит, — это и есть
    // «Идёт правка…»: именно в этот момент нужна кнопка.
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
      await screen.findByRole("button", { name: "Исправить главу" }),
    );
    const stop = await screen.findByRole("button", { name: "Остановить" });
    await userEvent.click(stop);
    expect(api.cancelProposal).toHaveBeenCalledWith(42);

    finish?.();
    expect(
      await screen.findByText(/Правка остановлена/i),
    ).toBeInTheDocument();
    // Остановленного кандидата принять нельзя — его и не предлагают.
    expect(
      screen.queryByRole("button", { name: "Принять целиком" }),
    ).not.toBeInTheDocument();
  });
});

// Пропущенный критик — третье состояние: не ответил и не упал. Без строки в
// панели непроверенное выглядит проверенным (ТЗ 10, этап 5).
describe("CritiquePanel — пропущенные критики", () => {
  beforeEach(() => {
    vi.mocked(api.runCritique).mockReset();
    vi.mocked(api.getCritique).mockReset();
  });

  it("называет, кого не запускали и почему", async () => {
    vi.mocked(api.getCritique).mockResolvedValue({
      ...REPORT,
      report: {
        ...REPORT.report!,
        requestedCritics: ["canon"],
        skippedCritics: ["character"],
      },
    });
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={null}
        onRepairDone={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Не запускались: Персонажи/)).toBeInTheDocument();
  });

  it("пустой список пропущенных строки не рисует", async () => {
    vi.mocked(api.getCritique).mockResolvedValue({
      ...REPORT,
      report: { ...REPORT.report!, skippedCritics: [] },
    });
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={null}
        onRepairDone={vi.fn()}
      />,
    );
    await screen.findByText(/Просили:/);
    expect(screen.queryByText(/Не запускались/)).not.toBeInTheDocument();
  });
});

// Замечание критика персонажей несёт больше, чем summary и цитата: кого
// касается, на чём основано и что стоит сохранить. Не показать это значит
// собрать данные и спрятать их от автора.
describe("CritiquePanel — замечание критика персонажей", () => {
  beforeEach(() => {
    vi.mocked(api.getCritique).mockReset();
  });

  it("печатает героев, основание и что сохранить", async () => {
    vi.mocked(api.getCritique).mockResolvedValue({
      ...REPORT,
      report: {
        ...REPORT.report!,
        critics: [
          {
            critic: "character",
            overallNotes: "Двое звучат одинаково",
            issues: [
              {
                severity: "suggestion",
                summary: "Нина и Ворт уходят от ответа одинаково",
                excerpt: "— Не знаю. — Не знаю.",
                suggestion: "Разведите способ уклонения",
                category: "interchangeable",
                affectedCharacters: ["Нина", "Ворт"],
                basis: "у Ворта принцип «не врать прямо», у Нины его нет",
                whyHere: "сцена про то, кто сломается первым",
                alternativeReading: "оба молчат от усталости",
                keep: "пауза перед вторым «не знаю»",
              },
            ],
          },
        ],
      },
    });
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={null}
        onRepairDone={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Нина, Ворт/)).toBeInTheDocument();
    expect(screen.getByText(/не врать прямо/)).toBeInTheDocument();
    expect(screen.getByText(/пауза перед вторым/)).toBeInTheDocument();
    expect(screen.getByText(/оба молчат от усталости/)).toBeInTheDocument();
  });

  it("замечание старого критика лишних подписей не получает", async () => {
    vi.mocked(api.getCritique).mockResolvedValue({
      ...REPORT,
      report: {
        ...REPORT.report!,
        critics: [
          {
            critic: "style",
            overallNotes: "норм",
            issues: [{ severity: "nit", summary: "мелочь" }],
          },
        ],
      },
    });
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={null}
        onRepairDone={vi.fn()}
      />,
    );
    await screen.findAllByText("мелочь");
    expect(screen.queryByText(/Герои:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Основание:/)).not.toBeInTheDocument();
  });
});

// ───────── Локальная правка (этап 5, слайс 3) ─────────
describe("CritiquePanel — выбор замечаний и защита кусков", () => {
  const TWO_ISSUES: CritiqueReport = {
    ...REPORT,
    report: {
      ...REPORT.report!,
      blockingCount: 1,
      suggestionCount: 1,
      critics: [
        {
          critic: "character",
          overallNotes: "заметки",
          issues: [
            { severity: "blocking", summary: "Ворт знает лишнее" },
            { severity: "suggestion", summary: "мелочь про паузу" },
          ],
        },
      ],
    },
  };

  beforeEach(() => {
    vi.mocked(api.getCritique).mockReset();
    vi.mocked(streamRepair).mockReset();
    vi.mocked(streamRepair).mockResolvedValue(undefined);
  });

  async function openPanel() {
    vi.mocked(api.getCritique).mockResolvedValue(TWO_ISSUES);
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={7}
        onRepairDone={vi.fn()}
      />,
    );
    await screen.findByText("Ворт знает лишнее");
  }

  it("отмеченное замечание уезжает в правку, неотмеченное — нет", async () => {
    await openPanel();
    await userEvent.click(screen.getByLabelText("Править это замечание: Ворт знает лишнее"));
    await userEvent.click(screen.getByRole("button", { name: /Исправить главу/ }));
    const opts = vi.mocked(streamRepair).mock.calls[0]?.[1];
    expect(opts?.selectedIssueIds).toEqual(["character:0"]);
  });

  it("без отметок правка идёт по-старому, фильтром серьёзности", async () => {
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: /Исправить главу/ }));
    const opts = vi.mocked(streamRepair).mock.calls[0]?.[1];
    expect(opts?.selectedIssueIds).toBeUndefined();
    expect(opts?.severities).toBeTruthy();
  });

  it("защищённые куски уезжают построчно, пустые строки выбрасываются", async () => {
    await openPanel();
    await userEvent.type(
      screen.getByLabelText(/Не трогать/),
      "Металл был тёплый.{enter}{enter}Она не обернулась.",
    );
    await userEvent.click(screen.getByRole("button", { name: /Исправить главу/ }));
    const opts = vi.mocked(streamRepair).mock.calls[0]?.[1];
    expect(opts?.protectedFragments).toEqual([
      "Металл был тёплый.",
      "Она не обернулась.",
    ]);
  });
});

describe("CritiquePanel — выбор критиков", () => {
  it("sends the explicit list when one of all critics is unchecked, not the server default", async () => {
    const { ALL_CRITIC_TYPES, CRITIC_LABELS } = await import("@book-forge/shared");
    vi.mocked(api.runCritique).mockReset().mockResolvedValue(REPORT);
    render(
      <CritiquePanel
        versionId={10}
        expectedVersionId={10}
        expectedDraftRevision={7}
        onRepairDone={vi.fn()}
      />,
    );
    const dropped = ALL_CRITIC_TYPES[ALL_CRITIC_TYPES.length - 1]!;
    await userEvent.click(await screen.findByRole("checkbox", { name: CRITIC_LABELS[dropped] }));
    await userEvent.click(screen.getByRole("button", { name: "Запустить критику" }));

    const sent = vi.mocked(api.runCritique).mock.calls[0]![1];
    expect(sent).toEqual(ALL_CRITIC_TYPES.filter((c) => c !== dropped));
  });
});

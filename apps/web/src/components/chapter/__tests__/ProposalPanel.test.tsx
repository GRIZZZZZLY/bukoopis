import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalPanel, type ProposalReread } from "../ProposalPanel";
import type { ProseProposal } from "@book-forge/shared";

vi.mock("@/api/client", () => ({
  api: {
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
    cancelProposal: vi.fn(),
    getProposalChanges: vi.fn(),
  },
}));

import { api } from "@/api/client";

const PROPOSAL: ProseProposal = {
  id: 5,
  bookId: 1,
  chapterId: 2,
  kind: "write",
  status: "ready",
  baseVersionId: 9,
  baseDraftRevision: null,
  contextFingerprint: "fp",
  contentText: "Раз.\n\nВторой.\n\nТри.",
  contentJson: "{}",
  wordCount: 3,
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

const CHANGES = [
  { id: "c0", kind: "replace" as const, baseFrom: 1, baseTo: 2, baseText: ["Два."], candidateText: ["Второй."] },
  { id: "c1", kind: "insert" as const, baseFrom: 3, baseTo: 3, baseText: [], candidateText: ["Четыре."] },
];

function renderPanel(
  overrides: Partial<ProseProposal> = {},
  onReread?: () => Promise<ProposalReread>,
) {
  const onAccepted = vi.fn();
  const onRejected = vi.fn();
  render(
    <ProposalPanel
      proposal={{ ...PROPOSAL, ...overrides }}
      changes={CHANGES}
      expectedVersionId={9}
      expectedDraftRevision={null}
      {...(onReread ? { onReread } : {})}
      onAccepted={onAccepted}
      onRejected={onRejected}
    />,
  );
  return { onAccepted, onRejected };
}

/** 409 сервера: причину он называет сам, вкладка её не угадывает. */
function conflict(reason: string): Error {
  return Object.assign(new Error(`HTTP 409: ... [${reason}]`), {
    status: 409,
    reason,
  });
}

beforeEach(() => {
  vi.mocked(api.acceptProposal).mockReset();
  vi.mocked(api.rejectProposal).mockReset();
  vi.mocked(api.acceptProposal).mockResolvedValue({
    version: { id: 12 },
    replayed: false,
  } as never);
});

describe("ProposalPanel", () => {
  it("говорит, что глава ещё не изменена", () => {
    renderPanel();
    expect(screen.getByText(/не изменена, пока вы не примете/i)).toBeInTheDocument();
  });

  it("принимает кандидата целиком", async () => {
    const { onAccepted } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(api.acceptProposal).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ expectedVersionId: 9, expectedDraftRevision: null }),
    );
    expect(vi.mocked(api.acceptProposal).mock.calls[0]?.[1]).not.toHaveProperty(
      "selectedChangeIds",
    );
    expect(onAccepted).toHaveBeenCalled();
  });

  it("принимает только отмеченные правки", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("checkbox", { name: /Второй\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Принять выбранное" }));
    expect(api.acceptProposal).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ selectedChangeIds: ["c0"] }),
    );
  });

  it("«Принять выбранное» недоступно, пока ничего не выбрано", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Принять выбранное" })).toBeDisabled();
  });

  it("повторный клик по «Принять целиком» шлёт тот же requestId", async () => {
    vi.mocked(api.acceptProposal).mockRejectedValueOnce(new Error("сеть"));
    renderPanel();
    const button = screen.getByRole("button", { name: "Принять целиком" });
    await userEvent.click(button);
    await userEvent.click(button);
    const calls = vi.mocked(api.acceptProposal).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1].requestId).toBe(calls[1]?.[1].requestId);
  });

  it("незавершённый кандидат помечен и требует подтверждения", async () => {
    renderPanel({ status: "incomplete", completion: "unconfirmed", stopReason: "max_tokens" });
    expect(screen.getByText(/завершение не подтверждено/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    const body = vi.mocked(api.acceptProposal).mock.calls[0]?.[1];
    // Согласие ровно на своё: неподтверждённое завершение — да, уехавшая
    // база контекста — нет, её автор ещё не видел.
    expect(body?.acknowledgeUnconfirmed).toBe(true);
    expect(body?.acknowledgeContextDrift).toBe(false);
  });

  it("конфликт версии объясняется словами, а не кодом 409", async () => {
    vi.mocked(api.acceptProposal).mockRejectedValueOnce(conflict("version"));
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(
      await screen.findByText(/текущая версия главы изменилась/i),
    ).toBeInTheDocument();
  });

  it("отклонение зовёт маршрут отклонения", async () => {
    const { onRejected } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    expect(api.rejectProposal).toHaveBeenCalledWith(5);
    expect(onRejected).toHaveBeenCalled();
  });
});

describe("ProposalPanel — выход из 409", () => {
  it("409 по черновику даёт перечитать главу и принять тем же requestId", async () => {
    vi.mocked(api.acceptProposal)
      .mockRejectedValueOnce(conflict("draft"))
      .mockResolvedValueOnce({ version: { id: 77 }, replayed: false } as never);
    const onReread = vi.fn(async () => ({
      expectedVersionId: 9,
      expectedDraftRevision: 12,
      changes: CHANGES,
    }));
    const { onAccepted } = renderPanel({}, onReread);

    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(await screen.findByText(/черновик изменился/i)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Перечитать главу и принять ещё раз" }),
    );

    expect(onReread).toHaveBeenCalled();
    const calls = vi.mocked(api.acceptProposal).mock.calls;
    expect(calls).toHaveLength(2);
    // Перечитанная ревизия ушла на сервер…
    expect(calls[1]?.[1].expectedDraftRevision).toBe(12);
    // …а ключ запроса тот же: это повтор одного принятия, а не второе.
    expect(calls[1]?.[1].requestId).toBe(calls[0]?.[1].requestId);
    expect(onAccepted).toHaveBeenCalledWith(77);
  });

  it("перечитывание сохраняет выбранные абзацы, а не сбрасывает их", async () => {
    vi.mocked(api.acceptProposal)
      .mockRejectedValueOnce(conflict("version"))
      .mockResolvedValueOnce({ version: { id: 78 }, replayed: false } as never);
    const onReread = vi.fn(async () => ({
      expectedVersionId: 31,
      expectedDraftRevision: null,
      changes: CHANGES,
    }));
    renderPanel({}, onReread);

    await userEvent.click(screen.getByRole("checkbox", { name: /Второй\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Принять выбранное" }));
    await screen.findByText(/текущая версия главы изменилась/i);
    await userEvent.click(
      screen.getByRole("button", { name: "Перечитать главу и принять ещё раз" }),
    );

    const calls = vi.mocked(api.acceptProposal).mock.calls;
    expect(calls[1]?.[1].selectedChangeIds).toEqual(["c0"]);
    expect(calls[1]?.[1].expectedVersionId).toBe(31);
  });

  it("если правки после перечитывания исчезли, выбор просят сделать заново", async () => {
    vi.mocked(api.acceptProposal).mockRejectedValueOnce(conflict("draft"));
    const onReread = vi.fn(async () => ({
      expectedVersionId: 9,
      expectedDraftRevision: 2,
      // Прежнего «c0» больше нет: глава уехала сильнее самих правок.
      changes: [
        {
          id: "c9",
          kind: "insert" as const,
          baseFrom: 0,
          baseTo: 0,
          baseText: [],
          candidateText: ["Иное."],
        },
      ],
    }));
    renderPanel({}, onReread);

    await userEvent.click(screen.getByRole("checkbox", { name: /Второй\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Принять выбранное" }));
    await screen.findByText(/черновик изменился/i);
    await userEvent.click(
      screen.getByRole("button", { name: "Перечитать главу и принять ещё раз" }),
    );

    expect(
      await screen.findByText(/Отметьте изменения заново/i),
    ).toBeInTheDocument();
    // Второго принятия не случилось: молча принять «то же самое» нельзя.
    expect(vi.mocked(api.acceptProposal).mock.calls).toHaveLength(1);
  });

  it("уехавшая база контекста — отдельный вопрос и отдельное согласие", async () => {
    vi.mocked(api.acceptProposal)
      .mockRejectedValueOnce(conflict("stale"))
      .mockResolvedValueOnce({ version: { id: 80 }, replayed: false } as never);
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(
      await screen.findByText(/база, от которой считался кандидат, изменилась/i),
    ).toBeInTheDocument();
    // Первая попытка согласия на снос базы не давала.
    expect(
      vi.mocked(api.acceptProposal).mock.calls[0]?.[1].acknowledgeContextDrift,
    ).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Всё равно принять" }));
    const second = vi.mocked(api.acceptProposal).mock.calls[1]?.[1];
    expect(second?.acknowledgeContextDrift).toBe(true);
    // Подтверждённое завершение вторым флагом не подменяется.
    expect(second?.acknowledgeUnconfirmed).toBe(false);
  });

  it("неподтверждённый кандидат с уехавшей базой спрашивает про базу отдельно", async () => {
    vi.mocked(api.acceptProposal)
      .mockRejectedValueOnce(conflict("stale"))
      .mockResolvedValueOnce({ version: { id: 81 }, replayed: false } as never);
    renderPanel({ status: "incomplete", completion: "unconfirmed" });

    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    // Согласие на обрыв уже дано, а на уехавшую базу — ещё нет: раньше один
    // флаг делал вид, что дано и то и другое.
    const first = vi.mocked(api.acceptProposal).mock.calls[0]?.[1];
    expect(first?.acknowledgeUnconfirmed).toBe(true);
    expect(first?.acknowledgeContextDrift).toBe(false);

    await userEvent.click(
      await screen.findByRole("button", { name: "Всё равно принять" }),
    );
    const second = vi.mocked(api.acceptProposal).mock.calls[1]?.[1];
    expect(second?.acknowledgeUnconfirmed).toBe(true);
    expect(second?.acknowledgeContextDrift).toBe(true);
  });
});

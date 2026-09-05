import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProposalPanel } from "../ProposalPanel";
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

function renderPanel(overrides: Partial<ProseProposal> = {}) {
  const onAccepted = vi.fn();
  const onRejected = vi.fn();
  render(
    <ProposalPanel
      proposal={{ ...PROPOSAL, ...overrides }}
      changes={CHANGES}
      expectedVersionId={9}
      expectedDraftRevision={null}
      onAccepted={onAccepted}
      onRejected={onRejected}
    />,
  );
  return { onAccepted, onRejected };
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
    expect(vi.mocked(api.acceptProposal).mock.calls[0]?.[1].acknowledgeStale).toBe(true);
  });

  it("конфликт версии объясняется словами, а не кодом 409", async () => {
    vi.mocked(api.acceptProposal).mockRejectedValueOnce(
      Object.assign(new Error("HTTP 409"), { status: 409 }),
    );
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Принять целиком" }));
    expect(await screen.findByText(/текст главы изменился/i)).toBeInTheDocument();
  });

  it("отклонение зовёт маршрут отклонения", async () => {
    const { onRejected } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    expect(api.rejectProposal).toHaveBeenCalledWith(5);
    expect(onRejected).toHaveBeenCalled();
  });
});

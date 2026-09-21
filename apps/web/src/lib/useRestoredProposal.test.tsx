import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ProseProposal } from "@book-forge/shared";
import { useRestoredProposal } from "./useRestoredProposal";

vi.mock("@/api/client", () => ({
  api: {
    listProposals: vi.fn(),
    getProposalChanges: vi.fn(),
  },
}));

import { api } from "@/api/client";

const base: ProseProposal = {
  id: 1,
  bookId: 1,
  chapterId: 2,
  kind: "write",
  status: "ready",
  baseVersionId: null,
  baseDraftRevision: null,
  contextFingerprint: "fp",
  contentText: "Текст.",
  contentJson: "{}",
  wordCount: 1,
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
  updatedAt: "2026-09-05T10:00:00.000Z",
};

const CHANGES = [
  {
    id: "c0",
    kind: "insert" as const,
    baseFrom: 0,
    baseTo: 0,
    baseText: [],
    candidateText: ["Текст."],
  },
];

beforeEach(() => {
  vi.mocked(api.listProposals).mockReset();
  vi.mocked(api.getProposalChanges)
    .mockReset()
    .mockResolvedValue({ baseVersionId: null, changes: CHANGES });
});

describe("useRestoredProposal", () => {
  it("после перезагрузки страницы возвращает самого свежего неулаженного кандидата", async () => {
    // listProposals отдаёт свежие первыми.
    vi.mocked(api.listProposals).mockResolvedValue([
      { ...base, id: 7, status: "incomplete" },
      { ...base, id: 3 },
    ]);
    const { result } = renderHook(() => useRestoredProposal(2));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.proposal.id).toBe(7);
    expect(result.current?.changes).toEqual(CHANGES);
    expect(api.getProposalChanges).toHaveBeenCalledWith(7);
  });

  it("принятые, отклонённые и отменённые кандидаты не предлагаются заново", async () => {
    vi.mocked(api.listProposals).mockResolvedValue([
      { ...base, id: 9, status: "accepted" },
      { ...base, id: 8, status: "rejected" },
      { ...base, id: 7, status: "cancelled" },
      { ...base, id: 6, status: "superseded" },
      { ...base, id: 5, status: "streaming" },
    ]);
    const { result } = renderHook(() => useRestoredProposal(2));

    await waitFor(() => expect(api.listProposals).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(api.getProposalChanges).not.toHaveBeenCalled();
  });

  it("отказ маршрута не роняет экран главы", async () => {
    vi.mocked(api.listProposals).mockRejectedValue(new Error("HTTP 500"));
    const { result } = renderHook(() => useRestoredProposal(2));

    await waitFor(() => expect(api.listProposals).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});

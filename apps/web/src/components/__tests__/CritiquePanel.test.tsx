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

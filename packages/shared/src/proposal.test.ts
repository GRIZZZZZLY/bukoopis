import { describe, it, expect } from "vitest";
import {
  proseProposalSchema,
  acceptProseProposalInputSchema,
  PROSE_PROPOSAL_STATUSES,
} from "./proposal.js";

const valid = {
  id: 7,
  bookId: 1,
  chapterId: 2,
  kind: "write" as const,
  status: "ready" as const,
  baseVersionId: 3,
  baseDraftRevision: null,
  contextFingerprint: "abc123",
  contentText: "Текст.",
  contentJson: '{"type":"doc","content":[]}',
  wordCount: 1,
  completion: "confirmed" as const,
  stopReason: "end_turn",
  modelId: "claude-opus-4-7",
  backend: "subscription",
  acceptedVersionId: null,
  acceptRequestId: null,
  errorMessage: null,
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T10:01:00.000Z",
};

describe("proseProposalSchema", () => {
  it("принимает полное предложение", () => {
    expect(proseProposalSchema.parse(valid).id).toBe(7);
  });

  it("отсутствующий черновик отличается от черновика ревизии 0", () => {
    expect(
      proseProposalSchema.parse({ ...valid, baseDraftRevision: null }).baseDraftRevision,
    ).toBeNull();
    expect(
      proseProposalSchema.parse({ ...valid, baseDraftRevision: 0 }).baseDraftRevision,
    ).toBe(0);
  });

  it("незавершённый поток — допустимое состояние кандидата", () => {
    const parsed = proseProposalSchema.parse({
      ...valid,
      status: "incomplete",
      completion: "unconfirmed",
      stopReason: null,
    });
    expect(parsed.completion).toBe("unconfirmed");
  });

  it("неизвестный статус отвергается", () => {
    expect(() => proseProposalSchema.parse({ ...valid, status: "готово" })).toThrow();
  });

  it("перечень статусов содержит все состояния жизненного цикла", () => {
    expect([...PROSE_PROPOSAL_STATUSES].sort()).toEqual(
      [
        "accepted",
        "cancelled",
        "failed",
        "incomplete",
        "ready",
        "rejected",
        "streaming",
        "superseded",
      ].sort(),
    );
  });
});

describe("acceptProseProposalInputSchema", () => {
  it("требует ключ запроса и ожидания клиента", () => {
    const parsed = acceptProseProposalInputSchema.parse({
      requestId: "req-1",
      expectedVersionId: 3,
      expectedDraftRevision: null,
    });
    expect(parsed.selectedChangeIds).toBeUndefined();
    expect(parsed.acknowledgeStale).toBe(false);
  });

  it("принимает выбранные правки", () => {
    const parsed = acceptProseProposalInputSchema.parse({
      requestId: "req-2",
      expectedVersionId: null,
      expectedDraftRevision: 4,
      selectedChangeIds: ["c0", "c2"],
    });
    expect(parsed.selectedChangeIds).toEqual(["c0", "c2"]);
  });

  it("пустой список выбранных правок отвергается: это не принятие, а отклонение", () => {
    expect(() =>
      acceptProseProposalInputSchema.parse({
        requestId: "req-3",
        expectedVersionId: 1,
        expectedDraftRevision: null,
        selectedChangeIds: [],
      }),
    ).toThrow();
  });

  it("пустой requestId отвергается", () => {
    expect(() =>
      acceptProseProposalInputSchema.parse({
        requestId: "",
        expectedVersionId: 1,
        expectedDraftRevision: null,
      }),
    ).toThrow();
  });
});

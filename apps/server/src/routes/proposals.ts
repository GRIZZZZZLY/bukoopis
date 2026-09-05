import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  acceptProseProposalInputSchema,
  rejectProseProposalInputSchema,
} from "@book-forge/shared";
import {
  acceptProposal,
  finishProposal,
  listProposals,
  loadProposal,
  rejectProposal,
  ProposalConflictError,
} from "../utils/prose-proposals.js";
import type { ProposalCancelRegistry } from "../utils/proposal-cancel.js";
import { toVersion, type ChapterVersionRow } from "../db/rows.js";
import { notFound, badRequest, validationFailed } from "../utils/errors.js";
import type { MemoryWorker } from "../utils/memory-worker.js";
import { triggerCanonExtractionAfterWriter } from "./canon-extraction.js";

export function createProposalsRoute(
  sqlite: DatabaseType,
  cancels: ProposalCancelRegistry,
  memoryWorker?: Pick<MemoryWorker, "kick">,
): Hono {
  const r = new Hono();

  r.get("/chapters/:id/proposals", (c) => {
    const id = Number(c.req.param("id"));
    const ch = sqlite
      .prepare("SELECT id FROM chapters WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!ch) return notFound(c, "chapter");
    return c.json(listProposals(sqlite, id));
  });

  r.get("/prose-proposals/:id", (c) => {
    const id = Number(c.req.param("id"));
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");
    return c.json(proposal);
  });

  r.post("/prose-proposals/:id/cancel", (c) => {
    const id = Number(c.req.param("id"));
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");
    if (proposal.status !== "streaming") {
      return badRequest(c, `нельзя остановить предложение в статусе ${proposal.status}`);
    }
    // Порядок важен: сначала помечаем в базе, потом просим поток остановиться.
    // Наоборот — и поток успел бы дописать кандидата раньше, чем отмена легла.
    finishProposal(sqlite, id, { status: "cancelled" });
    cancels.requestStop(id);
    return c.json({ stopping: true });
  });

  r.post("/prose-proposals/:id/accept", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = acceptProseProposalInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const before = loadProposal(sqlite, id);
    if (!before) return notFound(c, "prose_proposal");

    let outcome;
    try {
      outcome = acceptProposal(sqlite, id, parsed.data);
    } catch (e) {
      if (e instanceof ProposalConflictError) {
        return c.json(
          { error: "proposal_conflict", details: { reason: e.reason, message: e.message } },
          409,
        );
      }
      throw e;
    }
    memoryWorker?.kick();
    // Извлечение канона раньше запускалось из маршрута генерации сразу после
    // автокоммита. Теперь коммит — это принятие, и запускать его надо здесь,
    // один раз на настоящее принятие, а не на повтор по тому же requestId.
    if (before.kind === "write" && !outcome.replayed) {
      void triggerCanonExtractionAfterWriter(sqlite, before.chapterId);
    }
    const v = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(outcome.versionId) as ChapterVersionRow;
    return c.json({ version: toVersion(v), replayed: outcome.replayed });
  });

  r.post("/prose-proposals/:id/reject", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    const parsed = rejectProseProposalInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const proposal = loadProposal(sqlite, id);
    if (!proposal) return notFound(c, "prose_proposal");
    if (proposal.status === "accepted") {
      return badRequest(c, "предложение уже принято");
    }
    if (proposal.status === "streaming") {
      return badRequest(c, "предложение ещё пишется: сначала остановите генерацию");
    }
    rejectProposal(sqlite, id);
    return c.json(loadProposal(sqlite, id));
  });

  return r;
}

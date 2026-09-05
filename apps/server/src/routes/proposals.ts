import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import { finishProposal, listProposals, loadProposal } from "../utils/prose-proposals.js";
import type { ProposalCancelRegistry } from "../utils/proposal-cancel.js";
import { notFound, badRequest } from "../utils/errors.js";

export function createProposalsRoute(
  sqlite: DatabaseType,
  cancels: ProposalCancelRegistry,
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

  return r;
}

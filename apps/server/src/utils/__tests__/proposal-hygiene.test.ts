import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { recoverStaleProseProposals } from "../critique-recovery.js";
import { finishProposal } from "../prose-proposals.js";
import { aspectModelLabel } from "../../routes/studio.js";

/** Средние замечания ревью 2026-09-19: С7 (подпись модели — константа),
 *  С8 (кандидаты-зомби после рестарта и незащищённый финал). */

let t: TestApp;
let bookId: number;
let chapterId: number;

function seedProposal(status: string): number {
  const now = new Date().toISOString();
  return Number(
    t.sqlite
      .prepare(
        `INSERT INTO prose_proposals
           (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
            context_fingerprint, content_text, content_json, word_count, completion,
            created_at, updated_at)
         VALUES (?, ?, 'write', ?, NULL, NULL, 'fp', '', '{}', 0, 'unconfirmed', ?, ?)`,
      )
      .run(bookId, chapterId, status, now, now).lastInsertRowid,
  );
}

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Книга",
  });
  bookId = b.id;
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава" },
  );
  chapterId = ch.id;
});
afterEach(() => t.cleanup());

describe("кандидаты прозы после рестарта (С8)", () => {
  it("застрявший streaming становится ошибкой, остальные не трогаются", () => {
    const zombie = seedProposal("streaming");
    const ready = seedProposal("ready");

    expect(recoverStaleProseProposals(t.sqlite)).toBe(1);

    const rows = t.sqlite
      .prepare("SELECT id, status, error_message FROM prose_proposals ORDER BY id")
      .all() as Array<{ id: number; status: string; error_message: string | null }>;
    expect(rows.find((r) => r.id === zombie)!.status).toBe("failed");
    expect(rows.find((r) => r.id === zombie)!.error_message).toContain("прервалась");
    expect(rows.find((r) => r.id === ready)!.status).toBe("ready");
  });

  it("поздний ответ не переписывает отменённого кандидата", () => {
    const cancelled = seedProposal("cancelled");

    finishProposal(t.sqlite, cancelled, {
      status: "ready",
      contentText: "поздний текст",
      contentJson: "{}",
      wordCount: 2,
      completion: "confirmed",
      stopReason: "end_turn",
      modelId: "m",
      backend: "anthropic",
    });

    const row = t.sqlite
      .prepare("SELECT status, content_text FROM prose_proposals WHERE id = ?")
      .get(cancelled) as { status: string; content_text: string };
    expect(row.status).toBe("cancelled");
    expect(row.content_text).toBe("");
  });
});

describe("подпись модели у вариантов Мастерской (С7)", () => {
  it("следует бэкенду агента, а не константе", () => {
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({ aspect_variants: "api" });
    expect(aspectModelLabel("aspect_variants")).not.toContain("subscription:");
    process.env.LLM_AGENT_BACKEND_MAP = JSON.stringify({
      aspect_variants: "subscription",
    });
    expect(aspectModelLabel("aspect_variants")).toContain("subscription:");
    delete process.env.LLM_AGENT_BACKEND_MAP;
  });
});

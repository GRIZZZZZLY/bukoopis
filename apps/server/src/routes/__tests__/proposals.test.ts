import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

let t: TestApp;
let chapterId: number;
let proposalId: number;

const docJson = (text: string): string =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Маршруты",
    premise: "p",
  });
  const ch = await sendJson<{ id: number }>(t.app, `/api/books/${b.id}/chapters`, "POST", {
    title: "Глава",
  });
  chapterId = ch.id;

  const db = new Database(`${t.dbDir}/test.sqlite`);
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO prose_proposals
         (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
          context_fingerprint, content_text, content_json, word_count, completion,
          stop_reason, created_at, updated_at)
       VALUES (?, ?, 'write', 'ready', NULL, NULL, ?, 'Готовый текст.', ?, 2, 'confirmed', 'end_turn', ?, ?)`,
    )
    .run(b.id, chapterId, "fp-не-совпадёт", docJson("Готовый текст."), now, now);
  proposalId = Number(info.lastInsertRowid);
  db.close();
});
afterEach(() => t.cleanup());

describe("маршруты предложений", () => {
  it("404 на неизвестное предложение", async () => {
    const res = await send(t.app, "/api/prose-proposals/9999", "GET");
    expect(res.status).toBe(404);
  });

  it("принятие создаёт версию и возвращает её", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/accept`, "POST", {
      requestId: "req-1",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeStale: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: { id: number }; replayed: boolean };
    expect(body.version.id).toBeGreaterThan(0);
    expect(body.replayed).toBe(false);

    const ch = await sendJson<{ currentVersionId: number }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.currentVersionId).toBe(body.version.id);
  });

  it("устаревшее ожидание версии даёт 409, а не тихую перезапись (AC-17)", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/accept`, "POST", {
      requestId: "req-1",
      expectedVersionId: 4242,
      expectedDraftRevision: null,
      acknowledgeStale: true,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; details: { reason: string } };
    expect(body.error).toBe("proposal_conflict");
    expect(body.details.reason).toBe("version");
  });

  it("повтор принятия после сетевого сбоя возвращает ту же версию (AC-19)", async () => {
    const body = { requestId: "req-same", expectedVersionId: null, expectedDraftRevision: null, acknowledgeStale: true };
    const first = (await sendJson<{ version: { id: number } }>(
      t.app,
      `/api/prose-proposals/${proposalId}/accept`,
      "POST",
      body,
    )).version.id;
    const second = await sendJson<{ version: { id: number }; replayed: boolean }>(
      t.app,
      `/api/prose-proposals/${proposalId}/accept`,
      "POST",
      body,
    );
    expect(second.version.id).toBe(first);
    expect(second.replayed).toBe(true);
  });

  it("отклонение не создаёт версию и не трогает память (AC-16)", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/reject`, "POST", {});
    expect(res.status).toBe(200);

    const ch = await sendJson<{ currentVersionId: number | null }>(
      t.app,
      `/api/chapters/${chapterId}`,
      "GET",
    );
    expect(ch.currentVersionId).toBeNull();

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const jobs = db.prepare("SELECT COUNT(*) c FROM memory_jobs").get() as { c: number };
    const status = db
      .prepare("SELECT status FROM prose_proposals WHERE id = ?")
      .get(proposalId) as { status: string };
    db.close();
    expect(jobs.c).toBe(0);
    expect(status.status).toBe("rejected");
  });

  it("тело без requestId отвергается как некорректное", async () => {
    const res = await send(t.app, `/api/prose-proposals/${proposalId}/accept`, "POST", {
      expectedVersionId: null,
      expectedDraftRevision: null,
    });
    expect(res.status).toBe(400);
  });

  it("список предложений главы отдаётся новыми вперёд", async () => {
    const list = await sendJson<Array<{ id: number }>>(
      t.app,
      `/api/chapters/${chapterId}/proposals`,
      "GET",
    );
    expect(list[0]?.id).toBe(proposalId);
  });
});

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
      acknowledgeUnconfirmed: true,
      acknowledgeContextDrift: true,
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
      acknowledgeUnconfirmed: true,
      acknowledgeContextDrift: true,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; details: { reason: string } };
    expect(body.error).toBe("proposal_conflict");
    expect(body.details.reason).toBe("version");
  });

  it("повтор принятия после сетевого сбоя возвращает ту же версию (AC-19)", async () => {
    const body = {
      requestId: "req-same",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: true,
      acknowledgeContextDrift: true,
    };
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

describe("частичное принятие", () => {
  /** Глава с текстом из трёх абзацев и кандидат, который меняет средний и
   *  дописывает четвёртый: две независимые правки, из которых автор берёт одну. */
  async function seedBaseAndCandidate(): Promise<{ versionId: number; proposalId: number }> {
    const doc = (...paragraphs: string[]) => ({
      type: "doc",
      content: paragraphs.map((p) => ({
        type: "paragraph",
        content: [{ type: "text", text: p }],
      })),
    });
    const version = await sendJson<{ id: number }>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      { contentJson: doc("Раз.", "Два.", "Три.") },
    );

    const db = new Database(`${t.dbDir}/test.sqlite`);
    const now = new Date().toISOString();
    const book = db
      .prepare("SELECT book_id b FROM chapters WHERE id = ?")
      .get(chapterId) as { b: number };
    const info = db
      .prepare(
        `INSERT INTO prose_proposals
           (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
            context_fingerprint, content_text, content_json, word_count, completion,
            stop_reason, created_at, updated_at)
         VALUES (?, ?, 'write', 'ready', ?, NULL, 'fp', ?, ?, 4, 'confirmed', 'end_turn', ?, ?)`,
      )
      .run(
        book.b,
        chapterId,
        version.id,
        "Раз.\n\nВторой.\n\nТри.\n\nЧетыре.",
        JSON.stringify(doc("Раз.", "Второй.", "Три.", "Четыре.")),
        now,
        now,
      );
    db.close();
    return { versionId: version.id, proposalId: Number(info.lastInsertRowid) };
  }

  it("отдаёт список правок с текстом базы и кандидата", async () => {
    const { proposalId: pid } = await seedBaseAndCandidate();
    const body = await sendJson<{
      baseVersionId: number | null;
      changes: Array<{ id: string; kind: string; baseText: string[]; candidateText: string[] }>;
    }>(t.app, `/api/prose-proposals/${pid}/changes`, "GET");

    expect(body.changes).toHaveLength(2);
    expect(body.changes[0]).toMatchObject({
      kind: "replace",
      baseText: ["Два."],
      candidateText: ["Второй."],
    });
    expect(body.changes[1]).toMatchObject({ kind: "insert", candidateText: ["Четыре."] });
  });

  it("принимает только выбранную правку, а память берёт из итога (AC-18)", async () => {
    const { versionId, proposalId: pid } = await seedBaseAndCandidate();
    const changes = (
      await sendJson<{ changes: Array<{ id: string; kind: string }> }>(
        t.app,
        `/api/prose-proposals/${pid}/changes`,
        "GET",
      )
    ).changes;
    const insertOnly = changes.find((ch) => ch.kind === "insert")!;

    const accepted = await sendJson<{ version: { id: number; contentText: string } }>(
      t.app,
      `/api/prose-proposals/${pid}/accept`,
      "POST",
      {
        requestId: "req-partial",
        expectedVersionId: versionId,
        expectedDraftRevision: null,
        selectedChangeIds: [insertOnly.id],
        acknowledgeUnconfirmed: true,
        acknowledgeContextDrift: true,
      },
    );

    // Взята только вставка: средний абзац остался прежним.
    expect(accepted.version.contentText).toContain("Два.");
    expect(accepted.version.contentText).not.toContain("Второй.");
    expect(accepted.version.contentText).toContain("Четыре.");

    // Задания памяти стоят на принятой (слитой) версии. У базовой версии свои
    // задания есть с момента её коммита в seedBaseAndCandidate — это нормально;
    // чего быть не должно, так это заданий на что-либо ещё: полный кандидат в
    // очередь не попадает.
    const db = new Database(`${t.dbDir}/test.sqlite`);
    const mergedJobs = db
      .prepare(
        `SELECT COUNT(*) c FROM memory_jobs
         WHERE chapter_version_id = ? AND kind IN ('index','summary','facts','notes')`,
      )
      .get(accepted.version.id) as { c: number };
    const strayJobs = db
      .prepare(
        "SELECT COUNT(*) c FROM memory_jobs WHERE chapter_version_id NOT IN (?, ?)",
      )
      .get(versionId, accepted.version.id) as { c: number };
    db.close();
    expect(mergedJobs.c).toBe(4);
    expect(strayJobs.c).toBe(0);
  });

  it("неизвестный идентификатор правки — 400, а не молча принятый кандидат", async () => {
    const { versionId, proposalId: pid } = await seedBaseAndCandidate();
    const res = await send(t.app, `/api/prose-proposals/${pid}/accept`, "POST", {
      requestId: "req-bad",
      expectedVersionId: versionId,
      expectedDraftRevision: null,
      selectedChangeIds: ["нет-такой"],
      acknowledgeUnconfirmed: true,
      acknowledgeContextDrift: true,
    });
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { recoverStaleProseProposals } from "../critique-recovery.js";
import { finishProposal, touchProposal } from "../prose-proposals.js";
import { aspectModelLabel } from "../aspect-model-label.js";

/** Средние замечания ревью 2026-09-19: С7 (подпись модели — константа),
 *  С8 (кандидаты-зомби после рестарта и незащищённый финал). */

let t: TestApp;
let bookId: number;
let chapterId: number;

function seedProposal(status: string, createdAt?: string, beatsDone: number | null = null): number {
  const now = createdAt ?? new Date().toISOString();
  return Number(
    t.sqlite
      .prepare(
        `INSERT INTO prose_proposals
           (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
            context_fingerprint, content_text, content_json, word_count, completion,
            beats_done, created_at, updated_at)
         VALUES (?, ?, 'write', ?, NULL, NULL, 'fp', '', '{}', 0, 'unconfirmed', ?, ?, ?)`,
      )
      .run(bookId, chapterId, status, beatsDone, now, now).lastInsertRowid,
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
    // Пульса давно нет: живую генерацию другого процесса гасить нельзя.
    const zombie = seedProposal("streaming", "2020-01-01T00:00:00.000Z");
    const ready = seedProposal("ready");

    expect(recoverStaleProseProposals(t.sqlite)).toBe(1);

    const rows = t.sqlite
      .prepare("SELECT id, status, error_message FROM prose_proposals ORDER BY id")
      .all() as Array<{ id: number; status: string; error_message: string | null }>;
    expect(rows.find((r) => r.id === zombie)!.status).toBe("failed");
    expect(rows.find((r) => r.id === zombie)!.error_message).toContain("прервалась");
    expect(rows.find((r) => r.id === ready)!.status).toBe("ready");
  });

  it("не трогает генерацию, начатую только что", () => {
    // Второй процесс сервера на той же базе иначе пометил бы живой кандидат
    // первого как упавший, и его результат было бы некуда записать.
    const fresh = seedProposal("streaming");
    expect(recoverStaleProseProposals(t.sqlite)).toBe(0);
    const row = t.sqlite
      .prepare("SELECT status FROM prose_proposals WHERE id = ?")
      .get(fresh) as { status: string };
    expect(row.status).toBe("streaming");
  });

  it("генерация пятиминутной давности без пульса — мёртвая (F14 ревью 2026-09-22)", () => {
    // Прежний порог «старше получаса» оставлял её в streaming до следующего
    // рестарта: процесс, который её писал, уже умер.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const dead = seedProposal("streaming", fiveMinAgo);
    const alive = seedProposal("streaming", fiveMinAgo);
    touchProposal(t.sqlite, alive);

    expect(recoverStaleProseProposals(t.sqlite)).toBe(1);
    const status = (id: number) =>
      (t.sqlite.prepare("SELECT status FROM prose_proposals WHERE id = ?").get(id) as { status: string }).status;
    expect(status(dead)).toBe("failed");
    expect(status(alive)).toBe("streaming");
  });

  it("восстановление после рестарта различает беаты и обычный обрыв (Task 9 CASE)", () => {
    // Оба старше получаса, чтобы гарантированно попасть под восстановление,
    // независимо от порога. Проверяем именно ветвление CASE: у затронутого
    // беатами кандидата статус, причина и счётчик должны выжить, у обычного —
    // прежнее поведение, и сообщения не должны перепутаться местами.
    const withBeats = seedProposal("streaming", "2020-01-01T00:00:00.000Z", 2);
    const withoutBeats = seedProposal("streaming", "2020-01-01T00:00:00.000Z", null);

    expect(recoverStaleProseProposals(t.sqlite)).toBe(2);

    const rows = t.sqlite
      .prepare(
        "SELECT id, status, stop_reason, error_message, beats_done FROM prose_proposals ORDER BY id",
      )
      .all() as Array<{
        id: number;
        status: string;
        stop_reason: string | null;
        error_message: string | null;
        beats_done: number | null;
      }>;
    const withBeatsRow = rows.find((r) => r.id === withBeats)!;
    const withoutBeatsRow = rows.find((r) => r.id === withoutBeats)!;

    expect(withBeatsRow.status).toBe("incomplete");
    expect(withBeatsRow.stop_reason).toBe("interrupted");
    expect(withBeatsRow.error_message).toContain("Написанные беаты можно принять");
    expect(withBeatsRow.beats_done).toBe(2);

    expect(withoutBeatsRow.status).toBe("failed");
    expect(withoutBeatsRow.stop_reason).toBeNull();
    expect(withoutBeatsRow.error_message).toContain("Запустите её заново");
    // Сообщения не перепутаны местами: у обычного обрыва нет речи о беатах.
    expect(withoutBeatsRow.error_message).not.toContain("беаты");
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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  reviseChapter: vi.fn(),
  fixPhrases: vi.fn(),
}));

import {
  makeTestApp,
  send,
  sendJson,
  type TestApp,
} from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
}
interface VersionJson {
  id: number;
}

let t: TestApp;
let versionId: number;

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;

  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Repair-test",
    premise: "p",
  });
  const ch = await sendJson<ChapterJson>(
    t.app,
    `/api/books/${b.id}/chapters`,
    "POST",
    { title: "Глава" },
  );
  const v = await sendJson<VersionJson>(
    t.app,
    `/api/chapters/${ch.id}/versions`,
    "POST",
    {
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Текст главы для self-repair." },
            ],
          },
        ],
      },
    },
  );
  versionId = v.id;
});
afterEach(() => t.cleanup());

describe("repair endpoint", () => {
  it("400 when no critique exists for version", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/repair`,
      "POST",
      {},
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("bad_request");
  });

  it("404 when version missing", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/9999/repair`,
      "POST",
      {},
    );
    expect(res.status).toBe(404);
  });

  it("validates severities array (must be non-empty)", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/repair`,
      "POST",
      { severities: [] },
    );
    expect(res.status).toBe(400);
  });

  it("rejects when iteration cap reached (3)", async () => {
    // Manually seed 3 ancestor repair versions to simulate cap.
    const helper = (t as unknown as { dbDir: string }).dbDir;
    void helper; // not used; we manipulate via API
    // Easier: insert via server SQL through a side path. Instead, drive via HTTP:
    // Save 3 versions whose branch_labels contain 'repair-N'. But our endpoints
    // don't allow setting branch_label. So manipulate via direct SQL on test DB.
    const Database = (await import("better-sqlite3")).default;
    const path = `${(t as unknown as { dbDir: string }).dbDir}/test.sqlite`;
    const db = new Database(path);
    const now = new Date().toISOString();
    let parent: number = versionId;
    for (let i = 1; i <= 3; i++) {
      const info = db
        .prepare(
          `INSERT INTO chapter_versions
           (chapter_id, parent_version_id, content_json, content_text, word_count, source, branch_label, created_at)
           VALUES (?, ?, '{}', 'x', 1, 'agent', ?, ?)`,
        )
        .run(1, parent, `repair-${i}`, now);
      parent = Number(info.lastInsertRowid);
    }
    db.prepare(
      `INSERT INTO critique_reports (chapter_version_id, status, report_json, created_at, completed_at)
       VALUES (?, 'done', ?, ?, ?)`,
    ).run(
      parent,
      JSON.stringify({
        critics: [],
        blockingCount: 0,
        suggestionCount: 0,
        nitCount: 0,
        generatedAt: now,
      }),
      now,
      now,
    );
    db.close();

    const res = await send(
      t.app,
      `/api/chapter-versions/${parent}/repair`,
      "POST",
      {},
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { message: string } };
    expect(body.details.message).toContain("repair iteration cap");
  });

  it("repair кладёт кандидата и не двигает текущую версию (AC-16)", async () => {
    const { reviseChapter } = await import("@book-forge/agents");
    vi.mocked(reviseChapter).mockImplementation(
      // eslint-disable-next-line require-yield
      async function* () {
        yield "Исправ";
        return {
          text: "Исправленный текст.",
          modelId: "test-model",
          stopReason: "end_turn",
          tokens: { input: 1, output: 2, cacheCreation: 0, cacheRead: 0 },
        };
      } as never,
    );

    const Database = (await import("better-sqlite3")).default;
    const path = `${t.dbDir}/test.sqlite`;
    const db = new Database(path);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO critique_reports (chapter_version_id, status, report_json, created_at, completed_at)
       VALUES (?, 'done', ?, ?, ?)`,
    ).run(
      versionId,
      JSON.stringify({
        critics: [],
        blockingCount: 0,
        suggestionCount: 0,
        nitCount: 0,
        generatedAt: now,
      }),
      now,
      now,
    );
    const before = db
      .prepare(
        "SELECT current_version_id c FROM chapters WHERE id = (SELECT chapter_id FROM chapter_versions WHERE id = ?)",
      )
      .get(versionId) as { c: number };
    db.close();

    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/repair`,
      "POST",
      {},
    );
    const raw = await res.text();
    expect(raw).toContain("event: proposal");

    const db2 = new Database(path);
    const after = db2
      .prepare(
        "SELECT current_version_id c FROM chapters WHERE id = (SELECT chapter_id FROM chapter_versions WHERE id = ?)",
      )
      .get(versionId) as { c: number };
    const proposal = db2
      .prepare("SELECT kind, status FROM prose_proposals ORDER BY id DESC LIMIT 1")
      .get() as { kind: string; status: string };
    const jobs = db2
      .prepare("SELECT COUNT(*) c FROM memory_jobs WHERE chapter_version_id != ?")
      .get(versionId) as { c: number };
    db2.close();

    expect(after.c).toBe(before.c);
    expect(proposal).toMatchObject({ kind: "repair", status: "ready" });
    expect(jobs.c).toBe(0);
  });
  // Хирургическая правка (2026-09-23): замечания прохода по фразам правит
  // не общая правка — код подставляет замены только в отмеченные места.
  it("только замечания о фразах: общая правка не вызывается, текст вокруг не меняется", async () => {
    const { reviseChapter, fixPhrases } = await import("@book-forge/agents");
    vi.mocked(reviseChapter).mockReset();
    vi.mocked(fixPhrases).mockResolvedValue({
      fixes: [{ id: "style:0", before: "для self-repair", after: "для правки" }],
      usage: [{ modelId: "subscription:test", inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }],
    } as never);
    const Database = (await import("better-sqlite3")).default;
    const path = `${t.dbDir}/test.sqlite`;
    const db = new Database(path);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO critique_reports (chapter_version_id, status, report_json, created_at, completed_at)
       VALUES (?, 'done', ?, ?, ?)`,
    ).run(
      versionId,
      JSON.stringify({
        critics: [{ critic: "style", overallNotes: "ок", issues: [
          { severity: "suggestion", summary: "готовая формула: слишком гладко", excerpt: "для self-repair", origin: "style_phrase" },
        ] }],
        blockingCount: 0, suggestionCount: 1, nitCount: 0, generatedAt: now,
      }),
      now,
      now,
    );
    db.close();

    const res = await send(t.app, `/api/chapter-versions/${versionId}/repair`, "POST", {});
    const raw = await res.text();
    expect(raw).toContain("event: done");
    expect(raw).toContain("\"phraseFixes\":{\"applied\":1");
    expect(reviseChapter).not.toHaveBeenCalled();
    expect(vi.mocked(fixPhrases).mock.calls[0]![0].items).toEqual([
      expect.objectContaining({ id: "style:0", excerpt: "для self-repair", paragraph: "Текст главы для self-repair." }),
    ]);
    const db2 = new Database(path);
    const proposal = db2
      .prepare("SELECT status, content_text FROM prose_proposals ORDER BY id DESC LIMIT 1")
      .get() as { status: string; content_text: string };
    db2.close();
    expect(proposal).toEqual({ status: "ready", content_text: "Текст главы для правки." });
  });
});

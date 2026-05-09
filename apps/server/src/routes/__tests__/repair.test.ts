import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
});

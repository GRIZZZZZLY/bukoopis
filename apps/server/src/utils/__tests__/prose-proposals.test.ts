import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import {
  acceptProposal,
  createProposal,
  finishProposal,
  loadProposal,
  ProposalConflictError,
} from "../prose-proposals.js";

let t: TestApp;
let db: DatabaseType;
let bookId: number;
let chapterId: number;

const docJson = (text: string): string =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

function readyProposal(text: string): number {
  const id = createProposal(db, {
    bookId,
    chapterId,
    kind: "write",
    baseVersionId: null,
  });
  finishProposal(db, id, {
    status: "ready",
    contentText: text,
    contentJson: docJson(text),
    wordCount: text.split(/\s+/).length,
    completion: "confirmed",
    stopReason: "end_turn",
    modelId: "test-model",
  });
  return id;
}

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Принятие",
    premise: "p",
  });
  bookId = b.id;
  const ch = await sendJson<{ id: number }>(
    t.app,
    `/api/books/${bookId}/chapters`,
    "POST",
    { title: "Глава" },
  );
  chapterId = ch.id;
  db = new Database(`${t.dbDir}/test.sqlite`);
});
afterEach(() => {
  db.close();
  t.cleanup();
});

describe("acceptProposal", () => {
  it("делает версию текущей и ставит задания памяти", () => {
    const id = readyProposal("Принятый текст.");
    const out = acceptProposal(db, id, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    expect(out.versionId).toBeGreaterThan(0);
    expect(out.replayed).toBe(false);

    const ch = db
      .prepare("SELECT current_version_id c FROM chapters WHERE id = ?")
      .get(chapterId) as { c: number };
    expect(ch.c).toBe(out.versionId);

    // Считаем только задания коммита: воркер памяти в тестовом приложении
    // настоящий и после summary доцепляет rollup — его в счёт не берём.
    const jobs = db
      .prepare(
        `SELECT COUNT(*) c FROM memory_jobs
         WHERE chapter_version_id = ? AND kind IN ('index','summary','facts','notes')`,
      )
      .get(out.versionId) as { c: number };
    expect(jobs.c).toBe(4);

    expect(loadProposal(db, id)?.status).toBe("accepted");
  });

  it("повтор с тем же requestId возвращает ту же версию и не удваивает память (AC-19)", () => {
    const id = readyProposal("Текст.");
    const first = acceptProposal(db, id, {
      requestId: "r-same",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    const second = acceptProposal(db, id, {
      requestId: "r-same",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    expect(second.versionId).toBe(first.versionId);
    expect(second.replayed).toBe(true);

    const versions = db
      .prepare("SELECT COUNT(*) c FROM chapter_versions WHERE chapter_id = ?")
      .get(chapterId) as { c: number };
    expect(versions.c).toBe(1);
    const jobs = db
      .prepare(
        "SELECT COUNT(*) c FROM memory_jobs WHERE kind IN ('index','summary','facts','notes')",
      )
      .get() as { c: number };
    expect(jobs.c).toBe(4);
  });

  it("тот же кандидат с другим requestId — конфликт статуса, а не вторая версия", () => {
    const id = readyProposal("Текст.");
    acceptProposal(db, id, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r2",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeUnconfirmed: false,
        acknowledgeContextDrift: false,
      }),
    ).toThrow(ProposalConflictError);
  });

  it("устаревшее ожидание версии отклоняется (AC-17)", () => {
    const id = readyProposal("Текст.");
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: 999,
        expectedDraftRevision: null,
        acknowledgeUnconfirmed: false,
        acknowledgeContextDrift: false,
      }),
    ).toThrow(/version/);
  });

  it("появившийся во время генерации черновик отклоняет принятие (AC-17)", () => {
    const id = readyProposal("Текст.");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapter_drafts
         (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
       VALUES (?, ?, 'правка автора', 2, NULL, 1, ?)`,
    ).run(chapterId, docJson("правка автора"), now);

    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeUnconfirmed: false,
        acknowledgeContextDrift: false,
      }),
    ).toThrow(/draft/);

    // Правка автора на месте: неудачное принятие ничего не стёрло (INV-06).
    const draft = db
      .prepare("SELECT content_text t FROM chapter_drafts WHERE chapter_id = ?")
      .get(chapterId) as { t: string };
    expect(draft.t).toBe("правка автора");
  });

  it("принятие удаляет черновик, ревизию которого автор подтвердил", () => {
    const id = readyProposal("Текст.");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO chapter_drafts
         (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
       VALUES (?, ?, 'черновик', 1, NULL, 3, ?)`,
    ).run(chapterId, docJson("черновик"), now);

    acceptProposal(db, id, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: 3,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    const draft = db
      .prepare("SELECT COUNT(*) c FROM chapter_drafts WHERE chapter_id = ?")
      .get(chapterId) as { c: number };
    expect(draft.c).toBe(0);
  });

  it("незавершённого кандидата нельзя принять без осознанного подтверждения (AC-20)", () => {
    const id = createProposal(db, {
      bookId,
      chapterId,
      kind: "write",
      baseVersionId: null,
    });
    finishProposal(db, id, {
      status: "incomplete",
      contentText: "Обрубок",
      contentJson: docJson("Обрубок"),
      wordCount: 1,
      completion: "unconfirmed",
      stopReason: "max_tokens",
    });
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeUnconfirmed: false,
        acknowledgeContextDrift: false,
      }),
    ).toThrow(/unconfirmed/);

    // Согласие ровно на свой вопрос — и ни на какой другой.
    const out = acceptProposal(db, id, {
      requestId: "r2",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: true,
      acknowledgeContextDrift: false,
    });
    expect(out.versionId).toBeGreaterThan(0);
  });

  it("согласие на уехавший контекст не пропускает неподтверждённое завершение", () => {
    const id = createProposal(db, {
      bookId,
      chapterId,
      kind: "write",
      baseVersionId: null,
    });
    finishProposal(db, id, {
      status: "incomplete",
      contentText: "Обрубок",
      contentJson: docJson("Обрубок"),
      wordCount: 1,
      completion: "unconfirmed",
      stopReason: "max_tokens",
    });
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeUnconfirmed: false,
        acknowledgeContextDrift: true,
      }),
    ).toThrow(/unconfirmed/);
  });

  it("неподтверждённое завершение больше не проглатывает проверку контекста", () => {
    const id = createProposal(db, {
      bookId,
      chapterId,
      kind: "write",
      baseVersionId: null,
    });
    finishProposal(db, id, {
      status: "incomplete",
      contentText: "Обрубок",
      contentJson: docJson("Обрубок"),
      wordCount: 1,
      completion: "unconfirmed",
      stopReason: "max_tokens",
    });
    db.prepare("UPDATE chapters SET intent = ? WHERE id = ?").run(
      "другое намерение",
      chapterId,
    );
    // Одним флагом на два вопроса это принималось молча: автор соглашался с
    // обрывом и заодно, сам того не зная, с уехавшим планом главы.
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeUnconfirmed: true,
        acknowledgeContextDrift: false,
      }),
    ).toThrow(/stale/);
  });

  it("уехавший контекст требует осознанного принятия", () => {
    const id = readyProposal("Текст.");
    db.prepare("UPDATE chapters SET intent = ? WHERE id = ?").run("другое намерение", chapterId);
    expect(() =>
      acceptProposal(db, id, {
        requestId: "r1",
        expectedVersionId: null,
        expectedDraftRevision: null,
        acknowledgeUnconfirmed: false,
        acknowledgeContextDrift: false,
      }),
    ).toThrow(/stale/);

    // Подтверждённого кандидата с уехавшей базой раньше было не принять
    // вовсе: единственный флаг заодно означал «завершение не подтверждено».
    const out = acceptProposal(db, id, {
      requestId: "r2",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: true,
    });
    expect(out.versionId).toBeGreaterThan(0);
  });

  it("кандидат repair принимается ветвью repair-N", () => {
    const base = acceptProposal(db, readyProposal("Первый текст."), {
      requestId: "r0",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    const repairId = createProposal(db, {
      bookId,
      chapterId,
      kind: "repair",
      baseVersionId: base.versionId,
    });
    finishProposal(db, repairId, {
      status: "ready",
      contentText: "Исправленный текст.",
      contentJson: docJson("Исправленный текст."),
      wordCount: 2,
      completion: "confirmed",
      stopReason: "end_turn",
    });
    const out = acceptProposal(db, repairId, {
      requestId: "r1",
      expectedVersionId: base.versionId,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    const v = db
      .prepare("SELECT branch_label b, parent_version_id p FROM chapter_versions WHERE id = ?")
      .get(out.versionId) as { b: string | null; p: number | null };
    expect(v.b).toBe("repair-1");
    expect(v.p).toBe(base.versionId);
  });

  it("принятие одного кандидата помечает других живых кандидатов той же главы superseded", () => {
    const acceptedId = readyProposal("Первый вариант.");
    const otherId = readyProposal("Второй вариант.");

    acceptProposal(db, acceptedId, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });

    expect(loadProposal(db, acceptedId)?.status).toBe("accepted");
    expect(loadProposal(db, otherId)?.status).toBe("superseded");
  });
});

/** Документ автора с разметкой: заголовок, жирный прогон и пункт списка.
 *  Сравнение по строкам их не видит — частичное принятие обязано сохранить. */
const RICH_DOC = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Глава вторая" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Он сказал " },
        { type: "text", marks: [{ type: "bold" }], text: "нет" },
        { type: "text", text: "." },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "Старый абзац." }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Пункт списка." }],
            },
          ],
        },
      ],
    },
  ],
};

const PLAIN_CANDIDATE_JSON = JSON.stringify({
  type: "doc",
  content: ["Глава вторая", "Он сказал нет.", "Новый абзац.", "Пункт списка."].map(
    (text) => ({ type: "paragraph", content: [{ type: "text", text }] }),
  ),
});

describe("частичное принятие сохраняет разметку автора", () => {
  function seedRichVersion(): number {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO chapter_versions
           (chapter_id, parent_version_id, content_json, content_text, word_count, source, created_at)
         VALUES (?, NULL, ?, ?, 6, 'manual', ?)`,
      )
      .run(chapterId, JSON.stringify(RICH_DOC), "Глава вторая Он сказал нет. Старый абзац. Пункт списка.", now);
    const versionId = Number(info.lastInsertRowid);
    db.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(
      versionId,
      chapterId,
    );
    return versionId;
  }

  function plainCandidate(baseVersionId: number): number {
    const id = createProposal(db, {
      bookId,
      chapterId,
      kind: "write",
      baseVersionId,
    });
    finishProposal(db, id, {
      status: "ready",
      contentText: "Глава вторая Он сказал нет. Новый абзац. Пункт списка.",
      contentJson: PLAIN_CANDIDATE_JSON,
      wordCount: 6,
      completion: "confirmed",
      stopReason: "end_turn",
    });
    return id;
  }

  it("принятие одного абзаца не сносит жирное, заголовок и список из остальных", () => {
    const versionId = seedRichVersion();
    const proposalId = plainCandidate(versionId);

    const out = acceptProposal(db, proposalId, {
      requestId: "r1",
      expectedVersionId: versionId,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
      selectedChangeIds: ["c0"],
    });

    const row = db
      .prepare("SELECT content_json FROM chapter_versions WHERE id = ?")
      .get(out.versionId) as { content_json: string };
    const doc = JSON.parse(row.content_json) as { content: unknown[] };

    expect(doc.content).toHaveLength(4);
    expect(doc.content[0]).toEqual(RICH_DOC.content[0]);
    expect(doc.content[1]).toEqual(RICH_DOC.content[1]);
    expect(doc.content[3]).toEqual(RICH_DOC.content[3]);
    // Принятый абзац взят у кандидата.
    expect(doc.content[2]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Новый абзац." }],
    });
  });

  it("принятие целиком по-прежнему кладёт JSON кандидата нетронутым", () => {
    const versionId = seedRichVersion();
    const proposalId = plainCandidate(versionId);

    const out = acceptProposal(db, proposalId, {
      requestId: "r1",
      expectedVersionId: versionId,
      expectedDraftRevision: null,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });
    const row = db
      .prepare("SELECT content_json FROM chapter_versions WHERE id = ?")
      .get(out.versionId) as { content_json: string };
    expect(row.content_json).toBe(PLAIN_CANDIDATE_JSON);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTestApp,
  send,
  sendJson,
  type TestApp,
} from "../../routes/__tests__/_helpers.js";
import {
  acceptProposal,
  createProposal,
  finishProposal,
} from "../prose-proposals.js";

/** К2 ревью 2026-09-19: `chapter_drafts` — единственная копия того, что автор
 *  напечатал после последней версии, и её удаляли три пути (принятие
 *  кандидата, восстановление версии, коммит содержимого из предпросмотра), ни
 *  один из которых не превращал черновик в версию. Правило: любой текст автора
 *  становится версией прежде, чем что-либо его заменит. */

let t: TestApp;
let bookId: number;
let chapterId: number;

const docJson = (text: string): string =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

const doc = (text: string): unknown => JSON.parse(docJson(text));

function seedDraft(text: string, revision = 1): void {
  t.sqlite
    .prepare(
      `INSERT INTO chapter_drafts
         (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
       VALUES (?, ?, ?, ?, (SELECT current_version_id FROM chapters WHERE id = ?), ?, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET
         content_json = excluded.content_json,
         content_text = excluded.content_text,
         revision = excluded.revision`,
    )
    .run(
      chapterId,
      docJson(text),
      text,
      text.split(/\s+/).length,
      chapterId,
      revision,
      new Date().toISOString(),
    );
}

function versions(): Array<{
  id: number;
  content_text: string;
  source: string;
}> {
  return t.sqlite
    .prepare(
      "SELECT id, content_text, source FROM chapter_versions WHERE chapter_id = ? ORDER BY id ASC",
    )
    .all(chapterId) as Array<{ id: number; content_text: string; source: string }>;
}

function readyProposal(text: string, baseVersionId: number | null): number {
  const id = createProposal(t.sqlite, {
    bookId,
    chapterId,
    kind: "write",
    baseVersionId,
  });
  finishProposal(t.sqlite, id, {
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
    title: "Черновики",
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
});
afterEach(() => t.cleanup());

describe("принятие кандидата (К2)", () => {
  it("черновик автора становится версией прежде, чем кандидат его заменит", () => {
    seedDraft("Абзац, который автор дописал руками.", 4);
    const proposalId = readyProposal("Текст кандидата.", null);

    acceptProposal(t.sqlite, proposalId, {
      requestId: "r1",
      expectedVersionId: null,
      expectedDraftRevision: 4,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });

    const rows = versions();
    expect(rows.map((v) => v.content_text)).toEqual([
      "Абзац, который автор дописал руками.",
      "Текст кандидата.",
    ]);
    // Снимок черновика — авторский текст, а не машинный.
    expect(rows[0]!.source).toBe("manual");
    // Кандидат продолжает снимок, а не обходит его.
    const parent = t.sqlite
      .prepare("SELECT parent_version_id p FROM chapter_versions WHERE id = ?")
      .get(rows[1]!.id) as { p: number | null };
    expect(parent.p).toBe(rows[0]!.id);
  });

  it("частичное принятие тоже сохраняет черновик, а правки считает от версии, которую видел автор", async () => {
    const v = await sendJson<{ id: number }>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      { contentJson: doc("Первый абзац.") },
    );
    seedDraft("Первый абзац.\n\nДописанное автором.", 2);
    const proposalId = readyProposal("Переписанный абзац.", v.id);

    acceptProposal(t.sqlite, proposalId, {
      requestId: "r1",
      expectedVersionId: v.id,
      expectedDraftRevision: 2,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
      selectedChangeIds: ["c0"],
    });

    const rows = versions();
    expect(rows.map((x) => x.content_text)).toEqual([
      "Первый абзац.",
      "Первый абзац.\n\nДописанное автором.",
      // Слияние считается от версии, которую видел автор, а не от черновика.
      "Переписанный абзац.",
    ]);
  });

  it("черновик, совпадающий с текущей версией, лишней версией не становится", async () => {
    const v = await sendJson<{ id: number }>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      { contentJson: doc("Уже зафиксированный текст.") },
    );
    seedDraft("Уже зафиксированный текст.", 1);
    const proposalId = readyProposal("Текст кандидата.", v.id);

    acceptProposal(t.sqlite, proposalId, {
      requestId: "r1",
      expectedVersionId: v.id,
      expectedDraftRevision: 1,
      acknowledgeUnconfirmed: false,
      acknowledgeContextDrift: false,
    });

    expect(versions().map((x) => x.content_text)).toEqual([
      "Уже зафиксированный текст.",
      "Текст кандидата.",
    ]);
  });
});

describe("восстановление версии (К2)", () => {
  it("черновик становится версией прежде, чем его вытеснит старая версия", async () => {
    const first = await sendJson<{ id: number }>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      { contentJson: doc("Первая версия.") },
    );
    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: doc("Вторая версия."),
    });
    seedDraft("Незакоммиченная работа автора.", 7);

    const res = await send(
      t.app,
      `/api/chapters/${chapterId}/restore/${first.id}`,
      "POST",
    );
    expect(res.status).toBe(200);

    expect(versions().map((v) => v.content_text)).toContain(
      "Незакоммиченная работа автора.",
    );
    const ch = t.sqlite
      .prepare("SELECT current_version_id c FROM chapters WHERE id = ?")
      .get(chapterId) as { c: number };
    expect(ch.c).toBe(first.id);
  });
});

describe("коммит содержимого редактора (К2)", () => {
  it("черновик, отличный от коммитимого текста, сохраняется отдельной версией", async () => {
    seedDraft("Работа автора из редактора.", 3);

    // Ctrl+S из предпросмотра старой версии: клиент шлёт текст версии, а не
    // черновика, и черновик исчезал вместе с работой автора.
    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: doc("Текст старой версии."),
    });

    expect(versions().map((v) => v.content_text)).toEqual([
      "Работа автора из редактора.",
      "Текст старой версии.",
    ]);
  });

  it("коммит самого черновика второй версии не плодит", async () => {
    seedDraft("Ровно то, что в редакторе.", 3);

    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: doc("Ровно то, что в редакторе."),
    });

    expect(versions().map((v) => v.content_text)).toEqual([
      "Ровно то, что в редакторе.",
    ]);
  });

  it("черновик с тем же текстом, но иначе разобранным документом, версии не плодит", async () => {
    // Редактор нормализует документ при загрузке, и строка JSON черновика,
    // записанная сервером раньше, перестаёт совпадать байт в байт. Автор при
    // этом ничего не менял — вторая версия была бы чистым шумом.
    t.sqlite
      .prepare(
        `INSERT INTO chapter_drafts
           (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
         VALUES (?, ?, 'Тот же текст.', 2, NULL, 1, ?)`,
      )
      .run(
        chapterId,
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { textAlign: null },
              content: [{ type: "text", text: "Тот же текст." }],
            },
          ],
        }),
        new Date().toISOString(),
      );

    await send(t.app, `/api/chapters/${chapterId}/versions`, "POST", {
      contentJson: doc("Тот же текст."),
    });

    expect(versions().map((v) => v.content_text)).toEqual(["Тот же текст."]);
  });
});

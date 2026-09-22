import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
}
interface VersionJson {
  id: number;
}
interface ReportJson {
  id: number;
  chapterVersionId: number;
  status: string;
  errorMessage: string | null;
}

let t: TestApp;
let versionId: number;
let bookId: number;
let chapterId: number;

beforeEach(async () => {
  t = makeTestApp();
  // Force ANTHROPIC_API_KEY missing to make critique fail fast (no real LLM call).
  delete process.env.ANTHROPIC_API_KEY;

  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "C-test",
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
            content: [{ type: "text", text: "Текст главы для критики." }],
          },
        ],
      },
    },
  );
  versionId = v.id;
  bookId = b.id;
  chapterId = ch.id;
});
afterEach(() => t.cleanup());

describe("critique endpoints", () => {
  it("GET returns null when no report exists", async () => {
    const res = await sendJson<ReportJson | null>(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "GET",
    );
    expect(res).toBeNull();
  });

  it("404 when chapter_version missing", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/9999/critique`,
      "GET",
    );
    expect(res.status).toBe(404);
  });

  it("POST without API key returns error report (no real LLM)", async () => {
    const r = await sendJson<ReportJson>(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "POST",
      {},
    );
    expect(r.id).toBeGreaterThan(0);
    expect(["error", "done"]).toContain(r.status);
    if (r.status === "error") {
      expect(r.errorMessage).toBeTruthy();
    }
  });

  it("все критики упали — статус error, а не done (AC-27)", async () => {
    // ANTHROPIC_API_KEY удалён в beforeEach: каждый критик падает на старте.
    const r = await sendJson<{
      status: string;
      errorMessage: string | null;
      report: { requestedCritics: string[]; failedCritics: string[] } | null;
    }>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

    expect(r.status).toBe("error");
    expect(r.errorMessage).toBeTruthy();
    expect(r.report?.failedCritics).toHaveLength(4);
    expect(r.report?.requestedCritics).toHaveLength(4);
  });

  it("статус считается от числа запрошенных критиков, а не от длины списка успешных", async () => {
    const r = await sendJson<{
      status: string;
      report: { requestedCritics: string[]; failedCritics: string[] } | null;
    }>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {
      critics: ["style"],
    });
    expect(r.report?.requestedCritics).toEqual(["style"]);
    expect(r.status).toBe("error");
  });

  it("POST validates `critics` field", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "POST",
      { critics: [] },
    );
    expect(res.status).toBe(400);
  });

  it("POST 404 for missing version", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/9999/critique`,
      "POST",
      {},
    );
    expect(res.status).toBe(404);
  });

  it("DELETE removes report", async () => {
    await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "POST",
      {},
    );
    const del = await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "DELETE",
    );
    expect(del.status).toBe(204);
    const after = await sendJson<ReportJson | null>(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "GET",
    );
    expect(after).toBeNull();
  });

  it("DELETE returns 404 when nothing to delete", async () => {
    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/critique`,
      "DELETE",
    );
    expect(res.status).toBe(404);
  });
});

describe("отпечаток базы в отчёте критики (AC-13)", () => {
  interface ReportWithContext {
    report: { contextFingerprint?: string; baseChanged?: boolean | null } | null;
  }
  const run = () =>
    sendJson<ReportWithContext>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {});

  it("версия не из Writer'а — отпечаток есть, сравнивать нечем", async () => {
    const r = await run();
    expect(r.report?.contextFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(r.report?.baseChanged).toBeNull();
    // Манифест критики записан и привязан к версии.
    const row = t.sqlite
      .prepare("SELECT purpose FROM context_manifests WHERE chapter_version_id = ?")
      .get(versionId) as { purpose: string };
    expect(row.purpose).toBe("critique");
  });

  it("та же база — false; появившаяся ранняя глава — true", async () => {
    const first = await run();
    const fp = first.report!.contextFingerprint!;
    // Как будто версию писал Writer на этой же базе.
    t.sqlite
      .prepare(
        `INSERT INTO context_manifests
           (book_id, chapter_id, chapter_version_id, purpose, fingerprint, manifest_json, created_at)
         VALUES (?, ?, ?, 'writer', ?, '{}', ?)`,
      )
      .run(bookId, chapterId, versionId, fp, new Date().toISOString());
    const same = await run();
    expect(same.report?.baseChanged).toBe(false);

    // Новая глава ПЕРЕД этой с принятой версией меняет набор источников.
    const now = new Date().toISOString();
    const earlier = Number(
      t.sqlite
        .prepare(
          "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, 5, 'Ранняя', ?, ?)",
        )
        .run(bookId, now, now).lastInsertRowid,
    );
    const ev = Number(
      t.sqlite
        .prepare(
          `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
           VALUES (?, '{}', 'Ранний текст.', 2, ?)`,
        )
        .run(earlier, now).lastInsertRowid,
    );
    t.sqlite.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(ev, earlier);
    const changed = await run();
    expect(changed.report?.baseChanged).toBe(true);
    expect(changed.report?.contextFingerprint).not.toBe(fp);
  });
});

// ───────── Критик персонажей: когда он вообще запускается ─────────
//
// На монологе сравнивать не с кем, и вызов тратится впустую. Пропуск — не
// ошибка, но и не зелёный отчёт: панель должна показать, что проверки не
// было (ТЗ 10, этап 5).
describe("critic_character запускается только при двух названных участниках", () => {
  async function addCharacter(name: string): Promise<void> {
    await sendJson(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: name,
      profile: { description: "Герой этой книги." },
    });
  }

  async function runCritique(target = versionId): Promise<{
    report: { requestedCritics: string[]; skippedCritics: string[] } | null;
  }> {
    return sendJson(t.app, `/api/chapter-versions/${target}/critique`, "POST", {});
  }

  /** Участники ищутся по тексту версии, и имя должно стоять с большой буквы:
   *  `mentionsEntityName` требует этого, чтобы «Ян» не находился в «январе». */
  async function versionNaming(...names: string[]): Promise<number> {
    const v = await sendJson<VersionJson>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      {
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: `${names.join(" посмотрел на ")}.` }],
            },
          ],
        },
      },
    );
    return v.id;
  }

  it("героев в сцене нет — критик пропущен и назван пропущенным", async () => {
    const r = await runCritique();
    expect(r.report?.requestedCritics).not.toContain("character");
    expect(r.report?.skippedCritics).toContain("character");
  });

  it("один участник — тоже пропуск", async () => {
    await addCharacter("Нина");
    const r = await runCritique(await versionNaming("Нина"));
    expect(r.report?.requestedCritics).not.toContain("character");
    expect(r.report?.skippedCritics).toContain("character");
  });

  it("двое названных — критик запрошен и не числится пропущенным", async () => {
    await addCharacter("Нина");
    await addCharacter("Ворт");
    const r = await runCritique(await versionNaming("Нина", "Ворт"));
    expect(r.report?.requestedCritics).toContain("character");
    expect(r.report?.skippedCritics ?? []).not.toContain("character");
  });

  it("явно запрошенный критик на монологе всё равно не зовётся впустую", async () => {
    const r = await sendJson<{
      report: { requestedCritics: string[]; skippedCritics: string[] } | null;
      status: string;
    }>(t.app, `/api/chapter-versions/${versionId}/critique`, "POST", {
      critics: ["character"],
    });
    expect(r.report?.skippedCritics).toContain("character");
    // Пустой набор не становится зелёным «всё хорошо» (ТЗ 10).
    expect(r.status).not.toBe("done");
  });
});

// ───────── Локальная правка (этап 5, слайс 3) ─────────
//
// До вызова модели: ссылка на несуществующее замечание — отказ, а не тихое
// игнорирование; фрагмент, которого нет в тексте или который встречается
// дважды, защитить нельзя (AC-29).
describe("repair: выбранные замечания и защищённые фрагменты", () => {
  async function seedReport(): Promise<number> {
    const now = new Date().toISOString();
    return Number(t.sqlite
      .prepare(
        `INSERT INTO critique_reports (chapter_version_id, status, report_json, created_at, completed_at)
         VALUES (?, 'done', ?, ?, ?)`,
      )
      .run(
        versionId,
        JSON.stringify({
          critics: [
            {
              critic: "character",
              overallNotes: "заметки",
              issues: [{ severity: "blocking", summary: "Ворт знает лишнее" }],
            },
          ],
          requestedCritics: ["character"],
          failedCritics: [],
          skippedCritics: [],
          blockingCount: 1,
          suggestionCount: 0,
          nitCount: 0,
          generatedAt: now,
        }),
        now,
        now,
      ).lastInsertRowid);
  }

  async function repair(body: unknown): Promise<{ status: number; text: string }> {
    const res = await send(
      t.app,
      `/api/chapter-versions/${versionId}/repair`,
      "POST",
      body,
    );
    return { status: res.status, text: await res.text() };
  }

  it("ссылка на несуществующее замечание — 400, а не тихое игнорирование", async () => {
    const reportId = await seedReport();
    const r = await repair({ selectedIssueIds: ["style:7"], reportId });
    expect(r.status).toBe(400);
    expect(r.text).toContain("style:7");
  });

  it("выбор из прежнего отчёта — 409, а не правка чужого замечания (F16 ревью 2026-09-22)", async () => {
    const old = await seedReport();
    await new Promise((r) => setTimeout(r, 5));
    await seedReport();
    const r = await repair({ selectedIssueIds: ["character:0"], reportId: old });
    expect(r.status).toBe(409);
    expect(r.text).toContain("report_changed");
  });

  it("выбор без номера отчёта не принимается", async () => {
    await seedReport();
    const r = await repair({ selectedIssueIds: ["character:0"] });
    expect(r.status).toBe(400);
  });

  it("фрагмент, которого нет в главе, защитить нельзя", async () => {
    await seedReport();
    const r = await repair({ protectedFragments: ["Такой строки в главе нет вовсе"] });
    expect(r.status).toBe(400);
    expect(r.text).toMatch(/не найден|not_found/i);
  });

  it("фрагмент, встречающийся дважды, отвергается до вызова модели", async () => {
    await seedReport();
    // «Текст главы для критики.» — единственное предложение версии; повторим
    // его дважды в новой версии, чтобы привязка стала неоднозначной.
    const v = await sendJson<VersionJson>(
      t.app,
      `/api/chapters/${chapterId}/versions`,
      "POST",
      {
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Металл был тёплый. Металл был тёплый." }],
            },
          ],
        },
      },
    );
    const now = new Date().toISOString();
    t.sqlite
      .prepare(
        `INSERT INTO critique_reports (chapter_version_id, status, report_json, created_at, completed_at)
         VALUES (?, 'done', ?, ?, ?)`,
      )
      .run(
        v.id,
        JSON.stringify({
          critics: [{ critic: "style", overallNotes: "з", issues: [] }],
          requestedCritics: ["style"],
          failedCritics: [],
          skippedCritics: [],
          blockingCount: 0,
          suggestionCount: 0,
          nitCount: 0,
          generatedAt: now,
        }),
        now,
        now,
      );
    const res = await send(
      t.app,
      `/api/chapter-versions/${v.id}/repair`,
      "POST",
      { protectedFragments: ["Металл был тёплый."] },
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/дважды|неоднознач|ambiguous/i);
  });
});

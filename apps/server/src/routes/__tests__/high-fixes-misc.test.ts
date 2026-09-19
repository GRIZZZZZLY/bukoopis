import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import { createStudioRepository } from "../../db/studio.js";
import { runIntake } from "../../utils/intake-run.js";
import { recoverStaleCritiqueReports } from "../../utils/critique-recovery.js";

/** Высокие дефекты независимого ревью 2026-09-19:
 *  В2 правка Мастерской во время разбора обнуляла весь разбор;
 *  В8 экспорт не был страховкой;
 *  В13 отчёт критики висел `pending` навсегда после рестарта;
 *  В14 удаление стилевого профиля, привязанного к книге, отвечало 500. */

let t: TestApp;
let bookId: number;

const doc = (text: string): unknown => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(async () => {
  t = makeTestApp();
  delete process.env.ANTHROPIC_API_KEY;
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Книга",
    premise: "Премиса",
  });
  bookId = b.id;
  vi.mocked(runMaterialClassifier).mockReset();
});
afterEach(() => t.cleanup());

describe("приём материала и чужая правка (В2)", () => {
  it("разбор приземляется, даже если автор трогал Мастерскую, пока он шёл", async () => {
    const repo = createStudioRepository(t.sqlite);
    vi.mocked(runMaterialClassifier).mockImplementation(async () => {
      // Автор принимает раздел на другом этапе — ревизия уходит вперёд.
      const state = repo.loadStudioState(bookId);
      repo.patchStudioState(bookId, {
        expectedRevision: state.revision,
        next: {
          ...state,
          stages: {
            ...state.stages,
            lore: { status: "in_progress", playbookGenerated: true, aspects: [] },
          },
        },
      });
      return {
        fragments: [{ target: "world" as const, title: "Карта", body: "тело карты" }],
      };
    });

    const out = await runIntake(
      { sqlite: t.sqlite, hasVec: false, repo, bookId },
      { files: [{ filename: "а.md", content: "текст файла" }] },
    );

    expect(out.summary.map((r) => r.target)).toContain("world");
    const state = repo.loadStudioState(bookId);
    // Лёг и разбор, и чужая правка: ни то ни другое не потеряно.
    expect(state.stages.world?.aspects.map((a) => a.name)).toEqual(["Карта"]);
    expect(state.stages.lore).toBeDefined();
  });
});

describe("экспорт как страховка (В8)", () => {
  it("json-выгрузка несёт всё, что автор мог потерять", async () => {
    const ch = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Глава" },
    );
    await send(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
      contentJson: doc("Текст первой версии."),
    });
    await send(t.app, `/api/chapters/${ch.id}/draft`, "PUT", {
      contentJson: doc("Незакоммиченная работа."),
    });
    await send(t.app, `/api/books/${bookId}/characters`, "POST", {
      canonicalName: "Анна",
      profile: { name: "Анна", description: "Смотритель" },
    });
    const conceptRes = await send(
      t.app,
      `/api/books/${bookId}/concept`,
      "PATCH",
      {
        schemaVersion: 1,
        idea: "Замысел книги",
        pitches: [],
        premise: {},
        audience: "adult",
      },
    );
    expect(conceptRes.status).toBe(200);

    const res = await send(t.app, `/api/books/${bookId}/export.json`, "GET");
    expect(res.status).toBe(200);
    const dump = (await res.json()) as {
      book: { title: string };
      concept: { idea?: string } | null;
      chapters: Array<{ title: string; versions: unknown[]; draft: unknown }>;
      characters: Array<{ canonicalName: string }>;
    };

    expect(dump.book.title).toBe("Книга");
    expect(dump.concept?.idea).toBe("Замысел книги");
    expect(dump.chapters).toHaveLength(1);
    expect(dump.chapters[0]!.versions).toHaveLength(1);
    // Черновик — единственная копия несохранённой работы, и он в выгрузке.
    expect(dump.chapters[0]!.draft).not.toBeNull();
    expect(dump.characters.map((c) => c.canonicalName)).toEqual(["Анна"]);
  });

  it("markdown отдаёт черновик, когда он новее версии, и помечает это", async () => {
    const ch = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Глава" },
    );
    await send(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
      contentJson: doc("Старая версия."),
    });
    await send(t.app, `/api/chapters/${ch.id}/draft`, "PUT", {
      contentJson: doc("Свежий черновик."),
    });

    const res = await send(t.app, `/api/books/${bookId}/export.md`, "GET");
    const md = await res.text();
    expect(md).toContain("Свежий черновик.");
    expect(md).toContain("черновик");
  });
});

describe("восстановление отчётов критики (В13)", () => {
  it("зависший после рестарта pending становится ошибкой, а не вечным ожиданием", async () => {
    const ch = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Глава" },
    );
    const v = await sendJson<{ id: number }>(
      t.app,
      `/api/chapters/${ch.id}/versions`,
      "POST",
      { contentJson: doc("Текст главы.") },
    );
    t.sqlite
      .prepare(
        "INSERT INTO critique_reports (chapter_version_id, status, created_at) VALUES (?, 'pending', ?)",
      )
      .run(v.id, new Date().toISOString());

    const recovered = recoverStaleCritiqueReports(t.sqlite);
    expect(recovered).toBe(1);

    const report = await sendJson<{ status: string; errorMessage: string | null }>(
      t.app,
      `/api/chapter-versions/${v.id}/critique`,
      "GET",
    );
    expect(report.status).toBe("error");
    expect(report.errorMessage).toBeTruthy();
  });
});

describe("удаление стилевого профиля (В14)", () => {
  it("профиль, привязанный к книге, удаляется, а книга остаётся без стиля", async () => {
    const profile = await sendJson<{ id: number }>(
      t.app,
      "/api/style-profiles",
      "POST",
      { name: "Профиль" },
    );
    await send(t.app, `/api/books/${bookId}`, "PATCH", {
      styleProfileId: profile.id,
    });

    const res = await send(t.app, `/api/style-profiles/${profile.id}`, "DELETE");
    expect(res.status).toBe(204);

    const book = await sendJson<{ styleProfileId: number | null }>(
      t.app,
      `/api/books/${bookId}`,
      "GET",
    );
    expect(book.styleProfileId).toBeNull();
  });
});

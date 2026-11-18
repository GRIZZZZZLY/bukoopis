import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  runChapterWriter: vi.fn(),
  runSceneIntent: vi.fn(),
  runLocalScene: vi.fn(),
  localWriterKind: vi.fn(),
  runScenePlan: vi.fn(),
}));

import {
  runLocalScene,
  localWriterKind,
  runScenePlan,
  runChapterWriter,
  runSceneIntent,
} from "@book-forge/agents";
import { makeTestApp, sendJson } from "../../routes/__tests__/_helpers.js";
import { runLiveChapter, liveChapterMain, type LiveOptions } from "../live-chapter.js";

const localMock = vi.mocked(runLocalScene);
const availableMock = vi.mocked(localWriterKind);
const scenePlanMock = vi.mocked(runScenePlan);
const writerMock = vi.mocked(runChapterWriter);
const sceneIntentMock = vi.mocked(runSceneIntent);

let dir: string;
let srcPath: string;
let outDir: string;
let bookId: number;
let firstId: number;
let secondId: number;
let lines: string[];

function plan(beats: number, estimatedWords: number) {
  return {
    variants: [
      {
        label: "v1",
        pov: "Нина",
        emotionalGoal: "тревога",
        estimatedWords,
        beats: Array.from({ length: beats }, (_, i) => ({
          index: i,
          type: "rising_action",
          summary: `беат ${i}`,
          goal: "g",
          conflict: "c",
          outcome: "o",
        })),
      },
    ],
    selectedIndex: 0,
    generatedAt: "2026-11-17T00:00:00.000Z",
  };
}

const DRAFT_TEXT = "Он шёл по дороге и думал о доме.\n\nДверь закрылась за ним тихо.";
const DRAFT_JSON = JSON.stringify({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Он шёл по дороге и думал о доме." }] },
    { type: "paragraph", content: [{ type: "text", text: "Дверь закрылась за ним тихо." }] },
  ],
});

/** Источник: книга на Anthropic, глава 1 только с черновиком, глава 2 с планом. */
beforeEach(async () => {
  const t = makeTestApp();
  dir = t.dbDir;
  srcPath = join(dir, "test.sqlite");
  outDir = mkdtempSync(join(tmpdir(), "bookforge-live-"));
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К", premise: "п" });
  bookId = b.id;
  firstId = (await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Первая" })).id;
  secondId = (await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/chapters`, "POST", { title: "Вторая" })).id;
  t.sqlite
    .prepare(
      "INSERT INTO chapter_drafts (chapter_id, content_json, content_text, word_count, revision, updated_at) VALUES (?, ?, ?, 13, 1, ?)",
    )
    .run(firstId, DRAFT_JSON, DRAFT_TEXT, new Date().toISOString());
  // 14 беатов на 1200 слов — две сцены.
  t.sqlite
    .prepare("UPDATE chapters SET plan_json = ?, active_plan_kind = 'beats' WHERE id = ?")
    .run(JSON.stringify(plan(14, 1200)), secondId);
  t.close();
  t.sqlite.close();

  localMock.mockReset();
  availableMock.mockReset();
  scenePlanMock.mockReset();
  writerMock.mockReset();
  sceneIntentMock.mockReset();
  availableMock.mockResolvedValue("raw");
  let n = 0;
  localMock.mockImplementation(async function* () {
    const text = `Сцена ${n++}.`;
    yield text;
    return { text, modelId: "bookopis:latest", stopReason: "end_turn", tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 } };
  });
  lines = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

function options(over: Partial<LiveOptions> = {}): LiveOptions {
  return {
    bookId,
    chapterId: secondId,
    newTitle: null,
    intent: null,
    model: "bookopis:latest",
    saveDrafts: false,
    scenePlan: false,
    timeoutMin: 15,
    db: srcPath,
    out: outDir,
    ...over,
  };
}

const deps = () => ({ log: (l: string) => lines.push(l) });

function copy(): Database.Database {
  return new Database(join(outDir, "db.sqlite"), { readonly: true });
}

describe("live chapter check", () => {
  it("source database is unchanged", async () => {
    const before = readFileSync(srcPath);
    const r = await runLiveChapter(options({ saveDrafts: true }), deps());
    expect(r.exitCode).toBe(0);
    expect(readFileSync(srcPath).equals(before)).toBe(true);
    // Чтение WAL-базы оставляет пустой журнал рядом; записей в нём быть не должно.
    const wal = `${srcPath}-wal`;
    expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
    const db = copy();
    try {
      const p = db.prepare("SELECT status FROM prose_proposals WHERE chapter_id = ?").all(secondId);
      expect(p).toEqual([{ status: "ready" }]);
    } finally {
      db.close();
    }
  });

  it("writes report files", async () => {
    await runLiveChapter(options(), deps());
    expect(readFileSync(join(outDir, "chapter.txt"), "utf8")).toBe("Сцена 0.\n\nСцена 1.");
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    expect(report.metrics.scenes).toHaveLength(2);
    expect(report.metrics.words).toBe(4);
    expect(report.modelId).toBe("bookopis:latest");
    expect(report.options.model).toBe("bookopis:latest");
    const md = readFileSync(join(outDir, "report.md"), "utf8");
    expect(md).toContain("| Сцен | 2 |");
    expect(lines.join("\n")).toContain("| Сцен | 2 |");
  });

  it("save-drafts gives the previous chapter a version", async () => {
    await runLiveChapter(options({ saveDrafts: true }), deps());
    expect(localMock.mock.calls[0]![0].prompt).toMatch(/\nМанера: повествование от третьего лица/u);
    const db = copy();
    try {
      const v = db.prepare("SELECT content_text, word_count, source FROM chapter_versions WHERE chapter_id = ?").all(firstId);
      expect(v).toEqual([{ content_text: DRAFT_TEXT, word_count: 13, source: "manual" }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM chapter_drafts WHERE chapter_id = ?").get(firstId)).toEqual({ n: 0 });
      // Память не трогаем: задания памяти позвали бы Claude.
      expect(db.prepare("SELECT COUNT(*) AS n FROM memory_jobs").get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    expect(report.metrics.previousPerson).toBe("third");
    expect(report.metrics.personKept).toBe(true);
  });

  it("without save-drafts the first scene has no manner", async () => {
    await runLiveChapter(options(), deps());
    expect(localMock.mock.calls[0]![0].prompt).not.toContain("Манера:");
  });

  it("model unavailable", async () => {
    availableMock.mockResolvedValue("unavailable");
    const r = await runLiveChapter(options(), deps());
    expect(r.exitCode).toBe(1);
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    expect(report.failures.join("\n")).toContain(
      "Модель bookopis:latest недоступна в Ollama: запустите Ollama и повторите.",
    );
    expect(readFileSync(join(outDir, "report.md"), "utf8")).toContain("недоступна в Ollama");
    expect(localMock).not.toHaveBeenCalled();
  });

  it("new chapter from title and intent; scene plan saved", async () => {
    scenePlanMock.mockResolvedValue({ scenes: [{ events: ["раз", "два", "три"] }] });
    const r = await runLiveChapter(
      options({ chapterId: null, newTitle: "Третья", intent: "Герой уходит из дома.", scenePlan: true }),
      deps(),
    );
    expect(r.exitCode).toBe(0);
    expect(scenePlanMock).toHaveBeenCalledTimes(1);
    expect(scenePlanMock.mock.calls[0]![0].chapterContent).toBe("Герой уходит из дома.");
    expect(JSON.parse(readFileSync(join(outDir, "scene-plan.json"), "utf8")).scenes).toHaveLength(1);
    expect(localMock).toHaveBeenCalledTimes(1);
  });

  it("book not on our model is refused before any call", async () => {
    const r = await runLiveChapter(options({ model: null }), deps());
    expect(r.exitCode).toBe(1);
    expect(r.report.failures).toEqual([
      "Писатель книги — не наша модель. Укажите --model <тег Ollama>, и проверка пойдёт на ней.",
    ]);
    expect(availableMock).not.toHaveBeenCalled();
    expect(writerMock).not.toHaveBeenCalled();
  });

  it("chat model is refused: no Writer, no scene intent", async () => {
    availableMock.mockResolvedValue("chat");
    const r = await runLiveChapter(options({ model: "qwen:chat" }), deps());
    expect(r.exitCode).toBe(1);
    expect(r.report.failures).toEqual([
      "Модель qwen:chat в Ollama работает как чат-модель. Живая проверка меряет только нашу дообученную модель с сырым шаблоном: укажите её тег в --model.",
    ]);
    expect(writerMock).not.toHaveBeenCalled();
    expect(sceneIntentMock).not.toHaveBeenCalled();
    expect(localMock).not.toHaveBeenCalled();
  });

  it("time limit cancels the write and keeps what was written", async () => {
    let n = 0;
    localMock.mockImplementation(async function* (input: { signal?: AbortSignal }) {
      if (n++ === 0) {
        yield "Сцена 0.";
        return { text: "Сцена 0.", modelId: "bookopis:latest", stopReason: "end_turn", tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 } };
      }
      // Вторая сцена не отдаёт ни слова, пока её не отменят.
      await new Promise((_, reject) =>
        input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
      throw new Error("unreachable");
    } as unknown as typeof runLocalScene);
    const t0 = Date.now();
    const r = await runLiveChapter(options({ timeoutMin: 0.01 }), deps());
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(r.exitCode).toBe(1);
    expect(r.report.failures[0]).toBe(
      "Время вышло: глава писалась дольше 0.01 мин, запись остановлена. Что успело написаться — в chapter.txt.",
    );
    expect(readFileSync(join(outDir, "chapter.txt"), "utf8")).toContain("Сцена 0.");
    const db = copy();
    try {
      expect(db.prepare("SELECT status FROM prose_proposals WHERE chapter_id = ?").all(secondId)).toEqual([
        { status: "cancelled" },
      ]);
    } finally {
      db.close();
    }
  });

  it("a pending memory job in the source stays pending in the copy", async () => {
    const src = new Database(srcPath);
    try {
      const now = new Date().toISOString();
      const v = src
        .prepare(
          "INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, source, created_at) VALUES (?, ?, ?, 13, 'manual', ?)",
        )
        .run(firstId, DRAFT_JSON, DRAFT_TEXT, now);
      src.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(v.lastInsertRowid, firstId);
      // Короткая версия: задание «summary» исполнитель закрыл бы без модели, и
      // перемену статуса было бы видно.
      src
        .prepare(
          "INSERT INTO memory_jobs (book_id, chapter_id, chapter_version_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, 'summary', 'pending', ?, ?)",
        )
        .run(bookId, firstId, v.lastInsertRowid, now, now);
    } finally {
      src.close();
    }
    const r = await runLiveChapter(options(), deps());
    expect(r.exitCode).toBe(0);
    const db = copy();
    try {
      expect(db.prepare("SELECT kind, status FROM memory_jobs").all()).toEqual([
        { kind: "summary", status: "pending" },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("argument errors", () => {
  it("no --book", async () => {
    const out: string[] = [];
    expect(await liveChapterMain(["--chapter", "1"], { log: (l) => out.push(l) })).toBe(2);
    expect(out.join("\n")).toContain("--book");
  });

  it("both --chapter and --new-title", async () => {
    const out: string[] = [];
    const code = await liveChapterMain(
      ["--book", "1", "--chapter", "2", "--new-title", "Т", "--intent", "и"],
      { log: (l) => out.push(l) },
    );
    expect(code).toBe(2);
    expect(out.join("\n")).toMatch(/--chapter.*--new-title|--new-title.*--chapter/u);
  });

  it("bad --timeout-min", async () => {
    const out: string[] = [];
    const code = await liveChapterMain(["--book", "1", "--chapter", "2", "--timeout-min", "0"], {
      log: (l) => out.push(l),
    });
    expect(code).toBe(2);
    expect(out[0]).toBe("--timeout-min ждёт число минут больше нуля, получено «0».");
  });
});

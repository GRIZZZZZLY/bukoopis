import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents/intake/classifier", () => ({
  runMaterialClassifier: vi.fn(),
}));

import { runMaterialClassifier } from "@book-forge/agents/intake/classifier";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioRepository } from "../../db/studio.js";
import { runIntake, IntakeBookNotFoundError, type IntakeFileEvent } from "../intake-run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let dir: string;
let sqlite: Database.Database;
let repo: ReturnType<typeof createStudioRepository>;
let bookId: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intake-run-"));
  sqlite = new Database(join(dir, "t.sqlite"));
  migrate(drizzle(sqlite), {
    migrationsFolder: resolve(__dirname, "../../../drizzle"),
  });
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO books (title, language, status, created_at, updated_at)
       VALUES ('Приём', 'ru', 'draft', ?, ?)`,
    )
    .run(now, now);
  bookId = Number(info.lastInsertRowid);
  repo = createStudioRepository(sqlite);
  vi.mocked(runMaterialClassifier).mockReset();
});

afterEach(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const deps = () => ({ sqlite, hasVec: false, repo, bookId });
const file = (n: string) => ({ filename: n, content: `# ${n}\nтекст файла ${n}` });

function worldFragment(title: string) {
  return { fragments: [{ target: "world" as const, title, body: `тело ${title}` }] };
}

describe("runIntake", () => {
  it("throws IntakeBookNotFoundError for an unknown book", async () => {
    await expect(
      runIntake({ ...deps(), bookId: 9999 }, { files: [file("а.md")] }),
    ).rejects.toBeInstanceOf(IntakeBookNotFoundError);
  });

  it("reports started and done for each file, in order, with its targets", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce(worldFragment("Карта"))
      .mockResolvedValueOnce(worldFragment("Кухня"));
    const events: IntakeFileEvent[] = [];
    const out = await runIntake(deps(), {
      files: [file("а.md"), file("б.md")],
      onFile: (e) => events.push(e),
    });
    expect(events.map((e) => [e.index, e.filename, e.status])).toEqual([
      [0, "а.md", "started"],
      [0, "а.md", "done"],
      [1, "б.md", "started"],
      [1, "б.md", "done"],
    ]);
    expect(events.every((e) => e.total === 2)).toBe(true);
    expect(events[1]!.targets).toEqual(["world"]);
    expect(out.cancelled).toBe(false);
    expect(out.replayed).toBe(false);
    expect(out.summary.map((r) => [r.target, r.count])).toEqual([["world", 2]]);
  });

  it("reports a failed file with its message and keeps going", async () => {
    vi.mocked(runMaterialClassifier)
      .mockRejectedValueOnce(new Error("LLM failure"))
      .mockResolvedValueOnce(worldFragment("Кухня"));
    const events: IntakeFileEvent[] = [];
    const out = await runIntake(deps(), {
      files: [file("а.md"), file("б.md")],
      onFile: (e) => events.push(e),
    });
    const failed = events.find((e) => e.status === "failed");
    expect(failed).toMatchObject({ index: 0, filename: "а.md", message: "LLM failure" });
    expect(out.failures).toEqual([{ filename: "а.md", message: "LLM failure" }]);
    expect(out.summary.map((r) => r.target)).toEqual(["world"]);
  });

  it("stops starting files once shouldStop says so, and keeps what was classified", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    let stop = false;
    const out = await runIntake(deps(), {
      files: [file("а.md"), file("б.md"), file("в.md")],
      onFile: (e) => {
        if (e.index === 0 && e.status === "done") stop = true;
      },
      shouldStop: () => stop,
    });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect(out.cancelled).toBe(true);
    expect(out.summary.map((r) => [r.target, r.count])).toEqual([["world", 1]]);
    const state = repo.loadStudioState(bookId);
    expect(state.stages.world?.aspects).toHaveLength(1);
  });

  it("replays a previous run for the same files without calling the agent", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const first = await runIntake(deps(), { files: [file("а.md")] });
    const events: IntakeFileEvent[] = [];
    const again = await runIntake(deps(), {
      files: [file("а.md")],
      onFile: (e) => events.push(e),
    });
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);
    expect(again.replayed).toBe(true);
    expect(events).toEqual([]);
    expect(again.summary).toEqual(first.summary);
    expect(repo.loadStudioState(bookId).stages.world?.aspects).toHaveLength(1);
  });

  it("classifies only what a stopped run never reached when the same folder comes back", async () => {
    // Остановка на третьем файле журналировала ответ под ключом всех одиннадцати:
    // повторное перетаскивание той же папки — самый естественный следующий шаг —
    // мгновенно «проигрывалось», и восемь файлов не разбирались никогда.
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce(worldFragment("Карта"))
      .mockResolvedValueOnce(worldFragment("Кухня"))
      .mockResolvedValueOnce(worldFragment("Порт"));
    const files = [file("а.md"), file("б.md"), file("в.md")];
    let stop = false;
    const first = await runIntake(deps(), {
      files,
      onFile: (e) => {
        if (e.index === 0 && e.status === "done") stop = true;
      },
      shouldStop: () => stop,
    });
    expect(first.cancelled).toBe(true);
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(1);

    const events: IntakeFileEvent[] = [];
    const again = await runIntake(deps(), { files, onFile: (e) => events.push(e) });
    expect(again.replayed).toBe(false);
    expect(vi.mocked(runMaterialClassifier).mock.calls.map((c) => c[0].filename)).toEqual([
      "а.md",
      "б.md",
      "в.md",
    ]);
    // Уже разобранное не перечитывается — ни вызовом, ни строкой прогресса.
    expect(events.map((e) => [e.filename, e.status])).toEqual([
      ["б.md", "started"],
      ["б.md", "done"],
      ["в.md", "started"],
      ["в.md", "done"],
    ]);
    expect(events.every((e) => e.total === 2)).toBe(true);
    // И ничего не удвоилось: три файла — три аспекта.
    expect(repo.loadStudioState(bookId).stages.world?.aspects.map((a) => a.name)).toEqual([
      "Карта",
      "Кухня",
      "Порт",
    ]);
    // Сводка честная: автор видит и то, что легло сейчас, и то, что успело лечь
    // до остановки.
    expect(again.summary.map((r) => [r.target, r.count])).toEqual([["world", 3]]);
    expect(again.summary[0]!.titles).toEqual(["Карта", "Кухня", "Порт"]);
  });

  it("replays untouched once every file of the folder has been processed", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce(worldFragment("Карта"))
      .mockResolvedValueOnce(worldFragment("Кухня"));
    const files = [file("а.md"), file("б.md")];
    let stop = false;
    await runIntake(deps(), {
      files,
      onFile: (e) => {
        if (e.index === 0 && e.status === "done") stop = true;
      },
      shouldStop: () => stop,
    });
    const second = await runIntake(deps(), { files });
    expect(second.replayed).toBe(false);
    const third = await runIntake(deps(), { files });
    expect(third.replayed).toBe(true);
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(2);
    expect(third.summary).toEqual(second.summary);
    expect(repo.loadStudioState(bookId).stages.world?.aspects).toHaveLength(2);
  });

  it("gives a file that failed another chance instead of replaying its failure", async () => {
    vi.mocked(runMaterialClassifier)
      .mockResolvedValueOnce(worldFragment("Карта"))
      .mockRejectedValueOnce(new Error("LLM failure"));
    const files = [file("а.md"), file("б.md")];
    const first = await runIntake(deps(), { files });
    expect(first.failures).toEqual([{ filename: "б.md", message: "LLM failure" }]);

    vi.mocked(runMaterialClassifier).mockResolvedValueOnce(worldFragment("Кухня"));
    const again = await runIntake(deps(), { files });
    expect(again.replayed).toBe(false);
    expect(vi.mocked(runMaterialClassifier).mock.calls.map((c) => c[0].filename)).toEqual([
      "а.md",
      "б.md",
      "б.md",
    ]);
    expect(again.failures).toEqual([]);
    expect(repo.loadStudioState(bookId).stages.world?.aspects.map((a) => a.name)).toEqual([
      "Карта",
      "Кухня",
    ]);
  });

  it("finds the stopped run by its key even after another folder was dropped in between", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const files = [file("а.md"), file("б.md")];
    let stop = false;
    await runIntake(deps(), {
      files,
      onFile: (e) => {
        if (e.index === 0 && e.status === "done") stop = true;
      },
      shouldStop: () => stop,
    });
    // Чужое перетаскивание пишет свой import_merge — прежний поиск «последнего
    // события» терял след прерванного прогона, и тот разбирался целиком заново,
    // дублируя уже лежащий аспект.
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Другое"));
    await runIntake(deps(), { files: [file("чужой.md")] });

    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Кухня"));
    const events: IntakeFileEvent[] = [];
    await runIntake(deps(), { files, onFile: (e) => events.push(e) });
    expect(events.map((e) => e.filename)).toEqual(["б.md", "б.md"]);
    expect(repo.loadStudioState(bookId).stages.world?.aspects.map((a) => a.name)).toEqual([
      "Карта",
      "Другое",
      "Кухня",
    ]);
  });

  it("replays an old journal entry that never recorded which files it read", async () => {
    // События, записанные до дочитывания, не знают своего processedFiles. Верить
    // им целиком — единственный безопасный вариант: иначе повтор разобрал бы
    // папку заново и удвоил всё, что уже лежит на этапах.
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const files = [file("а.md"), file("б.md")];
    const first = await runIntake(deps(), { files });
    const row = sqlite
      .prepare("SELECT id, payload FROM studio_events WHERE event_type = 'import_merge'")
      .get() as { id: number; payload: string };
    const payload = JSON.parse(row.payload) as { note: string; after: Record<string, unknown> };
    delete payload.after.processedFiles;
    delete payload.after.landed;
    sqlite
      .prepare("UPDATE studio_events SET payload = ? WHERE id = ?")
      .run(JSON.stringify(payload), row.id);

    const again = await runIntake(deps(), { files });
    expect(again.replayed).toBe(true);
    expect(vi.mocked(runMaterialClassifier)).toHaveBeenCalledTimes(2);
    expect(again.summary).toEqual(first.summary);
  });

  it("does not journal a run that achieved nothing", async () => {
    vi.mocked(runMaterialClassifier).mockRejectedValue(new Error("нет ключа"));
    await runIntake(deps(), { files: [file("а.md")] });
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const second = await runIntake(deps(), { files: [file("а.md")] });
    expect(second.replayed).toBe(false);
    expect(second.summary.map((r) => r.target)).toEqual(["world"]);
  });

  it("calls onBegin once with the request key and file count, before the first file starts", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const calls: Array<{ requestKey: string; total: number }> = [];
    const events: IntakeFileEvent[] = [];
    const out = await runIntake(deps(), {
      files: [file("а.md"), file("б.md")],
      onBegin: (e) => calls.push(e),
      onFile: (e) => events.push(e),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.total).toBe(2);
    expect(calls[0]!.requestKey).toBe(out.requestKey);
    expect(out.requestKey.length).toBeGreaterThan(0);
    // onBegin fired before any file event.
    expect(events[0]!.status).toBe("started");
  });

  it("does not call onBegin on the replay path, since no work is done", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    await runIntake(deps(), { files: [file("а.md")] });
    const calls: Array<{ requestKey: string; total: number }> = [];
    const again = await runIntake(deps(), {
      files: [file("а.md")],
      onBegin: (e) => calls.push(e),
    });
    expect(again.replayed).toBe(true);
    expect(calls).toEqual([]);
  });

  it("does not let a throwing onFile consumer break the run", async () => {
    vi.mocked(runMaterialClassifier).mockResolvedValue(worldFragment("Карта"));
    const out = await runIntake(deps(), {
      files: [file("а.md")],
      onFile: () => {
        throw new Error("consumer exploded");
      },
    });
    expect(out.summary.map((r) => [r.target, r.count])).toEqual([["world", 1]]);
  });
});

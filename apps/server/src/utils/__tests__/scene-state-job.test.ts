import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  summarizeChapter: vi.fn(),
  extractCanonFacts: vi.fn(),
  extractCharacterEvents: vi.fn(),
  extractEpisodicNotes: vi.fn(),
  metaSummarize: vi.fn(),
  runSceneStateExtractor: vi.fn(),
}));

import { runSceneStateExtractor } from "@book-forge/agents";
import {
  enqueueMemoryJobs,
  completeMemoryJob,
  ENQUEUE_JOB_KINDS,
  type MemoryJobRow,
} from "../memory-queue.js";
import { tryActivateMemoryVersion } from "../memory-activation.js";
import { startMemoryWorker } from "../memory-worker.js";
import { loadSceneStateForVersion, saveSceneState } from "../scene-state.js";
import { sceneStateSchema } from "@book-forge/shared";

/**
 * Задание `scene_state`: ставится вместе с остальными, но активации памяти не
 * держит (AC-1, AC-3) и авторскую анкету не затирает.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-21T00:00:00.000Z";
const LONG_TEXT = Array.from({ length: 120 }, (_, i) => `слово${i}`).join(" ");

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;
let chapterId: number;
let versionId: number;

function jobsOf(kind?: string): MemoryJobRow[] {
  const sql = kind
    ? "SELECT * FROM memory_jobs WHERE chapter_version_id = ? AND kind = ?"
    : "SELECT * FROM memory_jobs WHERE chapter_version_id = ?";
  const args = kind ? [versionId, kind] : [versionId];
  return sqlite.prepare(sql).all(...args) as MemoryJobRow[];
}

beforeEach(() => {
  vi.mocked(runSceneStateExtractor).mockReset();
  dbDir = mkdtempSync(join(tmpdir(), "scene-state-job-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  bookId = Number(
    sqlite
      .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
  chapterId = Number(
    sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, 10, 'Прилив', ?, ?)",
      )
      .run(bookId, NOW, NOW).lastInsertRowid,
  );
  versionId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', ?, 120, ?)`,
      )
      .run(chapterId, LONG_TEXT, NOW).lastInsertRowid,
  );
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(versionId, chapterId);
  enqueueMemoryJobs(sqlite, {
    bookId,
    chapterId,
    chapterVersionId: versionId,
    kinds: ENQUEUE_JOB_KINDS,
  });
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("задание scene_state в очереди", () => {
  it("ставится вместе с четырьмя прежними (AC-1)", () => {
    expect(jobsOf().map((j) => j.kind).sort()).toEqual([
      "facts",
      "index",
      "notes",
      "scene_state",
      "summary",
    ]);
  });

  it("его отказ не держит активацию памяти версии (AC-3)", () => {
    for (const kind of ["index", "summary", "facts", "notes"] as const) {
      const job = jobsOf(kind)[0]!;
      completeMemoryJob(sqlite, job.id, kind === "facts" ? { factCount: 0 } : {});
    }
    sqlite
      .prepare("UPDATE memory_jobs SET status='error' WHERE id = ?")
      .run(jobsOf("scene_state")[0]!.id);

    expect(tryActivateMemoryVersion(sqlite, chapterId, versionId)).toBe("activated");
    const ch = sqlite
      .prepare("SELECT memory_version_id v FROM chapters WHERE id = ?")
      .get(chapterId) as { v: number | null };
    expect(ch.v).toBe(versionId);
  });
});

describe("обработчик scene_state", () => {
  async function drainSceneState(): Promise<void> {
    const worker = startMemoryWorker(sqlite, false, { autoStart: false });
    await worker.drain({ kinds: ["scene_state"] });
    worker.stop();
  }

  it("пишет анкету версии по ответу модели", async () => {
    vi.mocked(runSceneStateExtractor).mockResolvedValue({
      place: "причал",
      timeMarker: "поздний вечер",
      present: ["Нина — у воды"],
      appearance: [],
      carried: [{ name: "Нина", value: "ключ от склада" }],
      condition: [],
      surroundings: [],
      loose: [],
      changes: [],
    });
    await drainSceneState();

    const row = loadSceneStateForVersion(sqlite, versionId);
    expect(row?.origin).toBe("llm");
    expect(row?.state.place).toBe("причал");
    expect(jobsOf("scene_state")[0]!.status).toBe("done");
  });

  it("не затирает авторскую анкету запоздавшим разбором", async () => {
    saveSceneState(sqlite, {
      bookId,
      chapterId,
      chapterVersionId: versionId,
      state: sceneStateSchema.parse({ place: "склад, как правил автор" }),
      origin: "manual",
    });
    vi.mocked(runSceneStateExtractor).mockResolvedValue({
      place: "причал",
      timeMarker: null,
      present: [],
      appearance: [],
      carried: [],
      condition: [],
      surroundings: [],
      loose: [],
      changes: [],
    });
    await drainSceneState();

    const row = loadSceneStateForVersion(sqlite, versionId);
    expect(row?.origin).toBe("manual");
    expect(row?.state.place).toBe("склад, как правил автор");
    expect(
      JSON.parse(jobsOf("scene_state")[0]!.result_json ?? "{}") as { skipped?: string },
    ).toEqual({ skipped: "manual" });
  });

  it("короткая глава пропускается с причиной, строки нет (AC-7)", async () => {
    sqlite
      .prepare("UPDATE chapter_versions SET word_count = 10, content_text = 'Три слова тут.' WHERE id = ?")
      .run(versionId);
    await drainSceneState();

    expect(runSceneStateExtractor).not.toHaveBeenCalled();
    expect(loadSceneStateForVersion(sqlite, versionId)).toBeNull();
    expect(
      JSON.parse(jobsOf("scene_state")[0]!.result_json ?? "{}") as { skipped?: string },
    ).toEqual({ skipped: "short" });
  });
});

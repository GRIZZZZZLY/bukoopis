import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sqliteVec from "sqlite-vec";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  summarizeChapter: vi.fn(),
  extractCanonFacts: vi.fn(),
  extractEpisodicNotes: vi.fn(),
  metaSummarize: vi.fn(),
}));

import {
  summarizeChapter,
  extractCanonFacts,
  extractEpisodicNotes,
  metaSummarize,
} from "@book-forge/agents";
import { bootstrapVirtualTables } from "../../db/virtual.js";
import {
  enqueueMemoryJobs,
  claimNextMemoryJob,
  completeMemoryJob,
  failMemoryJob,
  recoverStaleMemoryJobs,
  retryBackoffMs,
  COMMIT_JOB_KINDS,
  MEMORY_MAX_ATTEMPTS,
  type MemoryJobRow,
} from "../memory-queue.js";
import { startMemoryWorker, type MemoryWorker } from "../memory-worker.js";
import { markMemoryStaleOnCommit } from "../memory-activation.js";
import { LLMValidationError } from "@book-forge/llm";

const summarizeMock = vi.mocked(summarizeChapter);
const factsMock = vi.mocked(extractCanonFacts);
const notesMock = vi.mocked(extractEpisodicNotes);
const metaMock = vi.mocked(metaSummarize);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-07-12T00:00:00.000Z";
const NO_TOKENS = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

let dbDir: string;
let sqlite: DatabaseType;
let hasVec = false;
let worker: MemoryWorker;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "memq-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  hasVec = false;
  try {
    sqliteVec.load(sqlite);
    hasVec = true;
  } catch {
    /* FTS-only fallback */
  }
  migrate(drizzle(sqlite), { migrationsFolder });
  bootstrapVirtualTables(sqlite, hasVec);
}

function insertBook(): number {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)",
      )
      .run(NOW, NOW).lastInsertRowid,
  );
}
function insertChapter(bookId: number, order: number): number {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(bookId, order, `Глава ${order}`, NOW, NOW).lastInsertRowid,
  );
}
function insertVersion(
  chapterId: number,
  words: number,
  opts?: { makeCurrent?: boolean },
): number {
  const vId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', ?, ?, ?)`,
      )
      .run(chapterId, "Слово ".repeat(words), words, NOW).lastInsertRowid,
  );
  if (opts?.makeCurrent !== false) {
    sqlite
      .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
      .run(vId, chapterId);
  }
  return vId;
}
function memoryVersionOf(chapterId: number): number | null {
  return (
    sqlite
      .prepare("SELECT memory_version_id v FROM chapters WHERE id = ?")
      .get(chapterId) as { v: number | null }
  ).v;
}
function staleOf(bookId: number): number | null {
  return (
    sqlite
      .prepare(
        "SELECT memory_stale_from_chapter_order s FROM books WHERE id = ?",
      )
      .get(bookId) as { s: number | null }
  ).s;
}
function factCount(): number {
  return (
    sqlite.prepare("SELECT COUNT(*) n FROM book_facts").get() as { n: number }
  ).n;
}
function jobRows(): MemoryJobRow[] {
  return sqlite
    .prepare("SELECT * FROM memory_jobs ORDER BY id ASC")
    .all() as MemoryJobRow[];
}
function seedCommit(bookId: number, chapterId: number, versionId: number): void {
  enqueueMemoryJobs(sqlite, {
    bookId,
    chapterId,
    chapterVersionId: versionId,
    kinds: COMMIT_JOB_KINDS,
  });
}

beforeEach(() => {
  open();
  worker = startMemoryWorker(sqlite, hasVec, { autoStart: false });
  summarizeMock.mockReset().mockResolvedValue({
    summary: "Краткое содержание.",
    modelId: "noop",
    tokens: NO_TOKENS,
  } as never);
  factsMock.mockReset().mockResolvedValue({ facts: [] } as never);
  notesMock
    .mockReset()
    .mockResolvedValue({ newNotes: [], resolvedNoteIds: [], notes: null } as never);
  metaMock.mockReset().mockResolvedValue({
    summary: "",
    modelId: "noop",
    tokens: NO_TOKENS,
  } as never);
});
afterEach(() => {
  worker.stop();
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("gate 1 — commit atomicity", () => {
  it("version + jobs are created in one tx, or neither", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const tx = sqlite.transaction(() => {
      const vId = insertVersion(ch, 200);
      seedCommit(b, ch, vId);
      throw new Error("boom mid-commit");
    });
    expect(() => tx()).toThrow("boom mid-commit");
    expect(
      (sqlite.prepare("SELECT COUNT(*) n FROM chapter_versions").get() as { n: number }).n,
    ).toBe(0);
    expect(jobRows()).toHaveLength(0);
  });
});

describe("gate 2 — idempotent enqueue", () => {
  it("re-enqueueing the same version+kinds creates no duplicates", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 200);
    seedCommit(b, ch, vId);
    seedCommit(b, ch, vId);
    expect(jobRows()).toHaveLength(COMMIT_JOB_KINDS.length);
  });
});

describe("gate 3 — crash recovery", () => {
  it("running jobs return to retry on boot recovery and are claimable again", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 200);
    seedCommit(b, ch, vId);
    const claimed = claimNextMemoryJob(sqlite);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("running");
    // Simulated crash: nothing completes the job. Boot recovery:
    expect(recoverStaleMemoryJobs(sqlite)).toBe(1);
    const again = claimNextMemoryJob(sqlite, { kinds: [claimed!.kind] });
    expect(again?.id).toBe(claimed!.id);
    expect(again?.attempts).toBe(2);
  });
});

describe("gate 4 — output + completion are one write", () => {
  it("completeMemoryJob stores result and done together", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 200);
    seedCommit(b, ch, vId);
    const job = claimNextMemoryJob(sqlite)!;
    completeMemoryJob(sqlite, job.id, { chunkCount: 3 });
    const row = jobRows().find((j) => j.id === job.id)!;
    expect(row.status).toBe("done");
    expect(JSON.parse(row.result_json!)).toEqual({ chunkCount: 3 });
  });

  it("a failed job keeps result_json empty and schedules a backoff retry", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 200);
    seedCommit(b, ch, vId);
    const job = claimNextMemoryJob(sqlite)!;
    const status = failMemoryJob(sqlite, job, new Error("сеть упала"), {
      retryable: true,
    });
    expect(status).toBe("retry");
    const row = jobRows().find((j) => j.id === job.id)!;
    expect(row.result_json).toBeNull();
    expect(row.last_error).toContain("сеть упала");
    // Backoff: not claimable now, claimable after run_after.
    expect(claimNextMemoryJob(sqlite, { kinds: [job.kind] })).toBeNull();
    const after = new Date(Date.parse(row.run_after!) + 1).toISOString();
    expect(
      claimNextMemoryJob(sqlite, { kinds: [job.kind], now: after })?.id,
    ).toBe(job.id);
  });

  it("terminal failure after max attempts lands in error, not endless retry", () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 200);
    seedCommit(b, ch, vId);
    const job = claimNextMemoryJob(sqlite)!;
    const exhausted = { ...job, attempts: MEMORY_MAX_ATTEMPTS };
    expect(
      failMemoryJob(sqlite, exhausted, new Error("всё ещё падает"), {
        retryable: true,
      }),
    ).toBe("error");
    expect(retryBackoffMs(1)).toBe(5_000);
    expect(retryBackoffMs(10)).toBe(300_000);
  });
});

describe("gate 5 — superseded version becomes obsolete, active memory untouched", () => {
  it("facts extracted for a stale version are dropped, job → obsolete", async () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const v1 = insertVersion(ch, 200);
    enqueueMemoryJobs(sqlite, {
      bookId: b,
      chapterId: ch,
      chapterVersionId: v1,
      kinds: ["facts"],
    });
    // The author commits a newer version while v1's job is still queued.
    insertVersion(ch, 250);
    factsMock.mockResolvedValue({
      facts: [
        {
          entityType: "character",
          entityName: "Иван",
          predicate: "статус",
          objectText: "ранен",
          confidence: 1,
        },
      ],
    } as never);
    await worker.drain({ kinds: ["facts"] });
    const row = jobRows().find((j) => j.chapter_version_id === v1 && j.kind === "facts")!;
    expect(row.status).toBe("obsolete");
    expect(
      (sqlite.prepare("SELECT COUNT(*) n FROM book_facts").get() as { n: number }).n,
    ).toBe(0);
  });
});

describe("I5 — stateful ordering by chapter", () => {
  it("an error'd facts job on chapter 4 blocks chapter 5 facts but not index", () => {
    const b = insertBook();
    const ch4 = insertChapter(b, 4);
    const ch5 = insertChapter(b, 5);
    const v4 = insertVersion(ch4, 200);
    const v5 = insertVersion(ch5, 200);
    enqueueMemoryJobs(sqlite, {
      bookId: b,
      chapterId: ch4,
      chapterVersionId: v4,
      kinds: ["facts"],
    });
    enqueueMemoryJobs(sqlite, {
      bookId: b,
      chapterId: ch5,
      chapterVersionId: v5,
      kinds: ["facts", "index"],
    });
    sqlite
      .prepare(
        "UPDATE memory_jobs SET status='error' WHERE chapter_version_id = ? AND kind='facts'",
      )
      .run(v4);
    // Chapter 5 facts blocked by the failed earlier-chapter stateful job…
    expect(claimNextMemoryJob(sqlite, { kinds: ["facts"] })).toBeNull();
    // …while non-stateful work still flows.
    expect(claimNextMemoryJob(sqlite, { kinds: ["index"] })?.chapter_version_id).toBe(v5);
  });
});

describe("worker end-to-end (mocked LLM)", () => {
  it("processes a committed version to done and chains the rollup job", async () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 400);
    seedCommit(b, ch, vId);
    await worker.drain();
    const byKind = new Map(jobRows().map((j) => [j.kind, j]));
    for (const kind of COMMIT_JOB_KINDS) {
      expect(byKind.get(kind)?.status, kind).toBe("done");
    }
    // Rollup chained after summary and completed (skipped: within window).
    expect(byKind.get("rollup")?.status).toBe("done");
    // Summary really landed on the version row.
    const v = sqlite
      .prepare("SELECT summary FROM chapter_versions WHERE id = ?")
      .get(vId) as { summary: string | null };
    expect(v.summary).toBe("Краткое содержание.");
    // I4: all kinds done → memory activated for this version.
    expect(memoryVersionOf(ch)).toBe(vId);
  });

  it("gate 6 — previous activated version keeps serving while a newer commit processes", async () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const v1 = insertVersion(ch, 300);
    seedCommit(b, ch, v1);
    await worker.drain();
    expect(memoryVersionOf(ch)).toBe(v1);
    // A newer commit is queued but NOT processed yet.
    const v2 = insertVersion(ch, 320);
    seedCommit(b, ch, v2);
    expect(memoryVersionOf(ch)).toBe(v1); // I2: retrieval still sees v1
    await worker.drain();
    expect(memoryVersionOf(ch)).toBe(v2);
  });

  it("gate 8 — partial failure blocks activation; retry completes and materializes staged facts", async () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 300);
    seedCommit(b, ch, vId);
    factsMock.mockResolvedValue({
      facts: [
        {
          entityType: "character",
          entityName: "Иван",
          predicate: "статус",
          objectText: "жив",
          confidence: 1,
        },
      ],
    } as never);
    // Terminal failure on notes → error, no retry.
    notesMock.mockRejectedValueOnce(
      new LLMValidationError("bad structured output", undefined),
    );
    await worker.drain();
    const byKind = new Map(jobRows().map((j) => [j.kind, j]));
    expect(byKind.get("index")?.status).toBe("done");
    expect(byKind.get("summary")?.status).toBe("done");
    expect(byKind.get("facts")?.status).toBe("done");
    expect(byKind.get("notes")?.status).toBe("error");
    // I4: no activation, staged facts NOT applied to active tables.
    expect(memoryVersionOf(ch)).toBeNull();
    expect(factCount()).toBe(0);
    // UI retry: error → pending, drain again → activation applies everything.
    sqlite
      .prepare(
        "UPDATE memory_jobs SET status='pending', attempts=0, run_after=NULL WHERE status='error'",
      )
      .run();
    await worker.drain();
    expect(memoryVersionOf(ch)).toBe(vId);
    expect(factCount()).toBe(1);
  });

  it("gate 10 — editing an earlier chapter marks the book stale; re-activation clears it", async () => {
    const b = insertBook();
    const ch1 = insertChapter(b, 1);
    const ch2 = insertChapter(b, 2);
    const v1 = insertVersion(ch1, 300);
    const v2 = insertVersion(ch2, 300);
    seedCommit(b, ch1, v1);
    seedCommit(b, ch2, v2);
    await worker.drain();
    expect(memoryVersionOf(ch2)).toBe(v2);
    expect(staleOf(b)).toBeNull();
    // Author edits chapter 1 while chapter 2's memory is already activated —
    // simulate the route's commit tx (enqueue + stale marker atomically).
    const v1b = insertVersion(ch1, 350);
    sqlite.transaction(() => {
      seedCommit(b, ch1, v1b);
      markMemoryStaleOnCommit(sqlite, b, 1);
    })();
    expect(staleOf(b)).toBe(1);
    await worker.drain();
    // Documented P0 simplification: once every committed chapter ≥ stale
    // point re-activates for its current version, the marker clears.
    expect(memoryVersionOf(ch1)).toBe(v1b);
    expect(staleOf(b)).toBeNull();
  });

  it("LLM failure retries without losing the job; success on next drain", async () => {
    const b = insertBook();
    const ch = insertChapter(b, 1);
    const vId = insertVersion(ch, 400);
    enqueueMemoryJobs(sqlite, {
      bookId: b,
      chapterId: ch,
      chapterVersionId: vId,
      kinds: ["notes"],
    });
    notesMock.mockRejectedValueOnce(new Error("временный сбой сети"));
    await worker.drain({ kinds: ["notes"] });
    let row = jobRows().find((j) => j.kind === "notes")!;
    expect(row.status).toBe("retry");
    // Make the retry due now and drain again — succeeds.
    sqlite
      .prepare("UPDATE memory_jobs SET run_after = NULL WHERE id = ?")
      .run(row.id);
    await worker.drain({ kinds: ["notes"] });
    row = jobRows().find((j) => j.kind === "notes")!;
    expect(row.status).toBe("done");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as sqliteVec from "sqlite-vec";

import { bootstrapVirtualTables } from "../../db/virtual.js";
import {
  getWritingProgress,
  localDay,
  recordWritingDelta,
} from "../writing-progress.js";
import {
  makeTestApp,
  send,
  sendJson,
  type TestApp,
} from "../../routes/__tests__/_helpers.js";

function docFor(text: string): unknown {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `слово${i + 1}`).join(" ");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

// writing_days has no FK dependencies, so a plain migrated DB is enough —
// no need to seed a book like the notes/memory-pipeline util tests do.
let dbDir: string;
let sqlite: DatabaseType;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "writing-progress-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  let hasVec = false;
  try {
    sqliteVec.load(sqlite);
    hasVec = true;
  } catch {
    /* FTS/JS fallback */
  }
  migrate(drizzle(sqlite), { migrationsFolder });
  bootstrapVirtualTables(sqlite, hasVec);
}

describe("writing-progress ledger", () => {
  beforeEach(() => {
    open();
  });
  afterEach(() => {
    sqlite.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("localDay formats YYYY-MM-DD", () => {
    expect(localDay(new Date(2026, 6, 12))).toBe("2026-07-12");
  });

  it("empty day reads as zero", () => {
    expect(getWritingProgress(sqlite, "2026-07-12")).toEqual({
      date: "2026-07-12",
      wordsAdded: 0,
    });
  });

  it("accumulates positive deltas within a day", () => {
    recordWritingDelta(sqlite, 120, "2026-07-12");
    recordWritingDelta(sqlite, 80, "2026-07-12");
    expect(getWritingProgress(sqlite, "2026-07-12").wordsAdded).toBe(200);
  });

  it("ignores zero and negative deltas", () => {
    recordWritingDelta(sqlite, 100, "2026-07-12");
    recordWritingDelta(sqlite, -40, "2026-07-12");
    recordWritingDelta(sqlite, 0, "2026-07-12");
    expect(getWritingProgress(sqlite, "2026-07-12").wordsAdded).toBe(100);
  });

  it("days are independent", () => {
    recordWritingDelta(sqlite, 100, "2026-07-12");
    recordWritingDelta(sqlite, 50, "2026-07-13");
    expect(getWritingProgress(sqlite, "2026-07-12").wordsAdded).toBe(100);
    expect(getWritingProgress(sqlite, "2026-07-13").wordsAdded).toBe(50);
  });
});

// HTTP smoke test: makeTestApp()/send() run a fully-migrated app through the
// real route wiring (app.ts), so this also proves the mount is correct.
describe("GET /api/writing-progress", () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => {
    t.cleanup();
  });

  it("returns zero day and validates date", async () => {
    const res = await send(
      t.app,
      "/api/writing-progress?date=2026-07-12",
      "GET",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: "2026-07-12",
      wordsAdded: 0,
    });
    const bad = await send(t.app, "/api/writing-progress?date=nope", "GET");
    expect(bad.status).toBe(400);
  });
});

// ADR 0002 (Step 6): PUT /draft is the debounced autosave target — it must
// feed the writing-days ledger via recordWritingDelta on every save, and a
// ledger failure must never surface as a 500 (see recordWritingDelta's
// fail-silent try/catch above).
describe("PUT /api/chapters/:id/draft -> writing-progress ledger", () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });
  afterEach(() => {
    t.cleanup();
  });

  it("accumulates positive word deltas from successive draft saves into today's ledger", async () => {
    const book = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
      title: "Книга для леджера",
    });
    const chapter = await sendJson<{ id: number }>(
      t.app,
      `/api/books/${book.id}/chapters`,
      "POST",
      { title: "Глава 1" },
    );

    const first = await send(
      t.app,
      `/api/chapters/${chapter.id}/draft`,
      "PUT",
      { contentJson: docFor(words(10)) },
    );
    expect(first.status).toBe(200);

    const second = await send(
      t.app,
      `/api/chapters/${chapter.id}/draft`,
      "PUT",
      { contentJson: docFor(words(25)) },
    );
    expect(second.status).toBe(200);

    // No `date` query param -> route defaults to localDay(), same "today"
    // recordWritingDelta used for both PUTs above.
    const progress = await sendJson<{ date: string; wordsAdded: number }>(
      t.app,
      "/api/writing-progress",
      "GET",
    );
    expect(progress.wordsAdded).toBe(25);
  });
});

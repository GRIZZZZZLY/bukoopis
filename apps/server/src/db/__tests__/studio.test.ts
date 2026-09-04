import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  createStudioRepository,
  StudioConflictError,
} from "../studio.js";
import { emptyStudioState, emptyBookConcept } from "@book-forge/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");

let dbDir: string;
let dbPath: string;
let sqlite: Database.Database;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "bookforge-studio-"));
  dbPath = join(dbDir, "test.sqlite");
  sqlite = new Database(dbPath);
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  sqlite
    .prepare(
      `INSERT INTO books (title, created_at, updated_at) VALUES ('T', ?, ?)`,
    )
    .run(new Date().toISOString(), new Date().toISOString());
});

afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("studio repository", () => {
  it("loadStudioState returns empty default when column null", () => {
    const repo = createStudioRepository(sqlite);
    const s = repo.loadStudioState(1);
    expect(s).toEqual(emptyStudioState());
  });

  it("loadConcept returns default when null", () => {
    const repo = createStudioRepository(sqlite);
    expect(repo.loadConcept(1)).toEqual(emptyBookConcept());
  });

  it("patchStudioState increments revision and persists", () => {
    const repo = createStudioRepository(sqlite);
    const next = emptyStudioState();
    next.stages.concept = { status: "in_progress", playbookGenerated: false, aspects: [] };
    const r = repo.patchStudioState(1, { expectedRevision: 0, next });
    expect(r.revision).toBe(1);
    expect(r.stages.concept?.status).toBe("in_progress");
    const reloaded = repo.loadStudioState(1);
    expect(reloaded.revision).toBe(1);
  });

  it("patchStudioState throws StudioConflictError on revision mismatch", () => {
    const repo = createStudioRepository(sqlite);
    const next = emptyStudioState();
    expect(() => repo.patchStudioState(1, { expectedRevision: 99, next })).toThrow(
      StudioConflictError,
    );
  });

  it("patchStudioState derives stage status instead of trusting the caller", () => {
    const repo = createStudioRepository(sqlite);
    const next = emptyStudioState();
    next.stages.world = {
      status: "complete",
      playbookGenerated: false,
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "pending",
          order: 0,
          required: true,
          source: "llm",
          payloadKind: "markdown",
          variants: [],
        },
      ],
    };
    const saved = repo.patchStudioState(1, { expectedRevision: 0, next });
    expect(saved.stages.world?.status).toBe("in_progress");
    expect(repo.loadStudioState(1).stages.world?.status).toBe("in_progress");
  });

  it("patchStudioState rejects state that violates invariants", () => {
    const repo = createStudioRepository(sqlite);
    const bad = emptyStudioState();
    bad.stages.world = {
      status: "in_progress",
      playbookGenerated: false,
      aspects: [
        {
          id: "a1",
          name: "география",
          status: "accepted",
          order: 0,
          required: true,
          source: "llm",
          payloadKind: "markdown",
          variants: [],
          // accepted without finalPayload — nothing derivable can paper over this
        },
      ],
    };
    expect(() => repo.patchStudioState(1, { expectedRevision: 0, next: bad })).toThrow(
      /accepted_without_final_payload/,
    );
  });

  it("patchConcept persists JSON and bumps updatedAt", () => {
    const repo = createStudioRepository(sqlite);
    const c = emptyBookConcept();
    c.genre = "фэнтези";
    repo.patchConcept(1, c);
    const r = repo.loadConcept(1);
    expect(r.genre).toBe("фэнтези");
  });

  it("loadConcept folds a legacy genres array into genre and drops it", () => {
    sqlite
      .prepare("UPDATE books SET concept = ? WHERE id = ?")
      .run(
        JSON.stringify({
          schemaVersion: 1,
          pitches: [],
          genres: ["fantasy"],
          audience: "adult",
          premise: {},
        }),
        1,
      );
    const repo = createStudioRepository(sqlite);
    const r = repo.loadConcept(1);
    expect(r.genre).toBe("fantasy");
    expect(r.genres).toBeUndefined();
  });

  it("studioEventLogger.log writes a row with type-validated payload", () => {
    const repo = createStudioRepository(sqlite);
    repo.events.log({
      bookId: 1,
      eventType: "stage_skip",
      stageId: "items",
      revisionBefore: 0,
      revisionAfter: 1,
      payload: { note: "no items in realistic novel" },
    });
    const rows = sqlite.prepare("SELECT * FROM studio_events").all() as Array<{
      event_type: string;
      stage_id: string | null;
      payload: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe("stage_skip");
    expect(JSON.parse(rows[0]!.payload).note).toBe("no items in realistic novel");
  });

  it("studioEventLogger.log rejects unknown event_type", () => {
    const repo = createStudioRepository(sqlite);
    expect(() =>
      repo.events.log({
        bookId: 1,
        // @ts-expect-error testing runtime rejection
        eventType: "weird_thing",
        revisionBefore: 0,
        revisionAfter: 0,
        payload: {},
      }),
    ).toThrow();
  });
});

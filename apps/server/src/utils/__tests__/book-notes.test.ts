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
  extractEpisodicNotes: vi.fn(),
}));

import { extractEpisodicNotes } from "@book-forge/agents";
import { bootstrapVirtualTables } from "../../db/virtual.js";
import {
  loadOpenNotes,
  renderOpenNotesPrompt,
  gatherRelevantNotes,
  persistEpisodicNotes,
  triggerEpisodicNotes,
} from "../book-notes.js";
import type { EpisodicNoteExtraction } from "@book-forge/shared";

const extractMock = vi.mocked(extractEpisodicNotes);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-05-16T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;

function open(): void {
  dbDir = mkdtempSync(join(tmpdir(), "notes-test-"));
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

function insertBook(): number {
  return Number(
    sqlite
      .prepare(
        "INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)",
      )
      .run(NOW, NOW).lastInsertRowid,
  );
}

function extraction(
  newNotes: EpisodicNoteExtraction["newNotes"],
  resolvedTitles: string[] = [],
): EpisodicNoteExtraction {
  return { newNotes, resolvedTitles, notes: null };
}

beforeEach(() => {
  open();
  extractMock.mockReset();
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("persistEpisodicNotes + loadOpenNotes", () => {
  it("inserts notes that stay open until resolved", async () => {
    const b = insertBook();
    await persistEpisodicNotes(
      sqlite,
      b,
      2,
      20,
      extraction([
        { kind: "foreshadow", title: "Амулет", body: "Тайный амулет.", tags: [] },
      ]),
    );
    expect(loadOpenNotes(sqlite, b, 5)).toHaveLength(1);
    // Not visible before it was introduced.
    expect(loadOpenNotes(sqlite, b, 1)).toHaveLength(0);
  });

  it("resolves a named open note", async () => {
    const b = insertBook();
    await persistEpisodicNotes(
      sqlite,
      b,
      2,
      20,
      extraction([
        { kind: "mystery", title: "Кто убийца", body: "Загадка.", tags: [] },
      ]),
    );
    await persistEpisodicNotes(sqlite, b, 5, 50, extraction([], ["Кто убийца"]));
    expect(loadOpenNotes(sqlite, b, 4)).toHaveLength(1); // open at ch4
    expect(loadOpenNotes(sqlite, b, 6)).toHaveLength(0); // closed by ch5
  });

  it("same-chapter re-extraction replaces the same-title note", async () => {
    const b = insertBook();
    await persistEpisodicNotes(
      sqlite,
      b,
      3,
      30,
      extraction([{ kind: "thread", title: "Путь", body: "v1", tags: [] }]),
    );
    await persistEpisodicNotes(
      sqlite,
      b,
      3,
      31,
      extraction([{ kind: "thread", title: "Путь", body: "v2", tags: [] }]),
    );
    const open = loadOpenNotes(sqlite, b, 4);
    expect(open).toHaveLength(1);
    expect(open[0]!.body).toBe("v2");
  });
});

describe("renderOpenNotesPrompt", () => {
  it("returns null when empty", () => {
    expect(renderOpenNotesPrompt([], "Открытые линии", 3)).toBeNull();
  });
  it("formats with kind label and provenance", async () => {
    const b = insertBook();
    await persistEpisodicNotes(
      sqlite,
      b,
      1,
      10,
      extraction([
        { kind: "foreshadow", title: "Ружьё", body: "На стене.", tags: [] },
      ]),
    );
    const out = renderOpenNotesPrompt(loadOpenNotes(sqlite, b, 4), "Открытые линии", 4)!;
    expect(out).toContain("Открытые линии (актуально на главу #4)");
    expect(out).toContain("[предзнаменование] Ружьё: На стене. (с гл. #1)");
  });
});

describe("gatherRelevantNotes", () => {
  it("returns all open notes when count <= k", async () => {
    const b = insertBook();
    await persistEpisodicNotes(
      sqlite,
      b,
      1,
      10,
      extraction([
        { kind: "thread", title: "A", body: "дракон напал на деревню", tags: [] },
        { kind: "thread", title: "B", body: "любовная линия героев", tags: [] },
      ]),
    );
    const r = await gatherRelevantNotes(sqlite, b, "дракон", 5, 5);
    expect(r).toHaveLength(2);
  });

  it("ranks the semantically closest note first when over k", async () => {
    const b = insertBook();
    await persistEpisodicNotes(
      sqlite,
      b,
      1,
      10,
      extraction([
        { kind: "thread", title: "Дракон", body: "дракон огонь деревня пожар", tags: [] },
        { kind: "thread", title: "Любовь", body: "роман чувства письма свидание", tags: [] },
        { kind: "thread", title: "Море", body: "корабль шторм волны берег", tags: [] },
      ]),
    );
    const r = await gatherRelevantNotes(sqlite, b, "дракон огонь пожар", 5, 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toBe("Дракон");
  });
});

describe("triggerEpisodicNotes", () => {
  function seedChapter(bookId: number, order: number, words: number): number {
    const ch = sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(bookId, order, `Глава ${order}`, NOW, NOW);
    const chId = Number(ch.lastInsertRowid);
    const v = sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', ?, ?, ?)`,
      )
      .run(chId, "Текст ".repeat(words), words, NOW);
    const vId = Number(v.lastInsertRowid);
    sqlite
      .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
      .run(vId, chId);
    return vId;
  }

  it("persists extracted notes for a long enough chapter", async () => {
    const b = insertBook();
    const vId = seedChapter(b, 3, 500);
    extractMock.mockResolvedValue(
      extraction([
        { kind: "foreshadow", title: "Печать", body: "Сломанная печать.", tags: [] },
      ]),
    );
    await triggerEpisodicNotes(sqlite, vId);
    expect(extractMock).toHaveBeenCalledTimes(1);
    const open = loadOpenNotes(sqlite, b, 3);
    expect(open).toHaveLength(1);
    expect(open[0]!.title).toBe("Печать");
  });

  it("skips short chapters", async () => {
    const b = insertBook();
    const vId = seedChapter(b, 1, 40);
    await triggerEpisodicNotes(sqlite, vId);
    expect(extractMock).not.toHaveBeenCalled();
  });
});

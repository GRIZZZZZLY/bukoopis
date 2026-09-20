import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@book-forge/agents", async (orig) => ({
  ...(await orig<typeof import("@book-forge/agents")>()),
  extractCanonFacts: vi.fn(),
  extractCharacterEvents: vi.fn(),
}));

import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { extractCanonFacts, extractCharacterEvents } from "@book-forge/agents";
import { extractFactsPayload } from "../book-facts.js";

/** Живой прогон 2026-09-20: события персонажей терялись все до одного.
 *  Они ехали тем же вызовом, что и факты, и модель на сложной схеме
 *  сериализовала их массив в строку с ломаным экранированием — развернуть
 *  такую строку нельзя. Факты в том же ответе приходили массивом и целы,
 *  поэтому вызов разделён: свой агент, своя схема, свой ответ. */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-20T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let versionId: number;

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "events-split-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  const bookId = Number(
    sqlite
      .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
  sqlite
    .prepare("INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at) VALUES (?, 'Нина', '{}', ?, ?)")
    .run(bookId, NOW, NOW);
  const chapterId = Number(
    sqlite
      .prepare("INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, 10, 'Глава', ?, ?)")
      .run(bookId, NOW, NOW).lastInsertRowid,
  );
  const text = "Нина услышала имя в тумане. ".repeat(20);
  versionId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', ?, 120, ?)`,
      )
      .run(chapterId, text, NOW).lastInsertRowid,
  );
  sqlite.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(versionId, chapterId);
  vi.mocked(extractCanonFacts).mockReset();
  vi.mocked(extractCharacterEvents).mockReset();
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("события персонажей идут своим вызовом", () => {
  it("собирает факты и события из двух ответов", async () => {
    vi.mocked(extractCanonFacts).mockResolvedValue({
      facts: [
        {
          entityType: "character",
          entityName: "Нина",
          predicate: "слышала",
          objectText: "имя в тумане",
          confidence: 1,
          assertionMode: "narrated_as_fact",
          supersedesFactIds: [],
        },
      ],
      characterEvents: [],
      notes: null,
    } as never);
    vi.mocked(extractCharacterEvents).mockResolvedValue({
      characterEvents: [
        {
          subjectName: "Нина",
          kind: "knowledge",
          data: { fact: "услышала имя", acquisition: "observed" },
          evidenceQuote: "Нина услышала имя в тумане.",
        },
      ],
    } as never);

    const payload = await extractFactsPayload(sqlite, versionId);

    expect(vi.mocked(extractCharacterEvents)).toHaveBeenCalledTimes(1);
    expect(payload.facts).toHaveLength(1);
    expect(payload.characterEvents).toHaveLength(1);
  });

  it("падение второго вызова не уносит факты", async () => {
    vi.mocked(extractCanonFacts).mockResolvedValue({
      facts: [
        {
          entityType: "character",
          entityName: "Нина",
          predicate: "слышала",
          objectText: "имя в тумане",
          confidence: 1,
          assertionMode: "narrated_as_fact",
          supersedesFactIds: [],
        },
      ],
      characterEvents: [],
      notes: null,
    } as never);
    vi.mocked(extractCharacterEvents).mockRejectedValue(new Error("бэкенд молчит"));

    const payload = await extractFactsPayload(sqlite, versionId);

    // Факты — отдельный ответ, и терять их из-за событий нельзя: это
    // единственное, что у главы вообще есть.
    expect(payload.facts).toHaveLength(1);
    expect(payload.characterEvents).toHaveLength(0);
  });
});

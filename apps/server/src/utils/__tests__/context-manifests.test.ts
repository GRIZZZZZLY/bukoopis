import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { snapshotFingerprint } from "@book-forge/shared";

import {
  recordContextManifest,
  attachManifestToVersion,
  writerFingerprintForVersion,
  compareWithWriterBase,
} from "../context-manifests.js";
import type { AssembledContext } from "../generation-context.js";

/**
 * Манифест источников (этап 4): записывается при сборке, привязывается к
 * версии при принятии, сверяется критикой. Три ответа сравнения — «уехала»,
 * «та же», «сравнить нечем» — и последний не сводится ни к одному из первых.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-19T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;
let chapterId: number;

function fakeAssembled(refs: AssembledContext["sourceRefs"]): AssembledContext {
  return {
    pov: "Рин",
    povCharacterId: null,
    ambiguousNames: [],
    bookContextBase: "Книга",
    characterContext: "## Персонажи",
    participants: [],
    loreContext: null,
    studioContext: null,
    previousChapters: null,
    previousTail: null,
    retrieval: null,
    notesPrompt: null,
    styleContext: { prompt: null, fatigueBlacklist: [] },
    compiled: {
      includedIds: ["characters"],
      dropped: [{ id: "style", tokens: 12 }],
      totalTokens: 4,
      budgetTokens: 100,
      requiredOverflow: false,
      requiredTokens: 4,
    },
    sourceRefs: refs,
  };
}

function insertVersion(): number {
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', 'Текст.', 1, ?)`,
      )
      .run(chapterId, NOW).lastInsertRowid,
  );
  sqlite.prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?").run(id, chapterId);
  return id;
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "context-manifests-test-"));
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
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, 10, 'Глава', ?, ?)",
      )
      .run(bookId, NOW, NOW).lastInsertRowid,
  );
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("манифест контекста", () => {
  const refsA = [
    { kind: "chapter_version" as const, id: 1, versionId: 7, revision: null },
    { kind: "character" as const, id: 2, versionId: null, revision: 3 },
  ];

  it("записывается с отпечатком набора источников и содержимым бюджета", () => {
    const rec = recordContextManifest(sqlite, {
      bookId,
      chapterId,
      chapterVersionId: null,
      purpose: "writer",
      assembled: fakeAssembled(refsA),
    });
    expect(rec.fingerprint).toBe(snapshotFingerprint(refsA));
    const row = sqlite
      .prepare("SELECT purpose, fingerprint, chapter_version_id, manifest_json FROM context_manifests WHERE id = ?")
      .get(rec.id) as { purpose: string; fingerprint: string; chapter_version_id: number | null; manifest_json: string };
    expect(row.purpose).toBe("writer");
    expect(row.chapter_version_id).toBeNull();
    const manifest = JSON.parse(row.manifest_json) as { includedSections: string[]; droppedSections: unknown[]; promptVersion: string };
    expect(manifest.includedSections).toEqual(["characters"]);
    expect(manifest.droppedSections).toEqual([{ id: "style", tokens: 12 }]);
    expect(manifest.promptVersion).toMatch(/^stage4/);
  });

  it("сравнить нечем — null, а не «не изменилась»", () => {
    const v = insertVersion();
    expect(writerFingerprintForVersion(sqlite, v)).toBeNull();
    expect(compareWithWriterBase(sqlite, v, "anything")).toBeNull();
  });

  it("привязка к версии при принятии делает сравнение возможным", () => {
    const rec = recordContextManifest(sqlite, {
      bookId,
      chapterId,
      chapterVersionId: null,
      purpose: "writer",
      assembled: fakeAssembled(refsA),
    });
    const v = insertVersion();
    attachManifestToVersion(sqlite, rec.id, v);
    expect(writerFingerprintForVersion(sqlite, v)).toBe(rec.fingerprint);
    // Та же база — false; другая ревизия героя — true.
    expect(compareWithWriterBase(sqlite, v, snapshotFingerprint(refsA))).toBe(false);
    const refsB = [refsA[0]!, { ...refsA[1]!, revision: 4 }];
    expect(compareWithWriterBase(sqlite, v, snapshotFingerprint(refsB))).toBe(true);
  });

  it("сравнивается только манифест Writer'а, не критики", () => {
    const v = insertVersion();
    recordContextManifest(sqlite, {
      bookId,
      chapterId,
      chapterVersionId: v,
      purpose: "critique",
      assembled: fakeAssembled(refsA),
    });
    // Манифест критики к этой версии есть, а писательского нет — сравнивать
    // всё равно нечем: критика с критикой совпадает по построению.
    expect(compareWithWriterBase(sqlite, v, snapshotFingerprint(refsA))).toBeNull();
  });

  it("удаление версии уносит её манифесты", () => {
    const v = insertVersion();
    recordContextManifest(sqlite, {
      bookId,
      chapterId,
      chapterVersionId: v,
      purpose: "critique",
      assembled: fakeAssembled(refsA),
    });
    sqlite.prepare("UPDATE chapters SET current_version_id = NULL WHERE id = ?").run(chapterId);
    sqlite.prepare("DELETE FROM chapter_versions WHERE id = ?").run(v);
    const n = sqlite.prepare("SELECT COUNT(*) n FROM context_manifests").get() as { n: number };
    expect(n.n).toBe(0);
  });
});

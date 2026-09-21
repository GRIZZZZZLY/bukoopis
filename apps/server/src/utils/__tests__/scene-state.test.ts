import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sceneStateSchema } from "@book-forge/shared";

import {
  loadBoundarySceneState,
  loadSceneStateForChapter,
  loadSceneStateForVersion,
  saveSceneState,
} from "../scene-state.js";

/**
 * Анкета непрерывности: граница исключающая (INV-1), одна строка на версию
 * (INV-2), негодная строка не роняет чтение (AC-8).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../../../drizzle");
const NOW = "2026-09-21T00:00:00.000Z";

let dbDir: string;
let sqlite: DatabaseType;
let bookId: number;

function addChapter(orderIndex: number, title: string): { chapterId: number; versionId: number } {
  const chapterId = Number(
    sqlite
      .prepare(
        "INSERT INTO chapters (book_id, order_index, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(bookId, orderIndex, title, NOW, NOW).lastInsertRowid,
  );
  const versionId = Number(
    sqlite
      .prepare(
        `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
         VALUES (?, '{}', 'Текст.', 100, ?)`,
      )
      .run(chapterId, NOW).lastInsertRowid,
  );
  sqlite
    .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
    .run(versionId, chapterId);
  return { chapterId, versionId };
}

function put(
  ch: { chapterId: number; versionId: number },
  state: Record<string, unknown>,
  origin: "llm" | "manual" = "llm",
): void {
  saveSceneState(sqlite, {
    bookId,
    chapterId: ch.chapterId,
    chapterVersionId: ch.versionId,
    state: sceneStateSchema.parse(state),
    origin,
  });
}

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), "scene-state-test-"));
  sqlite = new Database(join(dbDir, "t.sqlite"));
  sqlite.pragma("foreign_keys = ON");
  migrate(drizzle(sqlite), { migrationsFolder });
  bookId = Number(
    sqlite
      .prepare("INSERT INTO books (title, created_at, updated_at) VALUES ('Книга', ?, ?)")
      .run(NOW, NOW).lastInsertRowid,
  );
});
afterEach(() => {
  sqlite.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe("граница анкеты", () => {
  it("подаёт анкету предыдущей главы и не подаёт свою и будущую (AC-4)", () => {
    const c1 = addChapter(10, "Прилив");
    const c2 = addChapter(20, "Отлив");
    const c3 = addChapter(30, "Шторм");
    put(c1, { place: "причал" });
    put(c2, { place: "склад" });
    put(c3, { place: "маяк" });

    const atThird = loadBoundarySceneState(sqlite, bookId, 30);
    expect(atThird?.chapterId).toBe(c2.chapterId);
    expect(atThird?.prompt).toContain("склад");
    expect(atThird?.prompt).not.toContain("маяк");
    // Номер в подписи — позиция в книге, а не разрежённый order_index.
    expect(atThird?.prompt).toContain("глава 2 «Отлив»");

    expect(loadBoundarySceneState(sqlite, bookId, 10)).toBeNull();
  });

  it("берёт ближайшую заполненную главу, если у соседней анкеты нет (AC-5)", () => {
    const c1 = addChapter(10, "Прилив");
    addChapter(20, "Отлив");
    put(c1, { place: "причал" });
    expect(loadBoundarySceneState(sqlite, bookId, 30)?.chapterId).toBe(c1.chapterId);
  });

  it("пустая анкета в промпт не идёт", () => {
    const c1 = addChapter(10, "Прилив");
    put(c1, {});
    expect(loadBoundarySceneState(sqlite, bookId, 20)).toBeNull();
  });

  it("анкета прежней версии главы не подаётся: она описывает заменённый текст", () => {
    const c1 = addChapter(10, "Прилив");
    put(c1, { place: "причал" });
    const newVersion = Number(
      sqlite
        .prepare(
          `INSERT INTO chapter_versions (chapter_id, content_json, content_text, word_count, created_at)
           VALUES (?, '{}', 'Переписано.', 100, ?)`,
        )
        .run(c1.chapterId, NOW).lastInsertRowid,
    );
    sqlite
      .prepare("UPDATE chapters SET current_version_id = ? WHERE id = ?")
      .run(newVersion, c1.chapterId);

    expect(loadBoundarySceneState(sqlite, bookId, 20)).toBeNull();
    expect(loadSceneStateForChapter(sqlite, c1.chapterId)).toBeNull();
    // Сама строка цела — она принадлежит прежней версии.
    expect(loadSceneStateForVersion(sqlite, c1.versionId)?.state.place).toBe("причал");
  });
});

describe("запись анкеты", () => {
  it("повторная запись заменяет строку, а не заводит вторую (INV-2)", () => {
    const c1 = addChapter(10, "Прилив");
    put(c1, { place: "причал" });
    put(c1, { place: "склад" }, "manual");
    const rows = sqlite
      .prepare("SELECT origin FROM chapter_scene_states WHERE chapter_version_id = ?")
      .all(c1.versionId) as Array<{ origin: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.origin).toBe("manual");
    expect(loadSceneStateForVersion(sqlite, c1.versionId)?.state.place).toBe("склад");
  });

  it("негодный JSON в строке читается как «анкеты нет», а не падением (AC-8)", () => {
    const c1 = addChapter(10, "Прилив");
    put(c1, { place: "причал" });
    sqlite
      .prepare("UPDATE chapter_scene_states SET state_json = '{нечитаемо' WHERE chapter_version_id = ?")
      .run(c1.versionId);
    expect(loadSceneStateForVersion(sqlite, c1.versionId)).toBeNull();
    expect(loadBoundarySceneState(sqlite, bookId, 20)).toBeNull();
  });

  it("удаление главы уносит её анкету", () => {
    const c1 = addChapter(10, "Прилив");
    put(c1, { place: "причал" });
    sqlite.prepare("DELETE FROM chapters WHERE id = ?").run(c1.chapterId);
    const left = sqlite
      .prepare("SELECT COUNT(*) n FROM chapter_scene_states")
      .get() as { n: number };
    expect(left.n).toBe(0);
  });
});

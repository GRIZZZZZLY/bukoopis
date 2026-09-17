import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";

interface BookJson {
  id: number;
}
interface CharacterJson {
  id: number;
  revision: number;
  profile: Record<string, unknown>;
}

let t: TestApp;
let bookId: number;

/** `TestApp` отдаёт только каталог базы, самого соединения у него нет, —
 *  поэтому строки вставляем вторым соединением, как это уже делают
 *  proposals/plot/chapter-drafts тесты. Профили здесь заведомо кривые:
 *  через API такие не создать, а прочитаться они обязаны. */
function openDb(): Database.Database {
  return new Database(join(t.dbDir, "test.sqlite"));
}

function insertCharacter(name: string, profileJson: string): void {
  const now = new Date().toISOString();
  const db = openDb();
  try {
    db.prepare(
      `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(bookId, name, profileJson, now, now);
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", { title: "V2" });
  bookId = b.id;
});
afterEach(() => t.cleanup());

describe("чтение профиля V2", () => {
  it("AC-01/AC-35: старая строка читается со всеми полями и revision 0", async () => {
    insertCharacter(
      "Рин Даре",
      JSON.stringify({
        description: "Старший инженер смены.",
        want: "вернуть станцию",
        role: "протагонист",
        age: "34",
        background: "Выросла на орбитальной верфи.",
        неизвестноеПоле: "сохранить",
      }),
    );
    const [c] = await sendJson<CharacterJson[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(c?.revision).toBe(0);
    expect(c?.profile.schemaVersion).toBe(2);
    expect(c?.profile.description).toBe("Старший инженер смены.");
    expect(c?.profile.want).toBe("вернуть станцию");
    expect(c?.profile.role).toBe("протагонист");
    expect(c?.profile.age).toBe("34");
    expect(c?.profile.background).toBe("Выросла на орбитальной верфи.");
    expect(c?.profile.extra).toEqual({ неизвестноеПоле: "сохранить" });
  });

  it("битый profile_json не роняет список", async () => {
    insertCharacter("Сломанный", "{не json");
    const list = await sendJson<CharacterJson[]>(
      t.app,
      `/api/books/${bookId}/characters`,
      "GET",
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.profile.schemaVersion).toBe(2);
    // Текст строки не выброшен: починить его руками можно только видя его.
    expect(list[0]?.profile.extra).toEqual({ rawProfileJson: "{не json" });
  });
});

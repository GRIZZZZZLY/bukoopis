import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { boundaryForChapter } from "@book-forge/shared";
import { gatherCharacterContext, characterContextToPrompt } from "@book-forge/agents";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { makeCharacterBoundaryReaders } from "../character-events.js";

/**
 * Сквозная проверка того пути, который идёт в Писателя. Сборка контекста
 * живёт в `packages/agents`, а SQL границы — в сервере, и до этой правки
 * в agents лежал второй экземпляр той же SQL со своим разбором строки.
 * Здесь проверяется, что связка отсекает по границе на самом деле.
 */

let t: TestApp;
let bookId: number;
let rinId: number;
const chapters = new Map<number, number>();

function chapter(order: number): number {
  const now = new Date().toISOString();
  const id = Number(
    t.sqlite
      .prepare(
        `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`,
      )
      .run(bookId, order, `Глава ${order}`, now, now).lastInsertRowid,
  );
  chapters.set(order, id);
  return id;
}

function know(fact: string, order: number, acquisition = "told"): void {
  t.sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'knowledge', ?, ?, 0, 'llm', 'derived', 1, ?, ?)`,
    )
    .run(
      bookId,
      rinId,
      JSON.stringify({ fact, acquisition }),
      chapters.get(order),
      `k:${fact}`,
      new Date().toISOString(),
    );
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  chapters.clear();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Связка" });
  bookId = b.id;
  const c = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  rinId = c.id;
  for (const o of [2, 5]) chapter(o);
});
afterEach(() => t.cleanup());

describe("gatherCharacterContext на границе сцены", () => {
  it("знание из этой же главы в её контекст не попадает, а из ранней попадает", () => {
    know("Станцию закрывают", 2);
    know("Сарек — брат Селены", 5);

    const result = gatherCharacterContext(
      t.sqlite,
      bookId,
      ["Рин осматривает шлюз."],
      [],
      makeCharacterBoundaryReaders(
        t.sqlite,
        boundaryForChapter(bookId, chapters.get(5)!, null),
      ),
    );
    const facts = result.characters.flatMap((c) => c.knowledge.map((k) => k.fact));
    expect(facts).toContain("Станцию закрывают");
    expect(facts).not.toContain("Сарек — брат Селены");
  });

  it("без читателей границы знаний нет вовсе", () => {
    // Прежнее поведение — список по всей книге сразу — было хуже пустого:
    // в третью главу приезжали факты из двадцатой.
    know("Станцию закрывают", 2);
    const result = gatherCharacterContext(t.sqlite, bookId, ["Рин осматривает шлюз."]);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0]!.knowledge).toEqual([]);
  });

  it("в промпт знание приходит с пометкой, откуда оно", () => {
    know("Станцию закрывают", 2, "told");
    const result = gatherCharacterContext(
      t.sqlite,
      bookId,
      ["Рин осматривает шлюз."],
      [],
      makeCharacterBoundaryReaders(
        t.sqlite,
        boundaryForChapter(bookId, chapters.get(5)!, null),
      ),
    );
    const text = characterContextToPrompt(result, new Map([[rinId, "Рин"]]));
    expect(text).toContain("Станцию закрывают");
    expect(text).toContain("со слов");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { boundaryForChapter } from "@book-forge/shared";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { loadActiveStates } from "../character-events.js";

/**
 * До этих проверок `loadActiveStates` не был покрыт нигде: подмена тела на
 * `() => []` оставляла все 1260 тестов зелёными. Три состояния из четырёх
 * здесь падают против ошибок, которые в коде действительно были.
 */

let t: TestApp;
let bookId: number;
let rinId: number;
let kaiId: number;
const chapters = new Map<number, number>();

/** Главы заводятся с шагом 10, как их заводит само приложение. Именно из-за
 *  этого шага порог свежести, считавший по `order_index`, не срабатывал. */
function chapter(position: number): number {
  const now = new Date().toISOString();
  const orderIndex = position * 10;
  const id = Number(
    t.sqlite
      .prepare(
        `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?)`,
      )
      .run(bookId, orderIndex, `Глава ${position}`, now, now).lastInsertRowid,
  );
  chapters.set(position, id);
  return id;
}

function state(
  characterId: number,
  text: string,
  position: number | null,
  extra: Record<string, unknown> = {},
): void {
  t.sqlite
    .prepare(
      `INSERT INTO character_events
         (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
          origin, verification, extractor_version, dedup_key, created_at)
       VALUES (?, ?, 'state', ?, ?, 0, 'llm', 'derived', 1, ?, ?)`,
    )
    .run(
      bookId,
      characterId,
      JSON.stringify({ state: text, ...extra }),
      position === null ? null : chapters.get(position),
      `s:${characterId}:${text}`,
      new Date().toISOString(),
    );
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  t = makeTestApp();
  chapters.clear();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Состояния" });
  bookId = b.id;
  const rin = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Рин",
    profile: { description: "Инженер." },
  });
  rinId = rin.id;
  const kai = await sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: "Кай",
    profile: { description: "Пилот." },
  });
  kaiId = kai.id;
  for (let p = 1; p <= 10; p += 1) chapter(p);
});
afterEach(() => t.cleanup());

const at = (position: number) =>
  loadActiveStates(
    t.sqlite,
    [rinId, kaiId],
    boundaryForChapter(bookId, chapters.get(position)!, null),
  );

describe("loadActiveStates", () => {
  it("состояние из соседней главы считается свежим", () => {
    // Порог — три главы. Считая по `order_index`, соседняя глава отстоит на
    // 10, и свежим не было ничего после четвёртой главы книги.
    state(rinId, "смертельно устала", 9);
    const [s] = at(10);
    expect(s?.certainty).toBe("fresh");
  });

  it("состояние из далёкой главы считается давним и подписано номером главы", () => {
    state(rinId, "ранена в плечо", 2);
    const [s] = at(10);
    expect(s?.certainty).toBe("stale");
    // Порядковый номер главы, а не её `order_index` (он равен 20).
    expect(s?.observedAtChapterOrder).toBe(2);
  });

  it("состояние из этой же главы в её контекст не попадает", () => {
    state(rinId, "в ярости", 10);
    expect(at(10)).toHaveLength(0);
  });

  it("состояние без главы не получает выдуманного номера", () => {
    state(rinId, "боится высоты", null);
    const [s] = at(10);
    expect(s?.observedAtChapterOrder).toBeNull();
    expect(s?.certainty).toBe("stale");
  });

  it("у каждого героя остаётся только последнее состояние", () => {
    state(rinId, "устала", 8);
    state(rinId, "отдохнула", 9);
    state(kaiId, "зол", 9);
    const out = at(10);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.subjectCharacterId === rinId)?.state).toBe("отдохнула");
    expect(out.find((s) => s.subjectCharacterId === kaiId)?.state).toBe("зол");
  });

  it("гипотеза и отклонённое состояние в контекст не идут", () => {
    state(rinId, "настоящее", 9);
    t.sqlite
      .prepare(
        `INSERT INTO character_events
           (book_id, subject_character_id, kind, data_json, chapter_id, scene_ordinal,
            origin, verification, extractor_version, dedup_key, created_at)
         VALUES (?, ?, 'state', ?, ?, 0, 'llm', 'proposed', 1, 'p', ?)`,
      )
      .run(
        bookId,
        kaiId,
        JSON.stringify({ state: "только гипотеза" }),
        chapters.get(9),
        new Date().toISOString(),
      );
    const out = at(10);
    expect(out.map((s) => s.state)).toContain("настоящее");
    expect(out.map((s) => s.state)).not.toContain("только гипотеза");
  });

  it("условие завершения доезжает до вызывающего", () => {
    state(rinId, "держит вахту", 9, { endCondition: "сменят на посту" });
    expect(at(10)[0]?.endCondition).toBe("сменят на посту");
  });
});

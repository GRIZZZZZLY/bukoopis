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

  it("у каждого героя остаётся состояние из ПОЗДНЕЙШЕЙ главы, а не позднейшая запись", () => {
    // Записи вставлены в обратном порядке: так выглядит переразбор ранней
    // главы после поздней. Побеждать должна девятая глава, хотя её строка
    // старше по id — иначе состояние героя откатывается назад во времени.
    state(rinId, "отдохнула", 9);
    state(rinId, "устала", 8);
    state(kaiId, "зол", 9);
    const out = at(10);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.subjectCharacterId === rinId)?.state).toBe("отдохнула");
    expect(out.find((s) => s.subjectCharacterId === kaiId)?.state).toBe("зол");
  });

  it("гипотеза в контекст не идёт", () => {
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

  it("AC-34: состояние с истёкшим сроком не возвращается", () => {
    state(rinId, "ранена", 2, { scope: "until_resolved", endsAtChapterOrder: 5 });
    // До пятой главы рана при герое.
    expect(at(4).map((s) => s.state)).toContain("ранена");
    // С пятой — уже нет, и на десятой тоже.
    expect(at(5).map((s) => s.state)).not.toContain("ранена");
    expect(at(10).map((s) => s.state)).not.toContain("ранена");
  });

  it("AC-34: состояние на одну сцену не тянется в следующие главы", () => {
    // Отброшенное состояние записано ПОЗЖЕ действующего. Раньше оно занимало
    // единственный слот героя и выбрасывалось, и «измотана» не находилось
    // уже никогда: проверка проходила через дедупликацию, а не через фильтр.
    state(rinId, "измотана", 2, { scope: "unknown" });
    state(rinId, "в ярости", 9, { scope: "scene" });
    const out = at(10).map((s) => s.state);
    expect(out).not.toContain("в ярости");
    // «unknown» остаётся: выдумывать ему срок запрещено, и молча выбрасывать
    // тоже — иначе пропадут все состояния, кроме явно бессрочных.
    expect(out).toContain("измотана");
  });

  it("отброшенное состояние не съедает место у действующего", () => {
    // Рана из второй главы ещё держится, ярость из девятой кончилась вместе
    // со сценой. Пока слот занимала ярость, героиня входила в десятую главу
    // вообще без состояний, и рана пропадала молча.
    state(rinId, "ранена", 2, { scope: "until_resolved" });
    state(rinId, "в ярости", 9, { scope: "scene" });
    expect(at(10).map((s) => s.state)).toEqual(["ранена"]);
  });

  it("состояние на главу кончается вместе со своей главой", () => {
    state(rinId, "простужена", 9, { scope: "chapter" });
    expect(at(10).map((s) => s.state)).not.toContain("простужена");
  });
});

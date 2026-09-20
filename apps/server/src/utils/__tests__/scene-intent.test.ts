import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";

const runSceneIntent = vi.hoisted(() => vi.fn());
vi.mock("@book-forge/agents", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@book-forge/agents");
  return { ...actual, runSceneIntent };
});

const { prepareSceneIntent } = await import("../scene-intent.js");

/**
 * Замысел сцены (этап 5, раздел 9.2). Проверяется соединение, а не кирпичи:
 * схема и рендер покрыты в shared, промпт — в agents. Здесь — что ссылки на
 * события сверяются со снимком (AC-25), что выдуманный участник не проходит
 * и что падение подготовки не срывает генерацию.
 */

let t: TestApp;
let bookId: number;
let chapterId: number;
let ninaId: number;
let vortId: number;
let eventId: number;

function makeCharacter(name: string): Promise<{ id: number }> {
  return sendJson<{ id: number }>(t.app, `/api/books/${bookId}/characters`, "POST", {
    canonicalName: name,
    profile: { description: "Герой этой книги." },
  });
}

function prepare(over: Partial<Parameters<typeof prepareSceneIntent>[1]> = {}) {
  return prepareSceneIntent(t.sqlite, {
    bookId,
    chapterId,
    chapterOrder: 10,
    chapterTitle: "Смена в четыре",
    bookTitle: "Голоса солёного тумана",
    beatSheet: "1. [scene] Нина приходит на станцию",
    dialogueRegister: null,
    chapterContract: null,
    characterContext: "Персонажи в сцене:\n\nНина Соловьёва",
    participants: [
      { characterId: ninaId, name: "Нина Соловьёва" },
      { characterId: vortId, name: "Ворт Соловьёв" },
    ],
    snapshotEventIds: [eventId],
    contextSnapshotId: 3,
    ...over,
  });
}

function modelAnswer(relevantEventIds: number[], characterId?: number) {
  return {
    participants: [
      {
        characterId: characterId ?? ninaId,
        immediateGoal: "увести брата со станции",
        attentionFocus: ["руки Ворта"],
        withheld: [],
        influenceStrategy: null,
        concessions: [],
        boundaries: [],
        relevantEventIds,
      },
    ],
    interactionTensions: [],
  };
}

beforeEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  runSceneIntent.mockReset();
  t = makeTestApp();
  const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", {
    title: "Замысел сцены",
  });
  bookId = b.id;
  ninaId = (await makeCharacter("Нина Соловьёва")).id;
  vortId = (await makeCharacter("Ворт Соловьёв")).id;

  const now = new Date().toISOString();
  chapterId = Number(
    t.sqlite
      .prepare(
        `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
         VALUES (?, 10, 'Смена в четыре', 'draft', ?, ?)`,
      )
      .run(bookId, now, now).lastInsertRowid,
  );
  eventId = Number(
    t.sqlite
      .prepare(
        `INSERT INTO character_events
           (book_id, subject_character_id, kind, data_json, verification, origin,
            evidence_quote, extractor_version, dedup_key, created_at)
         VALUES (?, ?, 'knowledge', '{"fact":"станцию спишут","acquisition":"told"}',
                 'confirmed', 'manual', 'цитата', 1, 'k1', ?)`,
      )
      .run(bookId, ninaId, now).lastInsertRowid,
  );
});
afterEach(() => t.cleanup());

describe("prepareSceneIntent", () => {
  it("рендерит замысел для промпта Писателя", async () => {
    runSceneIntent.mockResolvedValue(modelAnswer([eventId]));
    const out = await prepare();
    expect(out.prompt).toContain("Нина Соловьёва");
    expect(out.prompt).toContain("увести брата со станции");
    expect(out.degraded).toBe(false);
  });

  it("AC-25: ссылка на событие вне снимка выбрасывается", async () => {
    runSceneIntent.mockResolvedValue(modelAnswer([eventId, eventId + 999]));
    const out = await prepare();
    expect(out.droppedEventIds).toEqual([eventId + 999]);
    expect(out.intent?.participants[0]?.relevantEventIds).toEqual([eventId]);
  });

  it("участник, которого нет в сцене, выбрасывается целиком", async () => {
    runSceneIntent.mockResolvedValue(modelAnswer([], 999_999));
    const out = await prepare();
    expect(out.intent?.participants).toEqual([]);
    expect(out.prompt).toBeNull();
  });

  it("сохраняет замысел в главе", async () => {
    runSceneIntent.mockResolvedValue(modelAnswer([eventId]));
    await prepare();
    const row = t.sqlite
      .prepare("SELECT scene_intent_json FROM chapters WHERE id = ?")
      .get(chapterId) as { scene_intent_json: string | null };
    expect(row.scene_intent_json).not.toBeNull();
    expect(JSON.parse(row.scene_intent_json!).sceneId).toBe(`${chapterId}:1`);
  });

  it("меньше двух участников — вызова нет вовсе", async () => {
    const out = await prepare({ participants: [{ characterId: ninaId, name: "Нина" }] });
    expect(runSceneIntent).not.toHaveBeenCalled();
    expect(out.prompt).toBeNull();
    expect(out.degraded).toBe(false);
  });

  it("падение подготовки не срывает генерацию, но помечается деградацией", async () => {
    runSceneIntent.mockRejectedValue(new Error("таймаут"));
    const out = await prepare();
    expect(out.prompt).toBeNull();
    expect(out.degraded).toBe(true);
  });

  it("ответ, не прошедший схему, тоже деградация, а не бросок", async () => {
    runSceneIntent.mockResolvedValue({ participants: "не массив" });
    const out = await prepare();
    expect(out.prompt).toBeNull();
    expect(out.degraded).toBe(true);
  });
});

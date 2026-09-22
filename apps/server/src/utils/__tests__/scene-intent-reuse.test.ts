import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, type TestApp } from "../../routes/__tests__/_helpers.js";
import { loadStoredSceneIntent } from "../scene-intent.js";
import type { SceneIntent } from "@book-forge/shared";

/**
 * «Дописать с беата» продолжает ТУ ЖЕ сцену: замысел для неё уже посчитан в
 * прогоне, который автор остановил. Пересчёт стоит минуту ожидания и один
 * вызов модели ради того же ответа — живой прогон 2026-09-22 намерил 46–50 с
 * на подготовку при 31–37 с на сам беат.
 */

let t: TestApp;
let chapterId: number;

const NINA = 1;
const VORT = 2;

function makeIntent(over: Partial<SceneIntent> = {}): SceneIntent {
  return {
    sceneId: `${chapterId}:1`,
    contextSnapshotId: 7,
    participants: [
      {
        characterId: NINA,
        immediateGoal: "увести разговор от насоса",
        attentionFocus: ["руки Ворта"],
        withheld: ["что клапан она открыла сама"],
        influenceStrategy: "спрашивает о постороннем",
        concessions: [],
        boundaries: ["не признается при свидетелях"],
        relevantEventIds: [5],
      },
    ],
    interactionTensions: [
      { fromCharacterId: NINA, toCharacterId: VORT, subject: "кто отвечает за смену" },
    ],
    ...over,
  };
}

function store(intent: SceneIntent): void {
  t.sqlite
    .prepare("UPDATE chapters SET scene_intent_json = ? WHERE id = ?")
    .run(JSON.stringify(intent), chapterId);
}

const PARTICIPANTS = [
  { characterId: NINA, name: "Нина" },
  { characterId: VORT, name: "Ворт" },
];

beforeEach(() => {
  t = makeTestApp();
  const book = t.sqlite
    .prepare(
      "INSERT INTO books (title, language, status, created_at, updated_at) VALUES ('К', 'ru', 'draft', 'n', 'n')",
    )
    .run();
  const ch = t.sqlite
    .prepare(
      "INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at) VALUES (?, 10, 'Глава', 'draft', 'n', 'n')",
    )
    .run(book.lastInsertRowid);
  chapterId = Number(ch.lastInsertRowid);
});
afterEach(() => t.cleanup());

describe("loadStoredSceneIntent", () => {
  it("отдаёт сохранённый замысел готовым блоком промпта", () => {
    store(makeIntent());

    const res = loadStoredSceneIntent(t.sqlite, {
      chapterId,
      participants: PARTICIPANTS,
      snapshotEventIds: [5],
    });

    expect(res).not.toBeNull();
    expect(res?.degraded).toBe(false);
    expect(res?.prompt).toContain("Нина");
    expect(res?.prompt).toContain("увести разговор от насоса");
    expect(res?.prompt).toContain("кто отвечает за смену");
    expect(res?.droppedEventIds).toEqual([]);
  });

  it("ссылка на событие вне нового снимка выбрасывается, а не принимается", () => {
    // AC-25 держится и на переиспользовании: снимок пересобран, и номер,
    // которого в нём нет, в промпт не едет.
    store(
      makeIntent({
        participants: [
          { ...makeIntent().participants[0]!, relevantEventIds: [5, 91] },
        ],
      }),
    );

    const res = loadStoredSceneIntent(t.sqlite, {
      chapterId,
      participants: PARTICIPANTS,
      snapshotEventIds: [5],
    });

    expect(res?.droppedEventIds).toEqual([91]);
    expect(res?.intent?.participants[0]?.relevantEventIds).toEqual([5]);
  });

  it("герой, которого в сцене больше нет, из замысла уходит", () => {
    store(
      makeIntent({
        participants: [
          makeIntent().participants[0]!,
          {
            characterId: VORT,
            immediateGoal: "закрыть смену без разговора",
            attentionFocus: [],
            withheld: [],
            influenceStrategy: null,
            concessions: [],
            boundaries: [],
            relevantEventIds: [],
          },
        ],
      }),
    );

    const res = loadStoredSceneIntent(t.sqlite, {
      chapterId,
      participants: [{ characterId: NINA, name: "Нина" }],
      snapshotEventIds: [5],
    });

    expect(res?.prompt).toContain("Нина");
    expect(res?.prompt).not.toContain("закрыть смену без разговора");
    expect(res?.intent?.participants.map((p) => p.characterId)).toEqual([NINA]);
  });

  it("переиспользовать нечего — null, и вызывающий считает заново", () => {
    // Ничего не сохранено.
    expect(
      loadStoredSceneIntent(t.sqlite, {
        chapterId,
        participants: PARTICIPANTS,
        snapshotEventIds: [],
      }),
    ).toBeNull();

    // Строка есть, но это не замысел: битую строку молча принимать нельзя.
    t.sqlite
      .prepare("UPDATE chapters SET scene_intent_json = '{не json' WHERE id = ?")
      .run(chapterId);
    expect(
      loadStoredSceneIntent(t.sqlite, {
        chapterId,
        participants: PARTICIPANTS,
        snapshotEventIds: [],
      }),
    ).toBeNull();

    // Замысел есть, но печатать из него нечего: ни одного живого участника.
    store(makeIntent({ participants: [], interactionTensions: [] }));
    expect(
      loadStoredSceneIntent(t.sqlite, {
        chapterId,
        participants: PARTICIPANTS,
        snapshotEventIds: [],
      }),
    ).toBeNull();
  });
});

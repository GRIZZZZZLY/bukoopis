import { describe, it, expect } from "vitest";
import {
  SCENE_INTENT_SYSTEM,
  buildSceneIntentPrompt,
  type SceneIntentAgentInput,
} from "../scene-intent.js";

const base: SceneIntentAgentInput = {
  bookTitle: "Голоса солёного тумана",
  chapterTitle: "Смена в четыре",
  chapterOrder: 3,
  beatSheet: "1. [scene] Нина приходит на станцию\n   Цель: застать брата одного",
  dialogueRegister: "сдержанный, вполголоса",
  chapterContract: "Обязано случиться:\n— Нина слышит запись",
  characterContext: "Персонажи в сцене:\n\nНина Соловьёва — гидроакустик",
  participants: [
    { characterId: 7, name: "Нина Соловьёва" },
    { characterId: 9, name: "Ворт Соловьёв" },
  ],
  availableEvents: [
    { id: 12, characterName: "Нина Соловьёва", summary: "знает, что станцию спишут (со слов)" },
    { id: 15, characterName: "Ворт Соловьёв", summary: "обещал молчать до весны" },
  ],
};

describe("buildSceneIntentPrompt", () => {
  it("называет участников именем и номером: номер уезжает обратно в ответе", () => {
    const out = buildSceneIntentPrompt(base);
    expect(out).toContain("Нина Соловьёва");
    expect(out).toContain("7");
    expect(out).toContain("Ворт Соловьёв");
    expect(out).toContain("9");
  });

  it("печатает доступные события с их номерами", () => {
    const out = buildSceneIntentPrompt(base);
    expect(out).toContain("#12");
    expect(out).toContain("знает, что станцию спишут");
    expect(out).toContain("#15");
  });

  it("печатает беаты, регистр диалога и контракт главы", () => {
    const out = buildSceneIntentPrompt(base);
    expect(out).toContain("застать брата одного");
    expect(out).toContain("сдержанный, вполголоса");
    expect(out).toContain("Нина слышит запись");
  });

  it("без контракта и без регистра лишних заголовков не печатает", () => {
    const out = buildSceneIntentPrompt({
      ...base,
      chapterContract: null,
      dialogueRegister: null,
      availableEvents: [],
    });
    expect(out).not.toContain("Контракт главы");
    expect(out).not.toContain("Регистр диалога");
    expect(out).not.toContain("Доступные события");
  });
});

describe("SCENE_INTENT_SYSTEM", () => {
  it("запрещает выдумывать номера событий", () => {
    expect(SCENE_INTENT_SYSTEM).toMatch(/relevantEventIds/);
    expect(SCENE_INTENT_SYSTEM).toMatch(/не выдумывай|только из списка|нет в списке/i);
  });

  it("говорит, что замысел — не реплики и не новый канон", () => {
    expect(SCENE_INTENT_SYSTEM).toMatch(/не реплик/i);
    expect(SCENE_INTENT_SYSTEM).toMatch(/канон/i);
  });

  it("разрешает сцену без конфликта и участника без цели", () => {
    expect(SCENE_INTENT_SYSTEM).toMatch(/пуст/i);
    expect(SCENE_INTENT_SYSTEM).toMatch(/null/);
  });

  it("запрещает будущее знание: только то, что герой знает к началу сцены", () => {
    expect(SCENE_INTENT_SYSTEM).toMatch(/к началу сцены/i);
  });
});

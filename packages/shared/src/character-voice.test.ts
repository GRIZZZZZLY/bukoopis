import { describe, it, expect } from "vitest";
import {
  selectVoiceSamples,
  type CharacterVoiceSample,
} from "./character-voice.js";

function sample(p: Partial<CharacterVoiceSample>): CharacterVoiceSample {
  return {
    id: 1,
    bookId: 3,
    characterId: 22,
    text: "…",
    situation: "neutral",
    addresseeCharacterId: null,
    note: null,
    origin: "author",
    status: "accepted",
    sourceVersionId: null,
    sourceChapterOrder: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...p,
  };
}

const bank: CharacterVoiceSample[] = [
  sample({ id: 1, situation: "neutral", text: "нейтрально" }),
  sample({ id: 2, situation: "authority", text: "с начальником" }),
  sample({ id: 3, situation: "intimate", text: "с близким" }),
  sample({ id: 4, situation: "authority", addresseeCharacterId: 23, text: "с Сареком-начальником" }),
  sample({ id: 5, situation: "conflict", status: "proposed", text: "непринятый" }),
  sample({ id: 6, situation: "intimate", sourceChapterOrder: 12, text: "из поздней главы" }),
];

describe("selectVoiceSamples", () => {
  it("AC-06: начальник и близкий дают разные наборы", () => {
    const boss = selectVoiceSamples(bank, { situation: "authority", limit: 1 });
    const close = selectVoiceSamples(bank, { situation: "intimate", limit: 1 });
    expect(boss[0]?.text).toBe("с начальником");
    expect(close[0]?.text).toBe("с близким");
  });

  it("AC-06: конкретный адресат весит больше типа ситуации", () => {
    const picked = selectVoiceSamples(bank, {
      situation: "authority",
      addresseeCharacterId: 23,
      limit: 1,
    });
    expect(picked[0]?.id).toBe(4);
  });

  it("AC-15: одинаковые входы дают один и тот же порядок", () => {
    const a = selectVoiceSamples(bank, { situation: "authority", limit: 3 });
    const b = selectVoiceSamples([...bank].reverse(), { situation: "authority", limit: 3 });
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it("непринятые образцы не отбираются", () => {
    const picked = selectVoiceSamples(bank, { situation: "conflict", limit: 5 });
    expect(picked.map((s) => s.id)).not.toContain(5);
  });

  it("образец из поздней главы не попадает в раннюю сцену", () => {
    const early = selectVoiceSamples(bank, {
      situation: "intimate",
      beforeChapterOrder: 4,
      limit: 5,
    });
    expect(early.map((s) => s.id)).not.toContain(6);
    const late = selectVoiceSamples(bank, {
      situation: "intimate",
      beforeChapterOrder: 20,
      limit: 5,
    });
    expect(late.map((s) => s.id)).toContain(6);
  });

  it("limit соблюдается и пустой банк не падает", () => {
    expect(selectVoiceSamples(bank, { situation: "neutral", limit: 2 })).toHaveLength(2);
    expect(selectVoiceSamples([], { situation: "neutral" })).toEqual([]);
  });
});

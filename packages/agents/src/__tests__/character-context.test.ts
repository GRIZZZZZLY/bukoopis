import { describe, it, expect } from "vitest";
import {
  normalizeCharacterProfile,
  normalizeRelationshipProfile,
  type CharacterVoiceSample,
  type Relationship,
} from "@book-forge/shared";
import { characterContextToPrompt } from "../character.js";

const names = new Map([
  [1, "Рин"],
  [2, "Сарек"],
]);

function rel(id: number, from: number, to: number, profile: unknown): Relationship {
  return {
    id, bookId: 3, fromCharacterId: from, toCharacterId: to,
    type: "напарник", tension: 0, notes: null, revision: 0,
    profile: normalizeRelationshipProfile(profile),
    createdAt: "", updatedAt: "",
  };
}

function voice(p: Partial<CharacterVoiceSample>): CharacterVoiceSample {
  return {
    id: 1, bookId: 3, characterId: 1, text: "…", situation: "neutral",
    addresseeCharacterId: null, note: null, origin: "author", status: "accepted",
    sourceVersionId: null, sourceChapterOrder: null, createdAt: "", updatedAt: "",
    ...p,
  };
}

const result = {
  characters: [
    {
      character: {
        id: 1, bookId: 3, canonicalName: "Рин", revision: 0,
        profile: normalizeCharacterProfile({ description: "Инженер." }),
        createdAt: "", updatedAt: "",
      },
      knowledge: [],
    },
  ],
  relationships: [
    rel(10, 1, 2, { trust: "верит на слово" }),
    rel(11, 2, 1, { resentment: "не простил смену" }),
  ],
  voiceSamples: [
    voice({ id: 1, situation: "authority", text: "Так точно." }),
    voice({ id: 2, situation: "intimate", text: "Ты опять за своё." }),
  ],
};

const bare = { ...result, relationships: [], voiceSamples: [] };

describe("characterContextToPrompt", () => {
  it("AC-05: обе стороны отношения попадают в промпт раздельно", () => {
    const text = characterContextToPrompt(result, names);
    expect(text).toContain("Рин → Сарек");
    expect(text).toContain("доверие: верит на слово");
    expect(text).toContain("Сарек → Рин");
    expect(text).toContain("обида: не простил смену");
  });

  it("AC-06: для разговора с начальником берутся образцы этого регистра", () => {
    const boss = characterContextToPrompt(result, names, { situation: "authority" });
    const close = characterContextToPrompt(result, names, { situation: "intimate" });
    expect(boss.indexOf("Так точно.")).toBeGreaterThan(-1);
    expect(boss.indexOf("Так точно.")).toBeLessThan(boss.indexOf("Ты опять за своё."));
    expect(close.indexOf("Ты опять за своё.")).toBeGreaterThan(-1);
    expect(close.indexOf("Ты опять за своё.")).toBeLessThan(close.indexOf("Так точно."));
  });

  it("без образцов и качеств лишних блоков нет", () => {
    const text = characterContextToPrompt(bare, names);
    expect(text).not.toContain("Образцы речи");
    expect(text).not.toContain("доверие:");
  });

  it("пустые качества не создают строки", () => {
    const resultWithEmptyQuality = {
      ...result,
      relationships: [rel(12, 1, 2, {})],
    };
    const text = characterContextToPrompt(resultWithEmptyQuality, names);
    expect(text).toContain("Рин → Сарек");
    expect(text).not.toContain("доверие:");
    expect(text).not.toContain("уважение:");
  });
});

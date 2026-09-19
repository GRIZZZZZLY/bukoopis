import { describe, it, expect } from "vitest";
import {
  normalizeCharacterProfile,
  normalizeRelationshipProfile,
  type CharacterVoiceSample,
  type Relationship,
  type ActiveState,
} from "@book-forge/shared";
import { characterContextToPrompt, type CharacterAgentResult } from "../character.js";

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

function ctx(over: Partial<CharacterAgentResult> = {}): CharacterAgentResult {
  return {
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
    relationships: [],
    voiceSamples: [],
    states: [],
    ...over,
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
  states: [] as ActiveState[],
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

  it("разногласия и умолчания отрисовываются при наличии", () => {
    const resultWithDisputesAndSilences = {
      ...result,
      relationships: [
        rel(13, 1, 2, {
          trust: "верит на слово",
          disputes: ["время встреч", "место работы"],
          silences: ["прошлое", "семья"],
        }),
      ],
    };
    const text = characterContextToPrompt(resultWithDisputesAndSilences, names);
    expect(text).toContain("разногласия: время встреч, место работы");
    expect(text).toContain("умолчания: прошлое, семья");
  });

  it("пустые массивы разногласий и умолчаний не создают строк", () => {
    const resultWithEmptyArrays = {
      ...result,
      relationships: [
        rel(14, 1, 2, {
          trust: "верит на слово",
          disputes: [],
          silences: [],
        }),
      ],
    };
    const text = characterContextToPrompt(resultWithEmptyArrays, names);
    expect(text).toContain("доверие: верит на слово");
    expect(text).not.toContain("разногласия:");
    expect(text).not.toContain("умолчания:");
  });

  it("знания рендерятся только те, что пришли в контекст", () => {
    // Раньше этот тест назывался проверкой AC-07, но границы не касался:
    // знание подаётся прямо в рендерер, и отсечь его тут нечему. Границу
    // проверяет `character-context-boundary.test.ts` на стороне сервера,
    // где живёт её SQL.
    const text = characterContextToPrompt(
      ctx({
        characters: [
          {
            character: ctx().characters[0]!.character,
            knowledge: [{ fact: "Станцию закрывают", acquisition: "told", source: null, canonFactId: null, disprovedFromChapterOrder: null }],
          },
        ],
      }),
      names,
    );
    expect(text).toContain("Станцию закрывают");
    expect(text).not.toContain("Сарек");
  });

  it("состояние с неизвестным сроком показано как последнее наблюдение", () => {
    const text = characterContextToPrompt(
      ctx({
        states: [
          {
            subjectCharacterId: 1,
            state: "не простила смену",
            endCondition: null,
            observedAtChapterOrder: 2,
            certainty: "stale",
          },
        ],
      }),
      names,
    );
    expect(text).toContain("не простила смену");
    expect(text).toContain("наблюдалось в главе 2");
  });

  it("свежее состояние показано без оговорки о давности", () => {
    const text = characterContextToPrompt(
      ctx({
        states: [
          {
            subjectCharacterId: 1,
            state: "устала",
            endCondition: null,
            observedAtChapterOrder: 3,
            certainty: "fresh",
          },
        ],
      }),
      names,
    );
    expect(text).toContain("устала");
    expect(text).not.toContain("наблюдалось в главе");
  });

  it("без событий блок состояния не появляется", () => {
    expect(characterContextToPrompt(ctx(), names)).not.toContain("Сейчас с ним");
  });
});

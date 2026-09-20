import { describe, it, expect } from "vitest";
import {
  sceneIntentSchema,
  sceneIntentToolSchema,
  sceneKeyFor,
  renderSceneIntentPrompt,
} from "./scene-intent.js";

const participant = {
  characterId: 7,
  immediateGoal: "увести брата со станции до смены",
  attentionFocus: ["руки Ворта", "часы на стене"],
  withheld: ["что запись у неё с собой"],
  influenceStrategy: "давит на общую вину, а не просит",
  concessions: ["готова молчать про акт"],
  boundaries: ["не станет просить при чужих"],
  relevantEventIds: [12, 15],
};

const intent = {
  sceneId: "41:1",
  contextSnapshotId: 3,
  participants: [participant],
  interactionTensions: [{ fromCharacterId: 7, toCharacterId: 9, subject: "списание станции" }],
};

describe("sceneIntentSchema — схема чтения", () => {
  it("принимает полный замысел", () => {
    expect(sceneIntentSchema.parse(intent)).toMatchObject({ sceneId: "41:1" });
  });

  it("принимает пустые напряжения: сцене не обязан быть нужен конфликт", () => {
    const parsed = sceneIntentSchema.parse({ ...intent, interactionTensions: [] });
    expect(parsed.interactionTensions).toEqual([]);
  });

  it("принимает участника без намерения и без стратегии", () => {
    const parsed = sceneIntentSchema.parse({
      ...intent,
      participants: [
        {
          characterId: 7,
          immediateGoal: null,
          attentionFocus: [],
          withheld: [],
          influenceStrategy: null,
          concessions: [],
          boundaries: [],
          relevantEventIds: [],
        },
      ],
    });
    expect(parsed.participants[0]?.immediateGoal).toBeNull();
  });

  it("не режет длинные строки: это схема чтения", () => {
    const long = "я".repeat(5000);
    const parsed = sceneIntentSchema.parse({
      ...intent,
      participants: [{ ...participant, immediateGoal: long }],
    });
    expect(parsed.participants[0]?.immediateGoal).toHaveLength(5000);
  });
});

describe("sceneIntentToolSchema — схема ответа модели", () => {
  it("держит пределы длины там, где схема чтения их не держит", () => {
    const long = "я".repeat(5000);
    const out = sceneIntentToolSchema.safeParse({
      participants: [{ ...participant, immediateGoal: long }],
      interactionTensions: [],
    });
    expect(out.success).toBe(false);
  });

  it("не принимает от модели ни sceneId, ни снимок: их ставит сервер", () => {
    const out = sceneIntentToolSchema.safeParse({
      sceneId: "41:1",
      contextSnapshotId: 3,
      participants: [participant],
      interactionTensions: [],
    });
    expect(out.success).toBe(false);
  });

  it("пустой список участников не принимается: замысел ни о ком бессмыслен", () => {
    const out = sceneIntentToolSchema.safeParse({
      participants: [],
      interactionTensions: [],
    });
    expect(out.success).toBe(false);
  });
});

describe("sceneKeyFor", () => {
  it("склеивает главу и порядковый номер сцены", () => {
    expect(sceneKeyFor(41, 1)).toBe("41:1");
  });
});

describe("renderSceneIntentPrompt", () => {
  const names = new Map([
    [7, "Нина Соловьёва"],
    [9, "Ворт Соловьёв"],
  ]);

  it("называет героев именами, а не номерами", () => {
    const out = renderSceneIntentPrompt(sceneIntentSchema.parse(intent), names);
    expect(out).toContain("Нина Соловьёва");
    expect(out).not.toContain("characterId");
  });

  it("печатает намерение, внимание, умолчания и границы", () => {
    const out = renderSceneIntentPrompt(sceneIntentSchema.parse(intent), names);
    expect(out).toContain("увести брата со станции до смены");
    expect(out).toContain("руки Ворта");
    expect(out).toContain("что запись у неё с собой");
    expect(out).toContain("не станет просить при чужих");
  });

  it("не печатает пустые подсписки: заголовок без строк читается как утверждение", () => {
    const bare = sceneIntentSchema.parse({
      ...intent,
      participants: [
        {
          characterId: 7,
          immediateGoal: "уйти",
          attentionFocus: [],
          withheld: [],
          influenceStrategy: null,
          concessions: [],
          boundaries: [],
          relevantEventIds: [],
        },
      ],
      interactionTensions: [],
    });
    const out = renderSceneIntentPrompt(bare, names);
    expect(out).not.toContain("Внимание:");
    expect(out).not.toContain("Умалчивает:");
    expect(out).not.toContain("Напряжения:");
  });

  it("возвращает null, когда участников нет вовсе", () => {
    const empty = sceneIntentSchema.parse({ ...intent, participants: [], interactionTensions: [] });
    expect(renderSceneIntentPrompt(empty, names)).toBeNull();
  });

  it("пропускает участника, которого нет среди известных имён", () => {
    const out = renderSceneIntentPrompt(sceneIntentSchema.parse(intent), new Map([[9, "Ворт"]]));
    expect(out).toBeNull();
  });
});

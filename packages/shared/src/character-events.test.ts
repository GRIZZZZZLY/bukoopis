import { describe, it, expect } from "vitest";
import {
  characterEventSchema,
  extractedCharacterEventSchema,
  normalizeEventData,
  defaultVerificationFor,
  ACQUISITION_LABELS,
  CHARACTER_EVENT_KINDS,
} from "./character-events.js";

describe("события персонажа", () => {
  it("AC-26: сдвиг отношения по умолчанию только гипотеза", () => {
    expect(defaultVerificationFor("relation_shift")).toBe("proposed");
    expect(defaultVerificationFor("knowledge")).toBe("derived");
    expect(defaultVerificationFor("commitment")).toBe("derived");
    expect(defaultVerificationFor("state")).toBe("derived");
  });

  it("AC-09: способ получения знания хранится и различает услышанное", () => {
    const d = normalizeEventData("knowledge", {
      fact: "Станцию закрывают",
      acquisition: "told",
      source: "Сарек сказал в столовой",
    });
    expect(d.acquisition).toBe("told");
    expect(d.source).toBe("Сарек сказал в столовой");
    expect(ACQUISITION_LABELS.told).toBe("со слов");
  });

  it("неизвестный способ получения не роняет чтение, а становится observed", () => {
    const d = normalizeEventData("knowledge", { fact: "X", acquisition: "мусор" });
    expect(d.acquisition).toBe("observed");
  });

  it("AC-34: эпизодическое состояние обязано нести условие завершения", () => {
    const d = normalizeEventData("state", { state: "устала" });
    // Ни область действия, ни условие не выдумываются: «неизвестно» честнее
    // бессрочной усталости.
    expect(d.scope).toBe("unknown");
    expect(d.endsAtChapterOrder).toBeNull();
    expect(d.endCondition).toBeNull();
  });

  it("чтение не бросает ни на каком мусоре и заменяет невалидное умолчанием", () => {
    // Обеспечивает resilience path для каждого вида с неправильно типизированным полем своего вида.

    // knowledge: fact должна быть строкой, становится пустой
    expect(normalizeEventData("knowledge", { fact: 42 }).fact).toBe("");
    expect(normalizeEventData("knowledge", undefined).fact).toBe("");
    expect(normalizeEventData("knowledge", "строка").fact).toBe("");
    expect(normalizeEventData("knowledge", [1, 2]).fact).toBe("");
    // acquisition неправильного типа становится observed
    expect(normalizeEventData("knowledge", { acquisition: 42 }).acquisition).toBe("observed");

    // state: state должна быть строкой, становится пустой
    expect(normalizeEventData("state", { state: 42 }).state).toBe("");
    expect(normalizeEventData("state", undefined).state).toBe("");
    expect(normalizeEventData("state", []).state).toBe("");
    // scope неправильного типа становится unknown
    expect(normalizeEventData("state", { scope: 42 }).scope).toBe("unknown");

    // relation_shift: quality должна быть строкой, становится пустой
    expect(normalizeEventData("relation_shift", { quality: 42 }).quality).toBe("");
    expect(normalizeEventData("relation_shift", null).quality).toBe("");
    expect(normalizeEventData("relation_shift", true).quality).toBe("");

    // commitment: commitment должна быть строкой, становится пустой
    expect(normalizeEventData("commitment", { commitment: undefined }).commitment).toBe("");
    expect(normalizeEventData("commitment", "").commitment).toBe("");
    expect(normalizeEventData("commitment", 999).commitment).toBe("");
  });

  it("извлечённое событие проверяет, что data подходит своему виду", () => {
    // data с неправильным типом поля отвергается
    const badFact = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: 42, acquisition: "told" },
      evidenceQuote: "…",
      evidenceStart: 0,
      evidenceEnd: 1,
    });
    expect(badFact.success).toBe(false);

    // валидный data пропускает
    const valid = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "верное" },
      evidenceQuote: "…",
      evidenceStart: 0,
      evidenceEnd: 1,
    });
    expect(valid.success).toBe(true);

    // пустой data для knowledge тоже пропускает (заполнится умолчанием)
    const emptyData = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: {},
      evidenceQuote: "…",
      evidenceStart: 0,
      evidenceEnd: 1,
    });
    expect(emptyData.success).toBe(true);
  });

  it("извлечённое событие обязано нести цитату и диапазон", () => {
    const ok = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "Станцию закрывают", acquisition: "told" },
      evidenceQuote: "— Станцию закрывают, — сказал Сарек.",
      evidenceStart: 100,
      evidenceEnd: 136,
    });
    expect(ok.success).toBe(true);

    const noQuote = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "X" },
    });
    expect(noQuote.success).toBe(false);
  });

  it("диапазон с концом раньше начала отвергается", () => {
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "X" },
      evidenceQuote: "…",
      evidenceStart: 200,
      evidenceEnd: 100,
    });
    expect(r.success).toBe(false);
  });
});

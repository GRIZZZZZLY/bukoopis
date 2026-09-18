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

  it("чтение не бросает ни на каком мусоре", () => {
    for (const kind of CHARACTER_EVENT_KINDS) {
      expect(() => normalizeEventData(kind, null)).not.toThrow();
      expect(() => normalizeEventData(kind, "строка")).not.toThrow();
      expect(() => normalizeEventData(kind, [1, 2])).not.toThrow();
      expect(() => normalizeEventData(kind, { fact: 42 })).not.toThrow();
    }
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

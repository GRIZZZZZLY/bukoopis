import { describe, it, expect } from "vitest";
import {
  characterEventSchema,
  extractedCharacterEventSchema,
  normalizeEventData,
  defaultVerificationFor,
  ACQUISITION_LABELS,
  CHARACTER_EVENT_KINDS,
  type CharacterEventKind,
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
    // Вид-независимые входы (non-object, undefined, bare number).
    for (const kind of CHARACTER_EVENT_KINDS) {
      expect(() => normalizeEventData(kind, undefined)).not.toThrow();
      expect(() => normalizeEventData(kind, "строка")).not.toThrow();
      expect(() => normalizeEventData(kind, 999)).not.toThrow();
    }

    // Неправильно типизированные известные поля каждого вида (salvage path).
    type TestCase = [CharacterEventKind, unknown, string, unknown];
    const cases: TestCase[] = [
      ["knowledge", { fact: 42 }, "fact", ""],
      ["knowledge", { acquisition: 42 }, "acquisition", "observed"],
      ["state", { state: 42 }, "state", ""],
      ["state", { scope: 42 }, "scope", "unknown"],
      ["relation_shift", { quality: 42 }, "quality", ""],
      ["commitment", { commitment: 42 }, "commitment", ""],
    ];
    for (const [kind, input, field, expected] of cases) {
      const result = normalizeEventData(kind, input);
      expect((result as Record<string, unknown>)[field]).toBe(expected);
    }
  });

  it("защита от prototype-named ключей в salvage loop", () => {
    // Сочетание неправильного типа известного поля (triggering salvage)
    // и прототипного ключа не должно бросать TypeError.
    expect(() =>
      normalizeEventData("knowledge", { fact: 42, toString: "x" })
    ).not.toThrow();
    expect(normalizeEventData("knowledge", { fact: 42, toString: "x" }).fact).toBe(
      ""
    );
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

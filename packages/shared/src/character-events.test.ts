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

  it("неизвестный способ получения не роняет чтение, а становится unknown", () => {
    const d = normalizeEventData("knowledge", { fact: "X", acquisition: "мусор" });
    expect(d.acquisition).toBe("unknown");
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
    // Вид-независимые входы (non-object, undefined, bare number, null, array, boolean).
    for (const kind of CHARACTER_EVENT_KINDS) {
      expect(() => normalizeEventData(kind, undefined)).not.toThrow();
      expect(() => normalizeEventData(kind, "строка")).not.toThrow();
      expect(() => normalizeEventData(kind, 999)).not.toThrow();
      expect(() => normalizeEventData(kind, null)).not.toThrow();
      expect(() => normalizeEventData(kind, [])).not.toThrow();
      expect(() => normalizeEventData(kind, true)).not.toThrow();
    }

    // Неправильно типизированные известные поля каждого вида (salvage path).
    const cases: Record<CharacterEventKind, Array<[unknown, string, unknown]>> = {
      knowledge: [
        [{ fact: 42 }, "fact", ""],
        [{ acquisition: 42 }, "acquisition", "unknown"],
      ],
      state: [
        [{ state: 42 }, "state", ""],
        [{ scope: 42 }, "scope", "unknown"],
      ],
      relation_shift: [[{ quality: 42 }, "quality", ""]],
      commitment: [[{ commitment: 42 }, "commitment", ""]],
    };
    for (const [kind, testCases] of Object.entries(cases) as Array<
      [CharacterEventKind, Array<[unknown, string, unknown]>]
    >) {
      for (const [input, field, expected] of testCases) {
        const result = normalizeEventData(kind, input);
        expect((result as Record<string, unknown>)[field]).toBe(expected);
      }
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

  const QUOTE = "— Станцию закрывают, — сказал Сарек.";

  it("извлечённое событие проверяет, что data подходит своему виду", () => {
    const badFact = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: 42, acquisition: "told" },
      evidenceQuote: QUOTE,
    });
    expect(badFact.success).toBe(false);

    const valid = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "верное", acquisition: "told" },
      evidenceQuote: QUOTE,
    });
    expect(valid.success).toBe(true);
  });

  it("пустой data на извлечении отвергается, хотя чтение его стерпит", () => {
    // Схема чтения заполняет всё умолчаниями и никогда не бросает. На входе
    // такое событие означало бы пустую карточку в каноне, поэтому здесь
    // содержательное поле требуется явно.
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: {},
      evidenceQuote: QUOTE,
    });
    expect(r.success).toBe(false);
  });

  it("выдуманные имена полей в data отвергаются", () => {
    // `z.object` срезает незнакомые ключи, поэтому без явной проверки
    // `{описание: "…"}` прошло бы как валидный knowledge.
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { описание: "Станцию закрывают", acquisition: "told" },
      evidenceQuote: QUOTE,
    });
    expect(r.success).toBe(false);
  });

  it("лишний ключ в data не мешает событию пройти, а на чтении отпадает", () => {
    // На этом держится терпимость к модели, дописавшей своё поле: проверка на
    // соответствие виду идёт по `z.object`, который незнакомые ключи срезает,
    // так что событие проходит. В сыром `data` ключ остаётся — он и ложится
    // в `data_json`, — а из чтения его убирает `normalizeEventData`.
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "Станцию закрывают", acquisition: "told", уверенность: 0.9 },
      evidenceQuote: QUOTE,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect("уверенность" in (r.data.data as object)).toBe(true);
    expect("уверенность" in normalizeEventData("knowledge", r.data.data)).toBe(
      false,
    );
    expect(normalizeEventData("knowledge", r.data.data).fact).toBe(
      "Станцию закрывают",
    );
  });

  it("knowledge без acquisition отвергается", () => {
    // Умолчание — `unknown`: происхождения нет. Забытое поле сделало бы
    // героя свидетелем всего, о чём он только слышал.
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "Станцию закрывают" },
      evidenceQuote: QUOTE,
    });
    expect(r.success).toBe(false);
  });

  it('извлекателю "unknown" недоступен', () => {
    // Иначе это лазейка: пометить так всё, чего модель не разобрала, и
    // отличие услышанного от увиденного исчезнет обратно.
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "Станцию закрывают", acquisition: "unknown" },
      evidenceQuote: QUOTE,
    });
    expect(r.success).toBe(false);
  });

  it("извлечённое событие обязано нести цитату", () => {
    const ok = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "Станцию закрывают", acquisition: "told" },
      evidenceQuote: QUOTE,
    });
    expect(ok.success).toBe(true);

    const noQuote = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "X", acquisition: "told" },
    });
    expect(noQuote.success).toBe(false);
  });

  it("диапазона на извлечении нет: модель его не считает", () => {
    // Лишние ключи схема срезает — попытка прислать позиции ничего не ломает
    // и ничего не значит.
    const r = extractedCharacterEventSchema.safeParse({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "X", acquisition: "told" },
      evidenceQuote: QUOTE,
      evidenceStart: 200,
      evidenceEnd: 100,
    });
    expect(r.success).toBe(true);
    expect(r.success && "evidenceStart" in r.data).toBe(false);
  });
});

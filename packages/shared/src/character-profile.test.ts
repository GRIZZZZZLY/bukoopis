import { describe, it, expect } from "vitest";
import {
  normalizeCharacterProfile,
  characterProfileWriteSchema,
  characterProfileV2Schema,
  parseCharacterProfileForWrite,
} from "./character-profile.js";

describe("normalizeCharacterProfile", () => {
  it("AC-01: старая карточка V1 проходит без потерь", () => {
    const v1 = {
      description: "Инженер тишины, держит смену на себе.",
      want: "вернуть станцию",
      need: "разрешить себе просить помощь",
      lie: "просьба — это слабость",
      voice: "короткие фразы, без прилагательных",
      appearance: "седые виски, ожог на левой руке",
      arc: "от одиночки к части команды",
      notes: "автор: не давать ей плакать на людях",
    };
    const p = normalizeCharacterProfile(v1);
    expect(p.schemaVersion).toBe(2);
    expect(p.description).toBe(v1.description);
    expect(p.want).toBe(v1.want);
    expect(p.need).toBe(v1.need);
    expect(p.lie).toBe(v1.lie);
    expect(p.voice).toBe(v1.voice);
    expect(p.appearance).toBe(v1.appearance);
    expect(p.arc).toBe(v1.arc);
    expect(p.notes).toBe(v1.notes);
  });

  it("AC-01: психологические сведения не сочиняются", () => {
    const p = normalizeCharacterProfile({ description: "Курьер." });
    expect(p.roleTier).toBeNull();
    expect(p.values).toEqual([]);
    expect(p.principles).toEqual([]);
    expect(p.contradictions).toEqual([]);
    expect(p.goals).toEqual([]);
    expect(p.strategies.refuses).toBeNull();
  });

  it("AC-35: поля кандидата Мастерской сохраняются", () => {
    const p = normalizeCharacterProfile({
      name: "Рин Даре",
      role: "протагонист",
      age: "34",
      description: "Старший инженер смены.",
      background: "Выросла на орбитальной верфи.",
    });
    expect(p.role).toBe("протагонист");
    expect(p.age).toBe("34");
    expect(p.background).toBe("Выросла на орбитальной верфи.");
    expect(p.name).toBe("Рин Даре");
  });

  it("неизвестные ключи уезжают в extra, а не пропадают", () => {
    const p = normalizeCharacterProfile({
      description: "X",
      somethingOld: { a: 1 },
    });
    expect(p.extra).toEqual({ somethingOld: { a: 1 } });
  });

  it("чтение не бросает на длинном тексте и на мусоре", () => {
    const long = "я".repeat(50_000);
    expect(normalizeCharacterProfile({ description: long }).description).toBe(long);
    expect(() => normalizeCharacterProfile(null)).not.toThrow();
    expect(() => normalizeCharacterProfile("строка")).not.toThrow();
    expect(() => normalizeCharacterProfile({ want: 42 })).not.toThrow();
    expect(normalizeCharacterProfile(null).description).toBe("");
  });

  it("AC-03: эпизодический герой без анкеты — валидный профиль", () => {
    const p = normalizeCharacterProfile({
      description: "Охранник на воротах, одна сцена.",
      roleTier: "episodic",
    });
    expect(p.roleTier).toBe("episodic");
    expect(characterProfileWriteSchema.safeParse(p).success).toBe(true);
  });

  it("повторная нормализация ничего не меняет", () => {
    const once = normalizeCharacterProfile({ description: "X", role: "друг" });
    expect(normalizeCharacterProfile(once)).toEqual(once);
  });

  it("схема записи отбивает слишком длинное описание", () => {
    const r = characterProfileWriteSchema.safeParse({
      ...normalizeCharacterProfile({ description: "X" }),
      description: "я".repeat(20_001),
    });
    expect(r.success).toBe(false);
  });

  it("extra-строка не той формы не пропадает при повторном проходе", () => {
    const p = normalizeCharacterProfile({ description: "X", extra: "мусор" });
    expect(p.extra).toEqual({ extra: "мусор" });
  });

  it("extra-массив не пропадает при повторном проходе", () => {
    const p = normalizeCharacterProfile({ description: "X", extra: ["a"] });
    expect(p.extra).toEqual({ extra: ["a"] });
  });

  it("литеральный __proto__ в JSON-строке не пропадает и не меняет прототип", () => {
    // Object-literal-синтаксис `{ __proto__: ... }` задаёт прототип, а не
    // собственное свойство — так строку из базы не воспроизвести. JSON.parse
    // не делает этого исключения и создаёт настоящее собственное свойство,
    // как и было бы со значением из `books.studio_state`.
    const raw = JSON.parse('{"description":"X","__proto__":{"secret":42}}');
    const p = normalizeCharacterProfile(raw);
    // Прототип самого `extra`, а не внешнего профиля: аккумулятор внутри
    // функции без прототипа, но наружу должен выйти обычный объект — иначе
    // `p.extra.hasOwnProperty(...)` бросает на выходе функции.
    expect(Object.getPrototypeOf(p.extra)).toBe(Object.prototype);
    expect(p.extra.hasOwnProperty("__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(p.extra, "__proto__")?.value).toEqual({
      secret: 42,
    });
  });

  it("схема чтения не бросает на сырой V1-строке без schemaVersion", () => {
    const parsed = characterProfileV2Schema.parse({ description: "X" });
    expect(parsed.schemaVersion).toBe(2);
  });

  it("верхнеуровневый массив не бросает", () => {
    const p = normalizeCharacterProfile([1, 2]);
    expect(p.extra).toEqual({ raw: [1, 2] });
  });
});

describe("parseCharacterProfileForWrite", () => {
  it("валидный профиль проходит", () => {
    const result = parseCharacterProfileForWrite({ description: "Инженер." });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.description).toBe("Инженер.");
    }
  });

  it("превышение лимита description не проходит", () => {
    const result = parseCharacterProfileForWrite({
      description: "я".repeat(20_001),
    });
    expect(result.ok).toBe(false);
  });
});

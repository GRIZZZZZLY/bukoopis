import { describe, it, expect } from "vitest";
import {
  normalizeRelationshipProfile,
  directedRelationshipWriteSchema,
  directedRelationshipSchema,
} from "./relationship-profile.js";

describe("normalizeRelationshipProfile", () => {
  it("пустое отношение — все качества неизвестны", () => {
    const p = normalizeRelationshipProfile(null);
    expect(p.schemaVersion).toBe(2);
    expect(p.trust).toBeNull();
    expect(p.respect).toBeNull();
    expect(p.disputes).toEqual([]);
    expect(p.silences).toEqual([]);
  });

  it("сочетание «уважает компетентность, не доверяет обещаниям» хранится как есть", () => {
    const p = normalizeRelationshipProfile({
      respect: "уважает компетентность",
      trust: "не доверяет обещаниям",
    });
    expect(p.respect).toBe("уважает компетентность");
    expect(p.trust).toBe("не доверяет обещаниям");
  });

  it("качества не выводятся из tension", () => {
    const p = normalizeRelationshipProfile({ tension: -0.9 });
    expect(p.trust).toBeNull();
    expect(p.fear).toBeNull();
    expect(p.extra).toEqual({ tension: -0.9 });
  });

  it("чтение не бросает на мусоре", () => {
    expect(() => normalizeRelationshipProfile("строка")).not.toThrow();
    const p1 = normalizeRelationshipProfile("строка");
    expect(p1.extra).toEqual({ raw: "строка" });
    expect(() => normalizeRelationshipProfile({ trust: 5 })).not.toThrow();
    expect(normalizeRelationshipProfile({ trust: 5 }).extra).toEqual({ trust: 5 });
  });

  it("схема записи ограничивает длину", () => {
    const ok = directedRelationshipWriteSchema.safeParse(
      normalizeRelationshipProfile({ trust: "верит на слово" }),
    );
    expect(ok.success).toBe(true);
    const tooLong = directedRelationshipWriteSchema.safeParse({
      ...normalizeRelationshipProfile(null),
      trust: "я".repeat(2001),
    });
    expect(tooLong.success).toBe(false);
  });

  it("schemaVersion имеет default, parsing без него не бросает", () => {
    const p = directedRelationshipSchema.parse({ trust: "верит на слово" });
    expect(p.schemaVersion).toBe(2);
  });

  it("non-object extra не теряется", () => {
    const p = normalizeRelationshipProfile({ extra: "строка" });
    expect(p.extra).toEqual({ extra: "строка" });
  });

  it("прототип extra — обычный Object.prototype", () => {
    // JSON.parse создаёт объект, где __proto__ — обычный ключ, не прототип
    const raw = JSON.parse('{"__proto__":"опасно"}');
    const p = normalizeRelationshipProfile(raw);
    expect(Object.getPrototypeOf(p.extra)).toBe(Object.prototype);
    expect(p.extra.__proto__).toBe("опасно");
  });
});

import { describe, it, expect } from "vitest";
import { entityNameStem, mentionsEntityName, sameEntityName } from "./entity-names.js";

describe("имена и падежи (С2)", () => {
  it("склонения женского имени сходятся", () => {
    for (const form of ["Анны", "Анне", "Анну", "Анной"]) {
      expect(sameEntityName("Анна", form)).toBe(true);
    }
  });

  it("склонения мужского имени сходятся", () => {
    for (const form of ["Ивана", "Ивану", "Иваном", "Иване"]) {
      expect(sameEntityName("Иван", form)).toBe(true);
    }
  });

  it("разные имена не сливаются", () => {
    expect(sameEntityName("Анна", "Инна")).toBe(false);
    expect(sameEntityName("Иван", "Иволга")).toBe(false);
    expect(sameEntityName("Ян", "Яна")).toBe(false);
  });

  it("ё и е — одно и то же имя", () => {
    expect(sameEntityName("Алёна", "Алена")).toBe(true);
  });

  it("короткое имя не находится внутри другого слова", () => {
    expect(mentionsEntityName("В январе выпал снег.", "Ян")).toBe(false);
    expect(mentionsEntityName("Ян закрыл дверь.", "Ян")).toBe(true);
  });

  it("имя находится в косвенном падеже", () => {
    expect(mentionsEntityName("Он ждал Анну у ворот.", "Анна")).toBe(true);
    expect(mentionsEntityName("Письмо от Ивана.", "Иван")).toBe(true);
  });

  it("основа не короче трёх букв", () => {
    expect(entityNameStem("Рин")).toBe("рин");
    expect(entityNameStem("Ия")).toBe("ия");
  });
});

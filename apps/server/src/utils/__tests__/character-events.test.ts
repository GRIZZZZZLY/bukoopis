import { describe, it, expect } from "vitest";
import { verifyEvidence, dedupKeyFor } from "../character-events.js";

describe("verifyEvidence", () => {
  const text = "Рин молчала. — Станцию закрывают, — сказал Сарек. Она кивнула.";

  it("совпадающая цитата принимается", () => {
    const start = text.indexOf("— Станцию закрывают");
    const quote = "— Станцию закрывают";
    expect(verifyEvidence(text, quote, start, start + quote.length)).toBe(true);
  });

  it("AC-25: сдвинутый диапазон отвергается", () => {
    const start = text.indexOf("— Станцию закрывают");
    const quote = "— Станцию закрывают";
    expect(verifyEvidence(text, quote, start + 3, start + 3 + quote.length)).toBe(false);
  });

  it("AC-25: цитата, которой в тексте нет, отвергается", () => {
    expect(verifyEvidence(text, "— Станцию не закрывают", 10, 32)).toBe(false);
  });

  it("диапазон за концом текста отвергается, а не бросает", () => {
    expect(() => verifyEvidence(text, "хвост", 10_000, 10_005)).not.toThrow();
    expect(verifyEvidence(text, "хвост", 10_000, 10_005)).toBe(false);
  });

  it("конец не позже начала отвергается", () => {
    expect(verifyEvidence(text, "Рин", 5, 5)).toBe(false);
    expect(verifyEvidence(text, "Рин", 5, 1)).toBe(false);
  });
});

describe("dedupKeyFor", () => {
  it("одно и то же знание даёт один ключ независимо от порядка полей", () => {
    const a = dedupKeyFor("knowledge", { fact: "X", acquisition: "told" });
    const b = dedupKeyFor("knowledge", { acquisition: "told", fact: "X" });
    expect(a).toBe(b);
  });

  it("разное знание даёт разные ключи", () => {
    expect(dedupKeyFor("knowledge", { fact: "X" })).not.toBe(
      dedupKeyFor("knowledge", { fact: "Y" }),
    );
  });

  it("ключ не зависит от регистра и лишних пробелов в тексте", () => {
    expect(dedupKeyFor("knowledge", { fact: "  Станцию  закрывают " })).toBe(
      dedupKeyFor("knowledge", { fact: "станцию закрывают" }),
    );
  });

  it("сдвиг отношения к разным адресатам даёт разные ключи", () => {
    // Адресат живёт колонкой, а не в data: relationShiftDataSchema — это
    // {quality, from, to}. Без него два сдвига из одной версии к разным
    // героям совпали бы ключом, и уникальный индекс молча выбросил бы
    // второй (INSERT OR IGNORE).
    const data = { quality: "доверие", from: "ровно", to: "холодно" };
    expect(dedupKeyFor("relation_shift", data, 7)).not.toBe(
      dedupKeyFor("relation_shift", data, 8),
    );
  });

  it("отсутствие адресата — тоже значение ключа", () => {
    const data = { fact: "X" };
    expect(dedupKeyFor("knowledge", data, null)).toBe(
      dedupKeyFor("knowledge", data),
    );
  });
});

import { describe, it, expect } from "vitest";
import { locateEvidence, dedupKeyFor } from "../character-events.js";

describe("locateEvidence", () => {
  const text = "Рин молчала. — Станцию закрывают, — сказал Сарек. Она кивнула.";

  it("цитата находится, диапазон считает сервер", () => {
    const quote = "— Станцию закрывают";
    const span = locateEvidence(text, quote);
    expect(span).not.toBeNull();
    expect(text.slice(span!.start, span!.end)).toBe(quote);
  });

  it("AC-25: цитаты, которой в тексте нет, не находит", () => {
    expect(locateEvidence(text, "— Станцию не закрывают")).toBeNull();
  });

  it("AC-25: пересказ вместо дословной цитаты отвергается", () => {
    // Модель, «поправившая» тире или падеж, не получает доказательства.
    expect(locateEvidence(text, "- Станцию закрывают")).toBeNull();
    expect(locateEvidence(text, "Станцию закрыли")).toBeNull();
  });

  it("цитата, встречающаяся дважды, отвергается как неоднозначная", () => {
    const twice = "Она кивнула. Сарек молчал. Она кивнула.";
    expect(twice.indexOf("Она кивнула.")).toBeGreaterThanOrEqual(0);
    expect(locateEvidence(twice, "Она кивнула.")).toBeNull();
  });

  it("вырожденная цитата отвергается, хотя и находится", () => {
    // Пробел в тексте есть — и подтвердил бы любое утверждение.
    expect(text.includes(" ")).toBe(true);
    expect(locateEvidence(text, " ")).toBeNull();
    expect(locateEvidence(text, "Р")).toBeNull();
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

  it("AC-21: дописанные умолчания и лишние ключи ключ не меняют", () => {
    // Схема извлечения — z.record: лишние ключи проходят, умолчания не
    // подставляются. Модель на втором прогоне вернёт то же плюс явные
    // null — сырой ключ развёл бы одно событие на два активные строки.
    const first = { fact: "X", acquisition: "told" };
    const second = {
      fact: "X",
      acquisition: "told",
      source: null,
      canonFactId: null,
      disprovedFromChapterOrder: null,
      отсебятина: "модель добавила поле",
    };
    expect(dedupKeyFor("knowledge", first)).toBe(dedupKeyFor("knowledge", second));
  });

  it("составные символы не разводят ключ", () => {
    // «й» одной кодовой точкой против «и» + U+0306: для читателя одно слово.
    expect(dedupKeyFor("knowledge", { fact: "тайный" })).toBe(
      dedupKeyFor("knowledge", { fact: "тайный".normalize("NFD") }),
    );
  });
});

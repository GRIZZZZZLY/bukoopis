import { describe, it, expect } from "vitest";
import { canonFactExtractionSchema } from "@book-forge/shared";
import { CANON_FACT_EXTRACTOR_SYSTEM } from "../canon-fact-extractor.js";

/**
 * Промпт — это и есть работа агента: схема примет любой объект правильной
 * формы, а качество событий решает текст инструкции. Проверки ниже
 * закрепляют те его места, где ошибка стоит целого разбора, — и падают,
 * если соответствующий кусок из промпта убрать.
 */
describe("промпт извлекателя", () => {
  it("не просит у модели позиции символов", () => {
    // Просьба посчитать offsets давала почти стопроцентный отказ: промах на
    // единицу отвергает событие, и разбор выглядит как «ничего не нашлось».
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/Позиции считать НЕ НАДО/);
    expect(CANON_FACT_EXTRACTOR_SYSTEM).not.toMatch(/диапазон \(позиции символов\)/);
  });

  it("требует уникальную дословную цитату", () => {
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/СИМВОЛ В СИМВОЛ/);
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/РОВНО ОДИН РАЗ/);
  });

  it("называет поля data для каждого вида события", () => {
    for (const field of ["fact", "state", "quality", "commitment", "toWhom", "scope"]) {
      expect(CANON_FACT_EXTRACTOR_SYSTEM).toContain(field);
    }
  });

  it("делает acquisition обязательным и объясняет все четыре значения", () => {
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/acquisition ОБЯЗАТЕЛЬНО/);
    for (const mode of ["observed", "told", "inferred", "believed"]) {
      expect(CANON_FACT_EXTRACTOR_SYSTEM).toContain(mode);
    }
  });

  it("задаёт правило имён и предел числа событий", () => {
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/Ивану.*Иван/);
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/Не более 30 событий/);
  });
});

describe("контракт извлекателя", () => {
  const evidence = { evidenceQuote: "— Станцию закрывают" };

  it("ответ без событий по-прежнему валиден", () => {
    const r = canonFactExtractionSchema.safeParse({ facts: [] });
    expect(r.success).toBe(true);
    // Старые staged-результаты в result_json разбираются без изменений.
    expect(r.success && r.data.characterEvents).toEqual([]);
  });

  it("события принимаются рядом с фактами", () => {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [
        {
          subjectName: "Рин",
          kind: "knowledge",
          data: { fact: "Станцию закрывают", acquisition: "told" },
          ...evidence,
        },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.characterEvents).toHaveLength(1);
  });

  it("событие без цитаты отвергается", () => {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [
        {
          subjectName: "Рин",
          kind: "knowledge",
          data: { fact: "X", acquisition: "told" },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("выдуманные имена полей в data отвергаются", () => {
    // `z.object` срезает незнакомые ключи, а известные имеют умолчания, так
    // что без явной проверки такое событие легло бы пустой карточкой.
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [
        {
          subjectName: "Рин",
          kind: "knowledge",
          data: { описание: "Станцию закрывают" },
          ...evidence,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("knowledge без acquisition отвергается, а не считается увиденным", () => {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [
        {
          subjectName: "Рин",
          kind: "knowledge",
          data: { fact: "Станцию закрывают" },
          ...evidence,
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("сдвиг отношения без quality отвергается", () => {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [
        {
          subjectName: "Рин",
          addresseeName: "Сарек",
          kind: "relation_shift",
          data: { from: "ровно", to: "холодно" },
          ...evidence,
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

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
    // Подстрока сама по себе ничего не доказывает: «fact» есть в «facts[]»,
    // «state» — в «stated_by_character», «observed» — в «directly_observed».
    // Проверяем именно строку описания вида, где поля перечислены в data:{}.
    const bullets = {
      knowledge: ["fact", "acquisition", "source"],
      state: ["state", "scope"],
      relation_shift: ["quality", "from", "to"],
      commitment: ["commitment", "toWhom"],
    };
    for (const [kind, fields] of Object.entries(bullets)) {
      const line = CANON_FACT_EXTRACTOR_SYSTEM.split("\n").find(
        (l) => l.startsWith(`- ${kind} —`) && l.includes("data:"),
      );
      expect(line, `нет строки с полями data для ${kind}`).toBeDefined();
      for (const f of fields) expect(line).toContain(`${f}:`);
    }
  });

  it("делает acquisition обязательным и объясняет все четыре значения", () => {
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/acquisition ОБЯЗАТЕЛЬНО/);
    // «observed» и «believed» встречаются в списке assertionMode фактов,
    // поэтому ищем их в строке, которая их именно объясняет.
    const line = CANON_FACT_EXTRACTOR_SYSTEM.split("\n").find((l) =>
      l.includes("acquisition = observed"),
    );
    expect(line).toBeDefined();
    for (const mode of ["told", "inferred", "believed"]) {
      expect(line).toContain(mode);
    }
  });

  it("задаёт правило именительного падежа именно для имён в событиях", () => {
    // Такое же правило давно есть у entityName фактов, поэтому общий поиск
    // по «Ивану → Иван» проходил бы и без этой строки.
    const line = CANON_FACT_EXTRACTOR_SYSTEM.split("\n").find((l) =>
      l.includes("subjectName"),
    );
    expect(line).toBeDefined();
    expect(line).toContain("addresseeName");
    expect(line).toMatch(/Ивану.*Иван/);
  });

  it("называет настоящую цену ошибки и не завышает её", () => {
    // Цена изменилась: негодное событие больше не валит весь ответ, его
    // выбрасывают поштучно (иначе глава теряла и факты, и заметки). Обещать
    // модели катастрофу там, где её нет, — такая же ложь, как обещать
    // дешёвый отказ там, где она есть.
    const whole = CANON_FACT_EXTRACTOR_SYSTEM.match(
      /ВЕСЬ ответ, вместе с фактами/g,
    );
    expect(whole).toHaveLength(1);
    // Единственное, что и правда валит ответ целиком, — превышение предела.
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(
      /Не более 30 событий\. Превышение отвергает ВЕСЬ ответ/,
    );
    const acquisitionLine = CANON_FACT_EXTRACTOR_SYSTEM.split("\n").find((l) =>
      l.includes("acquisition ОБЯЗАТЕЛЬНО"),
    );
    expect(acquisitionLine).toMatch(/отбрасывается целиком/);
  });

  it("называет предел числа событий", () => {
    expect(CANON_FACT_EXTRACTOR_SYSTEM).toMatch(/Не более 30 событий/);
  });
});

describe("контракт извлекателя", () => {
  const evidence = { evidenceQuote: "— Станцию закрывают" };
  const GOOD_EVENT = {
    subjectName: "Сарек",
    kind: "knowledge",
    data: { fact: "Станцию закрывают", acquisition: "told" },
    ...evidence,
  };

  /** Негодное событие в канон не попадает, но и остального не уносит: схема
   *  отдаёт его как `null`, а отсеивает `extractFactsPayload`. Проверяем обе
   *  половины разом — иначе «не принято» легко спутать с «ответ отвергнут»,
   *  что и было раньше и стоило главе фактов и заметок. */
  function expectEventDropped(event: unknown): void {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [event, GOOD_EVENT],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.characterEvents[0]).toBeNull();
    expect(r.data.characterEvents[1]?.subjectName).toBe("Сарек");
  }

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

  it("событие без цитаты в канон не попадает", () => {
    expectEventDropped({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "X", acquisition: "told" },
    });
  });

  it("выдуманные имена полей в data в канон не попадают", () => {
    // `z.object` срезает незнакомые ключи, а известные имеют умолчания, так
    // что без явной проверки такое событие легло бы пустой карточкой.
    expectEventDropped({
      subjectName: "Рин",
      kind: "knowledge",
      data: { описание: "Станцию закрывают" },
      ...evidence,
    });
  });

  it("knowledge без acquisition не становится увиденным", () => {
    expectEventDropped({
      subjectName: "Рин",
      kind: "knowledge",
      data: { fact: "Станцию закрывают" },
      ...evidence,
    });
  });

  it("сдвиг отношения без quality в канон не попадает", () => {
    expectEventDropped({
      subjectName: "Рин",
      addresseeName: "Сарек",
      kind: "relation_shift",
      data: { from: "ровно", to: "холодно" },
      ...evidence,
    });
  });

  it("превышение предела по-прежнему отвергает ответ целиком", () => {
    // Единственный случай, где всё или ничего остаётся правильным: тридцать
    // одно событие значит, что модель не поняла контракт, и тихо срезать
    // хвост хуже, чем повторить вызов.
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: Array.from({ length: 31 }, () => GOOD_EVENT),
    });
    expect(r.success).toBe(false);
  });
});

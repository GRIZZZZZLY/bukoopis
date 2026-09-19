import { describe, it, expect } from "vitest";
import { z } from "zod";
import { canonFactExtractionSchema } from "./canon-facts.js";

const FACT = {
  entityType: "character" as const,
  entityName: "Рин",
  predicate: "умеет",
  objectText: "читать следы",
};

const EVENT = {
  subjectName: "Рин",
  kind: "knowledge" as const,
  data: { fact: "Станцию закрывают", acquisition: "told" as const },
  evidenceQuote: "— Станцию закрывают, — сказал Сарек.",
};

describe("ответ извлекателя канона", () => {
  it("негодная строка не уносит остальной ответ", () => {
    // До этого одно кривое событие валило весь `safeParse`: задание `facts`
    // уходило в error, и глава оставалась без фактов, событий И заметок.
    const r = canonFactExtractionSchema.safeParse({
      facts: [FACT, { entityType: "выдумка", entityName: "" }, FACT],
      characterEvents: [EVENT, { kind: "knowledge" }, EVENT],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.facts).toHaveLength(3);
    expect(r.data.characterEvents).toHaveLength(3);
    // Непринятое приходит как null и отсеивается на сервере — а не молча
    // подменяется правдоподобной пустышкой.
    expect(r.data.facts.filter((f) => f === null)).toHaveLength(1);
    expect(r.data.characterEvents.filter((e) => e === null)).toHaveLength(1);
    expect(r.data.facts[0]?.entityName).toBe("Рин");
    expect(r.data.characterEvents[2]?.subjectName).toBe("Рин");
  });

  it("предел длины остался жёстким", () => {
    // Превышение значит, что модель не поняла контракт. Тихо срезать хвост
    // хуже, чем повторить вызов.
    const r = canonFactExtractionSchema.safeParse({
      facts: Array.from({ length: 41 }, () => FACT),
    });
    expect(r.success).toBe(false);
  });

  it("отсутствующий facts по-прежнему ошибка, а не пустой список", () => {
    // Иначе «модель ничего не прислала» стало бы неотличимо от «в главе
    // ничего нет», и повторять вызов было бы не на что.
    expect(canonFactExtractionSchema.safeParse({}).success).toBe(false);
  });

  it("схема инструмента для модели строится без потерь", () => {
    // `.transform` внутри схемы был бы удобнее, но `z.toJSONSchema` на нём
    // бросает — а по этой схеме описывается инструмент, который видит модель.
    const json = z.toJSONSchema(canonFactExtractionSchema) as {
      properties: Record<string, { items?: unknown; maxItems?: number }>;
    };
    expect(json.properties.facts?.maxItems).toBe(40);
    expect(json.properties.characterEvents?.maxItems).toBe(30);
    // Форма элемента должна остаться в схеме, иначе модель перестанет знать
    // поля: после `.nullable()` она лежит внутри anyOf.
    expect(JSON.stringify(json.properties.facts?.items)).toContain("predicate");
    expect(JSON.stringify(json.properties.characterEvents?.items)).toContain(
      "evidenceQuote",
    );
  });
});

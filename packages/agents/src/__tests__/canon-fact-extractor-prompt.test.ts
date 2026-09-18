import { describe, it, expect } from "vitest";
import { canonFactExtractionSchema } from "@book-forge/shared";

describe("контракт извлекателя", () => {
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
          evidenceQuote: "— Станцию закрывают",
          evidenceStart: 10,
          evidenceEnd: 29,
        },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.characterEvents).toHaveLength(1);
  });

  it("событие без доказательства отбрасывает весь разбор события", () => {
    const r = canonFactExtractionSchema.safeParse({
      facts: [],
      characterEvents: [{ subjectName: "Рин", kind: "knowledge", data: {} }],
    });
    expect(r.success).toBe(false);
  });
});

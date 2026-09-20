import { describe, it, expect } from "vitest";
import {
  CAST_CHECK_SYSTEM,
  buildCastCheckPrompt,
  type CastCheckAgentInput,
} from "../cast-check.js";

const base: CastCheckAgentInput = {
  bookTitle: "Голоса солёного тумана",
  castBlock: "7 — Нина Соловьёва\n  Хочет: доказать, что сигнал настоящий",
  premise: "Когда порт замолкает, гидроакустик слышит чужой голос",
};

describe("buildCastCheckPrompt", () => {
  it("печатает состав с номерами", () => {
    const out = buildCastCheckPrompt(base);
    expect(out).toContain("Нина Соловьёва");
    expect(out).toContain("7");
  });

  it("печатает премису: похожесть судится в контексте книги", () => {
    expect(buildCastCheckPrompt(base)).toContain("слышит чужой голос");
  });

  it("без премисы лишнего заголовка нет", () => {
    expect(buildCastCheckPrompt({ ...base, premise: null })).not.toContain("Премиса");
  });
});

describe("CAST_CHECK_SYSTEM", () => {
  it("велит сравнивать реакции на одинаковые ситуации, а не прилагательные", () => {
    expect(CAST_CHECK_SYSTEM).toMatch(/реакц/i);
    expect(CAST_CHECK_SYSTEM).toMatch(/прилагательн/i);
  });

  it("называет все пять ситуаций каталога", () => {
    for (const s of [
      "value_conflict",
      "request_for_help",
      "mistake",
      "pressure_from_authority",
      "talk_with_close",
    ]) {
      expect(CAST_CHECK_SYSTEM).toContain(s);
    }
  });

  it("говорит, что совпадение одной ценности — норма", () => {
    expect(CAST_CHECK_SYSTEM).toMatch(/одной ценности/i);
  });

  it("запрещает требовать максимальной противоположности", () => {
    expect(CAST_CHECK_SYSTEM).toMatch(/противоположн/i);
  });

  it("называет отчёт предложением, а не правкой", () => {
    expect(CAST_CHECK_SYSTEM).toMatch(/предложен/i);
    expect(CAST_CHECK_SYSTEM).toMatch(/не меняешь|ничего не меняет|не правишь/i);
  });

  it("разрешает пустой список пар", () => {
    expect(CAST_CHECK_SYSTEM).toMatch(/пуст/i);
  });
});

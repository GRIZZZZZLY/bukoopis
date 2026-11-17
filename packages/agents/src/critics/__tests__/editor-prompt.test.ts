import { describe, it, expect } from "vitest";
import { buildEditorPrompt } from "../editor.js";
import type { CriticInput } from "../base.js";

const base: CriticInput = {
  chapterText: "Текст главы.",
  chapterTitle: "Глава 1",
  pov: "Иван",
  emotionalGoal: "тревога",
  bookContext: "Контекст книги",
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
};

describe("buildEditorPrompt — optional beat-sheet", () => {
  it("includes the beat-sheet block and beat-aware task when provided", () => {
    const p = buildEditorPrompt({
      ...base,
      beatSheet: "1. [setup] Завязка\n   Цель: показать город",
    });
    expect(p).toContain("Принятый beat-sheet:\n1. [setup] Завязка");
    expect(p).toContain("Сверь её с принятым планом");
    // Второй разбор прозы 2026-09-23: редактор не требует от каждой главы
    // кульминации и крючка.
    expect(p).not.toContain("hook → setup → rising → climax");
    expect(p).not.toContain("План не передан");
  });

  it("omits the block and forbids false beat-sheet claims when absent", () => {
    const p = buildEditorPrompt(base);
    expect(p).not.toContain("Принятый beat-sheet:");
    expect(p).toContain("План не передан");
    expect(p).toContain("не утверждай, что глава ему противоречит");
  });
});

describe("buildEditorPrompt — глава по содержанию", () => {
  it("путь с беатами не изменился ни на байт", () => {
    const p = buildEditorPrompt({ ...base, beatSheet: "1. [setup] Завязка", planBasis: "beats" });
    expect(p).toBe(
      [
        "Книга/контекст:\nКонтекст книги",
        'Глава: "Глава 1"',
        "POV: Иван",
        "Эмоциональная цель: тревога",
        "Принятый beat-sheet:\n1. [setup] Завязка",
        "Текст главы:\n\nТекст главы.",
        "\nЗадача:\nПрочитай главу. Сверь её с принятым планом: произошли ли ключевые события и в понятном ли порядке, держится ли POV. Беаты плана — ориентир писателю: другое распределение внимания или другое число абзацев на беат ошибкой не считается. Найди места, где читатель теряет ход событий, и нарушения обязательств.",
      ].join("\n\n---\n\n"),
    );
    expect(buildEditorPrompt({ ...base, beatSheet: "1. [setup] Завязка" })).toBe(p);
  });

  it("содержание главы — задача главы, без beat-sheet, POV и контракта", () => {
    const p = buildEditorPrompt({
      ...base,
      pov: "—",
      emotionalGoal: "—",
      beatSheet: "Нина находит письмо отца.",
      planBasis: "intent",
    });
    expect(p).toContain("Содержание главы (задача главы):\nНина находит письмо отца.");
    expect(p).toContain("Сверь её с содержанием, которое задал автор");
    expect(p).not.toContain("beat-sheet");
    expect(p).not.toMatch(/контракт/i);
    expect(p).not.toContain("POV");
  });
});

describe("buildEditorPrompt — ни плана, ни содержания", () => {
  it("задача не ссылается на POV и цель, а сверяет с прошлыми главами и карточками", () => {
    const p = buildEditorPrompt({ ...base, pov: "—", emotionalGoal: "—", planBasis: "none" });
    expect(p).toContain("Ни плана, ни содержания главы автор не задавал");
    expect(p).toContain("прошлыми главами и карточками героев");
    expect(p).not.toContain("указаны выше");
    expect(p).not.toContain("POV");
    expect(p).not.toContain("Эмоциональная цель");
    expect(p).not.toContain("beat-sheet");
  });

  it("без поля planBasis и без плана — прежняя задача, побайтно", () => {
    expect(buildEditorPrompt(base)).toContain(
      "\nЗадача:\nПрочитай главу. План не передан — не утверждай, что глава ему противоречит; оценивай, понятно ли движется сама глава (POV и эмоциональная цель указаны выше). Найди места, где читатель теряет ход событий.",
    );
  });
});

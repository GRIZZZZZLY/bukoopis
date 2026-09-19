import { describe, it, expect } from "vitest";
import { renderChapterContract, type ChapterContract } from "@book-forge/shared";
import { buildCanonPrompt } from "../critics/canon.js";
import { buildEditorPrompt } from "../critics/editor.js";
import { buildReviserStableSystem } from "../reviser.js";
import { CANON_SYSTEM, EDITOR_SYSTEM } from "../critics/index.js";
import type { CriticInput } from "../critics/base.js";

/**
 * Слайс 4.5: контракт главы даёт критикам то, чего у них не было, — различие
 * между запланированным поворотом и ошибкой. Без него «выясняется, что брат
 * жив» — противоречие действующему факту «брат погиб», и критик канона
 * блокирует ровно тот поворот, ради которого глава писалась.
 */

const contract: ChapterContract = {
  mustHappen: ["Рин находит медальон"],
  mustNotHappen: ["Сарек называет имя убийцы"],
  expectedRevelations: ["Станцию закрывают"],
  allowedCanonSupersessions: [
    { factId: "fact_12", statement: "брат погиб", becomes: "брат жив" },
  ],
};

const base: CriticInput = {
  chapterText: "Текст главы.",
  chapterTitle: "Глава",
  pov: "Рин",
  emotionalGoal: "тревога",
  bookContext: "Книга",
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
};

describe("контракт главы у критиков", () => {
  it("критик канона и редактор печатают контракт, когда он есть", () => {
    for (const build of [buildCanonPrompt, buildEditorPrompt]) {
      const prompt = build({ ...base, chapterContract: renderChapterContract(contract) });
      expect(prompt).toContain("Контракт главы");
      expect(prompt).toContain("fact_12");
      expect(prompt).toContain("Сарек называет имя убийцы");
    }
  });

  it("без контракта промпты прежние — старые главы не меняются", () => {
    for (const build of [buildCanonPrompt, buildEditorPrompt]) {
      expect(build(base)).not.toContain("Контракт главы");
    }
  });

  it("критик канона знает, что разрешённая отмена — не замечание", () => {
    expect(CANON_SYSTEM).toMatch(/вправе отменить|разрешённ/i);
    // И что неразрешённая — по-прежнему замечание: правило, снимающее
    // проверку целиком, хуже отсутствующего.
    expect(CANON_SYSTEM).toMatch(/в контракте нет|не назван/i);
  });

  it("критик канона не считает запланированное раскрытие неподготовленным", () => {
    expect(CANON_SYSTEM).toMatch(/раскрыва/i);
  });

  it("редактор проверяет невыполненные обязательства", () => {
    expect(EDITOR_SYSTEM).toMatch(/Обязано случиться|mustHappen/);
    expect(EDITOR_SYSTEM).toMatch(/blocking/);
  });

  it("«не случилось» — единственное замечание без цитаты, и это сказано", () => {
    // Общее правило проекта: нет цитаты — нет замечания. Цитировать
    // отсутствие нечем, поэтому исключение названо явно, иначе критик либо
    // промолчит, либо выдумает цитату.
    expect(EDITOR_SYSTEM).toMatch(/без цитаты/i);
  });

  it("правка тоже видит контракт, и он сильнее замечания", () => {
    // Критик видит текст, а не план: он вправе предложить убрать сцену,
    // которую план объявил обязательной. Reviser — последний проход, после
    // него это уже не заметит никто.
    const system = buildReviserStableSystem({
      bookContext: "Книга",
      chapterTitle: "Глава",
      pov: "Рин",
      emotionalGoal: "тревога",
      chapterContract: renderChapterContract(contract),
      characterContext: null,
      loreContext: null,
      styleContext: null,
      fatigueWords: [],
      previousChaptersSummary: null,
      originalText: "Текст.",
      critics: [],
      iteration: 1,
    });
    expect(system).toContain("Контракт главы");
    expect(system).toMatch(/сильнее замечаний/i);
  });

  it("контракт в промпте отрендерен тем же способом, что у Писателя", () => {
    // Два рендера разошлись бы: критик судил бы по одной формулировке, а
    // Писатель работал по другой.
    const rendered = renderChapterContract(contract)!;
    expect(buildCanonPrompt({ ...base, chapterContract: renderChapterContract(contract) })).toContain(rendered);
  });
});

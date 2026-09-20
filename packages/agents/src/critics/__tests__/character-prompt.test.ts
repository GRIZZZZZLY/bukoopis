import { describe, it, expect } from "vitest";
import { CHARACTER_CRITIC_SYSTEM, buildCharacterPrompt } from "../character.js";
import type { CriticInput } from "../base.js";

const base: CriticInput = {
  chapterText: "— Не знаю, — сказал Ворт. — Не знаю, — сказала Нина.",
  chapterTitle: "Смена в четыре",
  pov: "Нина Соловьёва",
  emotionalGoal: "тревога",
  bookContext: "Книга про порт",
  previousChaptersSummary: null,
  characterContext: "Персонажи в сцене:\n\n### Нина Соловьёва\nЗнает: станцию спишут",
  loreContext: null,
};

describe("buildCharacterPrompt", () => {
  it("даёт критику карточки участников: без них судить не по чему", () => {
    const out = buildCharacterPrompt(base);
    expect(out).toContain("Нина Соловьёва");
    expect(out).toContain("Знает: станцию спишут");
  });

  it("печатает текст главы и её POV", () => {
    const out = buildCharacterPrompt(base);
    expect(out).toContain("— Не знаю, — сказал Ворт.");
    expect(out).toContain("POV: Нина Соловьёва");
  });

  it("не печатает замысел сцены: критик судит написанное, а не замысел", () => {
    const out = buildCharacterPrompt({
      ...base,
      // Поле замысла критику не передаётся вовсе — проверяем, что и
      // соседние блоки его не протаскивают.
      characterContext: "Персонажи в сцене:\n\n### Нина Соловьёва",
    });
    expect(out).not.toContain("Замысел сцены");
  });
});

describe("CHARACTER_CRITIC_SYSTEM", () => {
  it("требует минимум двух героев для взаимозаменяемости (AC-28)", () => {
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/взаимозаменяем/i);
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/двух|двоих/i);
  });

  it("называет недостаточные основания прямо", () => {
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/ладно/i);
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/професси/i);
  });

  it("разделяет «непривычно» и «противоречит знаниям»", () => {
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/unusual_but_allowed/);
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/knowledge_breach/);
  });

  it("требует границу знаний считать по карточке, а не по канону книги", () => {
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/к началу сцены|карточк/i);
  });

  it("несёт общую калибровку критиков", () => {
    expect(CHARACTER_CRITIC_SYSTEM).toContain("Калибровка:");
  });

  it("не требует делать героев противоположными", () => {
    expect(CHARACTER_CRITIC_SYSTEM).toMatch(/не требуй|не превраща/i);
  });
});

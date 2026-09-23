import { describe, it, expect } from "vitest";
import { buildStylePrompt, STYLE_CRITIC_SYSTEM } from "../style.js";
import { CRITIC_CALIBRATION_RULE, type CriticInput } from "../base.js";

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

// The style critic used to judge from impression alone. It now receives the
// measured structural-tell block (counts per 1000 words with quotes) and a
// calibration rule shared with the other critics: quote or no signal,
// clusters not single hits, and a list of things that are not defects in
// Russian prose.

describe("buildStylePrompt — measured structural tells", () => {
  it("includes the measured block before the chapter text when provided", () => {
    const p = buildStylePrompt({
      ...base,
      structuralTellsContext: "Структурные маркеры ИИ-прозы (измерено; всего 10 слов)",
    });
    expect(p).toContain("Структурные маркеры ИИ-прозы (измерено; всего 10 слов)");
    expect(p.indexOf("Структурные маркеры")).toBeLessThan(p.indexOf("Текст главы:"));
  });

  it("omits the block when nothing was measured", () => {
    const p = buildStylePrompt(base);
    expect(p).not.toContain("Структурные маркеры");
    expect(p).not.toContain("измерен");
  });
});

describe("style critic system prompt", () => {
  it("carries the shared calibration rule", () => {
    expect(STYLE_CRITIC_SYSTEM).toContain(CRITIC_CALIBRATION_RULE);
  });

  // Второй разбор прозы 2026-09-23: числа машинного baseline — не норма
  // хорошей прозы, и «звучит как ChatGPT» — не основание для blocking.
  it("reads the measured counters as evidence of repetition, not as norms", () => {
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Структурные маркеры ИИ-прозы/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Чисел нормы у этих маркеров нет/);
    expect(STYLE_CRITIC_SYSTEM).not.toMatch(/~4/);
  });

  it("does not block on a vague 'sounds like ChatGPT' impression", () => {
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Впечатление «звучит как ChatGPT» без названного приёма и цитат — не основание/);
  });

  it("prefers deletion and allows 'no significant problems'", () => {
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Предпочитай правку «убрать»/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/существенных проблем нет/);
  });

  // Правка меняет только отмеченное критиком, поэтому проверка «рассказчик
  // знает, что его читают» живёт здесь, а не только у редактора.
  it("checks for a narrator who knows he is being read", () => {
    expect(STYLE_CRITIC_SYSTEM).toMatch(/будто заранее знает, что его будут читать/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/маленькие теории о людях/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/объяснение жеста после самого жеста/);
  });

  // Четвёртое сравнение: критик сам продиктовал сжатую концовку, захватил
  // характерную гиперболу цитатой в абзац и просил убрать конкретную деталь.
  it("spares character and detail, quotes the phrase, dictates no punchline", () => {
    expect(STYLE_CRITIC_SYSTEM).toMatch(/узнаём ли мы без неё меньше/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Конкретная деталь \(предмет, привычка, число\) — не украшение/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/а не весь абзац вокруг неё/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/не предлагай готовую новую концовку/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/добавляет новую гипотезу, факт, мотив, риск/);
  });

  // Разбор автора: синтетичной бывает и одна фраза — необычность ради
  // необычности. Примеров из тестовых сцен в промпте нет намеренно.
  it("checks a single phrase for invented originality", () => {
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Придуманная необычность/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/была ли у рассказчика причина сформулировать мысль именно так/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Перескажи фразу простыми словами/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Проверяй необычные глаголы и сочетания существительных буквально/);
    expect(STYLE_CRITIC_SYSTEM).toMatch(/Необычность должна давать дополнительную точность, а не заменять её/);
    // Тест «узнаём ли меньше» защищал придуманную форму нужной мысли.
    expect(STYLE_CRITIC_SYSTEM).toMatch(/здесь формулировку не защищает/);
  });
});

describe("CRITIC_CALIBRATION_RULE", () => {
  it("requires a quote per signal and counts clusters, not single hits", () => {
    expect(CRITIC_CALIBRATION_RULE).toMatch(/нет цитаты/i);
    expect(CRITIC_CALIBRATION_RULE).toMatch(/кластер/i);
  });

  it("exempts тире and a prescribed dense style from being flagged", () => {
    expect(CRITIC_CALIBRATION_RULE).toMatch(/тире/);
    expect(CRITIC_CALIBRATION_RULE).toMatch(/«Стиль»/);
  });

  it("names over-correction as a separate failure mode", () => {
    expect(CRITIC_CALIBRATION_RULE).toMatch(/перегиб|over-correction/i);
  });
});

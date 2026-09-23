import { describe, it, expect } from "vitest";
import {
  buildReviserStableSystem,
  buildReviserVolatilePrompt,
  type ReviseChapterInput,
} from "../reviser.js";

const base: ReviseChapterInput = {
  bookContext: "Контекст книги",
  chapterTitle: "Глава 1",
  pov: "Иван",
  emotionalGoal: "тревога",
  characterContext: null,
  loreContext: null,
  styleContext: null,
  fatigueWords: [],
  previousChaptersSummary: null,
  originalText: "Текст главы.",
  critics: [],
  iteration: 1,
};

// Repair is the last thing that touches the prose, so it is the last place a
// reflection tail or a sanded-flat surface can be reintroduced. The 2026-09-04
// review found the Writer doing both; the Reviser had no rule against either.

describe("Reviser system rules — structural tells", () => {
  const system = buildReviserStableSystem(base);

  it("forbids adding an explanation of the theme", () => {
    expect(system).toMatch(/не объясняй тему/i);
  });

  it("forbids adding a reflection tail after the climax", () => {
    expect(system).toMatch(/рефлекси/i);
  });

  // Второй разбор прозы 2026-09-23: правка «улучшала» текст, делая его
  // образнее. Главное правило теперь — минимальное вмешательство.
  it("makes minimal intervention the main rule", () => {
    expect(system).toMatch(/минимальное вмешательство/i);
  });

  it("allows plain deletion as a fix", () => {
    expect(system).toMatch(/Удалить — законная правка/);
  });

  it("forbids making the text more figurative than the original", () => {
    expect(system).toMatch(/не делает текст образнее оригинала/i);
    expect(system).not.toMatch(/последний абзац — действие, реплика или образ/i);
  });

  it("treats plain sentences as legitimate, not defects", () => {
    expect(system).toMatch(/Обычные фразы/);
  });

  it("keeps the chapter's ending shape", () => {
    expect(system).toMatch(/финал главы/i);
  });
});

describe("buildReviserStableSystem — narrative architecture", () => {
  it("renders the architecture block when the route provides it", () => {
    const system = buildReviserStableSystem({
      ...base,
      architectureContext: "Тема: подразумевается\nФинал: частичный",
    });
    expect(system).toContain("Архитектура книги");
    expect(system).toContain("Тема: подразумевается");
  });

  it("AC-36: хвост предыдущей главы и найденные фрагменты доходят до Reviser", () => {
    // Правка — последний проход по прозе; без этих блоков она чинила стык с
    // предыдущей главой, которого не видела.
    const system = buildReviserStableSystem({
      ...base,
      previousChaptersSummary: "СВОДКА",
      previousChapterTail: "ХВОСТ_ДЕВЯТОЙ",
      retrievedContext: "## Релевантные фрагменты предыдущих глав\nФРАГМЕНТ",
    });
    expect(system).toContain("Предыдущие главы (краткое):\nСВОДКА");
    expect(system).toContain("ХВОСТ_ДЕВЯТОЙ");
    expect(system).toMatch(/Финал предыдущей главы \(дословно/);
    expect(system).toContain("ФРАГМЕНТ");
    // Фрагменты идут раньше сводки и хвоста — как у Writer.
    expect(system.indexOf("ФРАГМЕНТ")).toBeLessThan(system.indexOf("СВОДКА"));
  });

  it("omits the block when there is no architecture", () => {
    expect(buildReviserStableSystem(base)).not.toContain("Архитектура книги");
  });
});

describe("buildReviserVolatilePrompt", () => {
  it("passes the beat-sheet block through, closing line included", () => {
    const prompt = buildReviserVolatilePrompt({
      ...base,
      beatSheet: "1. [hook] Завязка\n\nФинал главы: обрыв посреди действия — Обрыв на пороге.",
    });
    expect(prompt).toContain("Финал главы: обрыв посреди действия — Обрыв на пороге.");
    expect(prompt).toContain("Принятый beat-sheet главы");
  });

  it("omits the beat-sheet block when absent", () => {
    const prompt = buildReviserVolatilePrompt(base);
    expect(prompt).not.toContain("Принятый beat-sheet главы");
    expect(prompt).toContain("Оригинальная глава для переработки:");
  });
});

// ───────── Локальная правка (этап 5, слайс 3) ─────────

const twoCritics: ReviseChapterInput["critics"] = [
  {
    critic: "character",
    overallNotes: "заметки",
    issues: [
      { severity: "blocking", summary: "Ворт знает лишнее", excerpt: "— Я выложу твою запись" },
      { severity: "nit", summary: "мелочь про паузу" },
    ],
  },
  {
    critic: "style",
    overallNotes: "заметки",
    issues: [{ severity: "suggestion", summary: "три сравнения подряд" }],
  },
];

describe("buildReviserVolatilePrompt — выбранные замечания", () => {
  it("печатает только выбранные, остальные не показывает", () => {
    const out = buildReviserVolatilePrompt({
      ...base,
      critics: twoCritics,
      selectedIssueIds: ["character:0"],
    });
    expect(out).toContain("Ворт знает лишнее");
    expect(out).not.toContain("три сравнения подряд");
    expect(out).not.toContain("мелочь про паузу");
  });

  it("без выбора печатает всё, как раньше", () => {
    const out = buildReviserVolatilePrompt({ ...base, critics: twoCritics });
    expect(out).toContain("Ворт знает лишнее");
    expect(out).toContain("три сравнения подряд");
  });

  it("выбор сильнее фильтра по серьёзности: автор выбрал именно это", () => {
    const out = buildReviserVolatilePrompt({
      ...base,
      critics: twoCritics,
      severityFilter: ["blocking"],
      selectedIssueIds: ["style:0"],
    });
    expect(out).toContain("три сравнения подряд");
    expect(out).not.toContain("Ворт знает лишнее");
  });

  it("говорит прямо, что правится только выбранное", () => {
    const out = buildReviserVolatilePrompt({
      ...base,
      critics: twoCritics,
      selectedIssueIds: ["character:0"],
    });
    expect(out).toMatch(/только (это|эти|выбранн)/i);
  });
});

describe("buildReviserVolatilePrompt — защищённые фрагменты", () => {
  it("печатает их дословно и запрещает трогать", () => {
    const out = buildReviserVolatilePrompt({
      ...base,
      protectedFragments: ["Металл был тёплый.", "Она не обернулась."],
    });
    expect(out).toContain("Металл был тёплый.");
    expect(out).toContain("Она не обернулась.");
    expect(out).toMatch(/не тронь|не трогай|без изменений/i);
  });

  it("без защищённых кусков блока нет вовсе", () => {
    expect(buildReviserVolatilePrompt(base)).not.toMatch(/не трогай/i);
  });
});

describe("Reviser — порядок удаления (слепое сравнение 2026-09-23)", () => {
  const system = buildReviserStableSystem({
    bookContext: "", chapterTitle: "", pov: "", emotionalGoal: "", characterContext: null, loreContext: null,
    styleContext: null, fatigueWords: [], previousChaptersSummary: null, originalText: "", critics: [], iteration: 1,
  } as never);
  it("names what to remove first when the author tries too hard", () => {
    expect(system).toMatch(/Ладонь осталась на засове/);
    // Третье слепое сравнение (2026-09-23): рассказчик «в сборнике цитат».
    // Правила без чисел — редактор решает по тексту, а не выполняет квоту.
    expect(system).toMatch(/Где текст старается/);
    expect(system).toMatch(/оставь одну — самую простую/);
    expect(system).toMatch(/начиная с самых умных/);
    expect(system).not.toMatch(/\d+\s*%\s*сравнений/);
  });
  // Четвёртое сравнение: правка вырезала характер вместе с остротой,
  // оставила шов «Так что» и сжала афоризм в новую концовку.
  it("guards character, seams and endings after a deletion", () => {
    expect(system).toMatch(/узнаём ли мы без этой фразы меньше/);
    expect(system).toMatch(/Правка не должна оставлять след удаления/);
    expect(system).toMatch(/простая характерная реплика персонажа/);
    expect(system).toMatch(/Не сжимай афоризм в короткую ударную фразу/);
  });
  // Пятое сравнение: правка выбросила одну из трёх версий героя как «лишнее».
  it("keeps each of the character's hypotheses", () => {
    expect(system).toMatch(/нельзя объединять или удалять отдельную гипотезу/);
    expect(system).toMatch(/Не сохраняй необычную формулировку только потому, что она выразительная/);
  });
  it("does not answer 'feeling not conveyed' with a body-before-mind phrase", () => {
    expect(system).toMatch(/не выполняй телесной реакцией/);
  });
});

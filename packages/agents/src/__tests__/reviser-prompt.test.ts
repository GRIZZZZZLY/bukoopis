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

  it("preserves slack instead of polishing every sentence", () => {
    expect(system).toMatch(/слабин/i);
  });

  it("preserves the register contrast between scenes", () => {
    expect(system).toMatch(/регистр/i);
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

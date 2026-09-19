import { describe, it, expect } from "vitest";
import {
  buildWriterStableSystem,
  buildWriterVolatilePrompt,
  type WriteChapterInput,
} from "../writer.js";

const base: WriteChapterInput = {
  bookTitle: "Книга",
  bookPremise: "Премиса",
  bookOutline: null,
  studioContext: null,
  retrievedContext: null,
  chapterTitle: "Глава 2",
  beatSheet: {
    pov: "Иван",
    emotionalGoal: "тревога",
    beats: [],
  } as unknown as WriteChapterInput["beatSheet"],
  previousChaptersSummary: null,
  characterContext: null,
  loreContext: null,
  styleContext: null,
  fatigueWords: [],
};

describe("buildWriterStableSystem — previous chapter tail", () => {
  it("includes the verbatim tail with an instruction to continue from it", () => {
    const system = buildWriterStableSystem({
      ...base,
      previousChapterTail: "Он закрыл дверь и не обернулся.",
    });

    expect(system).toContain("Он закрыл дверь и не обернулся.");
    expect(system).toContain("Финал предыдущей главы");
  });

  it("omits the tail block when there is no preceding chapter", () => {
    const system = buildWriterStableSystem(base);

    expect(system).not.toContain("Финал предыдущей главы");
  });

  it("keeps the tail distinct from the previous-chapters summary", () => {
    const system = buildWriterStableSystem({
      ...base,
      previousChaptersSummary: "Иван приехал в город.",
      previousChapterTail: "Он закрыл дверь и не обернулся.",
    });

    expect(system).toContain("Краткое содержание предыдущих глав:");
    expect(system).toContain("Финал предыдущей главы");
    // The tail must come after the summary — nearest context sits closest to
    // the task, and the summary stays a stable cache prefix for longer.
    expect(system.indexOf("Финал предыдущей главы")).toBeGreaterThan(
      system.indexOf("Краткое содержание предыдущих глав:"),
    );
  });
});

// The 2026-09-04 sepia review: all three Writer versions explained the theme,
// kept one cadence across scenes, ended on choice+acceptance with a long
// reflection tail, and copied beat-sheet lines verbatim. These rules answer
// each of those, and the architecture/closing decisions the Plot agent now
// makes have to reach the Writer in Russian, not as raw JSON keys.

describe("Writer system rules — structural tells", () => {
  const system = buildWriterStableSystem(base);

  it("forbids the narrator explaining the theme", () => {
    expect(system).toMatch(/не объясняй тему/i);
  });

  it("asks for a register shift between scenes", () => {
    expect(system).toMatch(/регистр/i);
  });

  it("caps post-climax reflection and bans the reflection tail", () => {
    expect(system).toMatch(/рефлекси/i);
  });

  it("allows slack: not every sentence has to work", () => {
    expect(system).toMatch(/слабин/i);
  });

  it("forbids copying beat-sheet wording verbatim", () => {
    expect(system).toMatch(/дословно/i);
  });
});

describe("buildWriterStableSystem — narrative architecture from the outline", () => {
  const outlineWithArchitecture = JSON.stringify({
    label: "тёмный",
    logline: "l",
    synopsis: "s",
    themes: ["t"],
    protagonist: "p",
    antagonist: null,
    setting: "s",
    arcs: [
      { title: "a", summary: "s", keyBeats: ["b"] },
      { title: "b", summary: "s", keyBeats: ["b"] },
    ],
    estimatedChapters: 12,
    architecture: {
      themeHandling: "implied",
      subplot: "contrasting",
      resolutionDriver: "external",
      endingMode: "partial",
      timeStructure: "moderate_anachrony",
      revelationPacing: "back_loaded",
      emotionMode: "behavior_led",
      rarityMove: "Антагонист побеждает.",
      humanMoves: ["a", "b", "c"],
    },
  });

  it("renders the architecture sheet in Russian after the outline", () => {
    const system = buildWriterStableSystem({ ...base, bookOutline: outlineWithArchitecture });
    expect(system).toContain("Архитектура книги");
    expect(system).toContain("Тема: подразумевается");
    expect(system).toContain("Эмоции: через поведение");
    expect(system.indexOf("Архитектура книги")).toBeGreaterThan(
      system.indexOf("Outline книги:"),
    );
  });

  it("omits the block for a legacy outline without architecture", () => {
    const legacy = JSON.stringify({ label: "x", logline: "l", synopsis: "s" });
    const system = buildWriterStableSystem({ ...base, bookOutline: legacy });
    expect(system).toContain("Outline книги:");
    expect(system).not.toContain("Архитектура книги");
  });

  it("survives an outline that is not JSON", () => {
    const system = buildWriterStableSystem({ ...base, bookOutline: "просто текст" });
    expect(system).toContain("просто текст");
    expect(system).not.toContain("Архитектура книги");
  });
});

describe("buildWriterVolatilePrompt — chapter closing", () => {
  const beatSheet = {
    label: "v1",
    pov: "Иван",
    emotionalGoal: "тревога",
    estimatedWords: 3000,
    beats: [
      { index: 0, type: "hook", summary: "s", goal: "g", conflict: "c", outcome: "o" },
    ],
  } as unknown as WriteChapterInput["beatSheet"];

  it("renders the closing decision in Russian when the beat-sheet has one", () => {
    const prompt = buildWriterVolatilePrompt({
      ...base,
      beatSheet: {
        ...beatSheet,
        closing: { mode: "cut_mid_action", note: "Обрыв на пороге." },
      },
    });
    expect(prompt).toContain("Финал главы: обрыв посреди действия — Обрыв на пороге.");
    expect(prompt.indexOf("Финал главы:")).toBeGreaterThan(prompt.indexOf("Beats:"));
  });

  it("omits the closing line for a legacy beat-sheet", () => {
    const prompt = buildWriterVolatilePrompt({ ...base, beatSheet });
    expect(prompt).toContain("Beats:");
    expect(prompt).not.toContain("Финал главы:");
  });

  it("печатает контракт главы после beats", () => {
    const prompt = buildWriterVolatilePrompt({
      ...base,
      beatSheet: {
        ...beatSheet,
        contract: {
          mustHappen: ["Рин находит медальон"],
          mustNotHappen: ["Сарек называет имя убийцы"],
          expectedRevelations: [],
          allowedCanonSupersessions: [],
        },
      } as unknown as WriteChapterInput["beatSheet"],
    });
    expect(prompt).toContain("Контракт главы");
    expect(prompt).toContain("Рин находит медальон");
    expect(prompt).toContain("Сарек называет имя убийцы");
    expect(prompt.indexOf("Контракт главы")).toBeGreaterThan(prompt.indexOf("Beats:"));
  });

  it("без контракта заголовка нет", () => {
    expect(buildWriterVolatilePrompt({ ...base, beatSheet })).not.toContain(
      "Контракт главы",
    );
  });

  it("запрет из контракта сильнее беата", () => {
    // Беат и запрет могут противоречить друг другу: план сгенерирован одной
    // моделью, и она способна положить в beats то, что сама же запретила.
    // Без правила Writer выберет более подробный источник — beats.
    const system = buildWriterStableSystem(base);
    expect(system).toMatch(/чего быть не должно/i);
    expect(system).toMatch(/запрет/i);
  });

  it("правило POV указывает на блок, который действительно печатается", () => {
    // Раньше оно ссылалось на «Известно POV-персонажу» — блок, удалённый
    // вместе с двойным рендером, — и добавляло «(если он есть)», то есть
    // само же делало запрет необязательным.
    const system = buildWriterStableSystem(base);
    expect(system).toContain("«Знает»");
    expect(system).not.toContain("Известно POV-персонажу");
    expect(system).not.toContain("(если он есть)");
  });
});

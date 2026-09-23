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

  // Второй разбор прозы 2026-09-23: стилевой блок заменён целиком, а не
  // дописан — прежние требования тянули прозу в обратную сторону.
  it("allows plain sentences and uneven attention across the plan", () => {
    expect(system).toMatch(/Обычные реплики и простые связующие предложения допустимы/);
    expect(system).toMatch(/Границы беатов не обязаны совпадать с абзацами/);
  });

  it("no longer maps beats to paragraphs or prescribes an image ending", () => {
    expect(system).not.toMatch(/1-4 абзаца/);
    expect(system).not.toMatch(/последний абзац — действие, реплика или образ/i);
    expect(system).not.toMatch(/Одна каденция на всю главу/);
  });

  it("allows naming a feeling directly instead of forcing a bodily gesture", () => {
    expect(system).toMatch(/«я боялся»/);
    expect(system).toMatch(/Не добавляй телесный жест только ради демонстрации чувства/);
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
    expect(prompt).toContain(
      "Где глава останавливается (событие, а не готовая последняя фраза): обрыв посреди действия — Обрыв на пороге.",
    );
    expect(prompt.indexOf("Где глава останавливается")).toBeGreaterThan(prompt.indexOf("План событий"));
  });

  it("omits the stop point for a legacy beat-sheet", () => {
    const prompt = buildWriterVolatilePrompt({ ...base, beatSheet });
    expect(prompt).toContain("План событий");
    expect(prompt).not.toContain("Где глава останавливается");
  });

  it("shows the writer what happens, not the planner's working notes", () => {
    const prompt = buildWriterVolatilePrompt({
      ...base,
      beatSheet: {
        ...beatSheet,
        beats: [
          { index: 0, type: "setup", summary: "Рин чинит сеть", goal: "показать быт", conflict: "локального конфликта нет", outcome: "сеть починена" },
          { index: 1, type: "climax", summary: "Сарек входит", goal: "поворот", conflict: "Рин прячет медальон", outcome: "медальон спрятан" },
        ],
      },
    });
    expect(prompt).not.toContain("показать быт");
    expect(prompt).not.toMatch(/\[setup\]|\[climax\]/);
    expect(prompt).not.toContain("локального конфликта нет");
    expect(prompt).toContain("Что мешает: Рин прячет медальон");
    expect(prompt).toContain("К чему приходит: сеть починена");
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

// ───────── Этап 5: замысел сцены ─────────

describe("buildWriterVolatilePrompt — замысел сцены", () => {
  const intent =
    "Замысел сцены:\n\nНина Соловьёва\n— Хочет в этой сцене: увести брата со станции";

  it("печатает замысел перед беатами: намерение объясняет, из чего герой действует", () => {
    const out = buildWriterVolatilePrompt({ ...base, sceneIntent: intent });
    expect(out).toContain("увести брата со станции");
    expect(out.indexOf("Замысел сцены")).toBeLessThan(out.indexOf("План событий"));
  });

  it("без замысла блока нет вовсе", () => {
    expect(buildWriterVolatilePrompt(base)).not.toContain("Замысел сцены");
  });
});

describe("SYSTEM_WRITER — правила этапа 5", () => {
  // Промпт собирается в системной половине; проверяем через неё.
  const system = buildWriterStableSystem(base);

  it("называет приоритет: контракт главы сильнее замысла сцены", () => {
    expect(system).toMatch(/замысел[^\n]*контракт|контракт[^\n]*замысел/i);
  });

  it("требует воплощать намерение действием и речью, а не пересказом карточки", () => {
    expect(system).toMatch(/не пересказыва[^\n]*карточк/i);
  });

  it("различает голос повествователя, восприятие POV и прямую речь", () => {
    expect(system).toMatch(/повествовател/i);
    expect(system).toMatch(/прямая речь|прямой речи/i);
  });

  it("запрещает превращать характер в частотное правило", () => {
    expect(system).toMatch(/инженер|частотн/i);
  });
});

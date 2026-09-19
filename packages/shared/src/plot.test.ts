import { describe, it, expect } from "vitest";
import {
  bookOutlineVariantSchema,
  canonSupersessionSchema,
  chapterBeatSheetVariantSchema,
  chapterPlanSchema,
  extractNarrativeArchitecture,
  narrativeArchitectureSchema,
  outlineChapterSchema,
  renderChapterContract,
  renderNarrativeArchitecture,
  renderChapterClosing,
  renderOutlineChapterIntent,
  type NarrativeArchitecture,
} from "./plot.js";

const legacyVariant = {
  label: "тёмный",
  logline: "Колдун узнаёт, что учитель служит злу.",
  synopsis: "Завязка. Поворот. Низшая точка. Кульминация.",
  themes: ["предательство"],
  protagonist: "Ратибор",
  antagonist: "Всеслав",
  setting: "Славянское средневековье",
  arcs: [
    { title: "Ратибор", summary: "s", keyBeats: ["b"] },
    { title: "Сюжет", summary: "s", keyBeats: ["b"] },
  ],
  estimatedChapters: 20,
};

const architecture: NarrativeArchitecture = {
  themeHandling: "implied",
  subplot: "contrasting",
  resolutionDriver: "external",
  endingMode: "partial",
  timeStructure: "moderate_anachrony",
  revelationPacing: "back_loaded",
  emotionMode: "behavior_led",
  rarityMove: "Антагонист побеждает в кульминации, герой узнаёт об этом позже.",
  humanMoves: [
    "тема не проговаривается нарратором",
    "развязку решает третья сила",
    "откровения сдвинуты во вторую половину",
  ],
};

describe("bookOutlineVariantSchema — narrative architecture", () => {
  it("still accepts a stored variant without architecture", () => {
    expect(bookOutlineVariantSchema.safeParse(legacyVariant).success).toBe(true);
  });

  it("accepts a variant with a full architecture sheet", () => {
    const r = bookOutlineVariantSchema.safeParse({ ...legacyVariant, architecture });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown ending mode", () => {
    const r = narrativeArchitectureSchema.safeParse({
      ...architecture,
      endingMode: "happily_ever_after",
    });
    expect(r.success).toBe(false);
  });

  it("caps human moves at five: select, do not accumulate", () => {
    const r = narrativeArchitectureSchema.safeParse({
      ...architecture,
      humanMoves: ["a", "b", "c", "d", "e", "f"],
    });
    expect(r.success).toBe(false);
  });
});

describe("renderNarrativeArchitecture", () => {
  it("renders Russian labels and values, one decision per line", () => {
    const text = renderNarrativeArchitecture(architecture);
    expect(text).toContain("Тема: подразумевается");
    expect(text).toContain("Финал: частичный");
    expect(text).toContain("Развязку решает: внешняя сила");
    expect(text).toContain("Редкий ход: Антагонист побеждает");
    expect(text).toContain("развязку решает третья сила");
    expect(text).not.toContain("back_loaded");
  });
});

// The selected outline reaches Writer and Reviser as the variant's JSON string;
// both need the sheet in Russian, and neither may break on a legacy or corrupt
// value.
describe("extractNarrativeArchitecture", () => {
  it("returns the parsed sheet from a variant JSON string", () => {
    const json = JSON.stringify({ ...legacyVariant, architecture });
    expect(extractNarrativeArchitecture(json)?.endingMode).toBe("partial");
  });

  it("returns null for a variant without the sheet", () => {
    expect(extractNarrativeArchitecture(JSON.stringify(legacyVariant))).toBeNull();
  });

  it("returns null for an incomplete sheet rather than throwing", () => {
    const json = JSON.stringify({ architecture: { themeHandling: "implied" } });
    expect(extractNarrativeArchitecture(json)).toBeNull();
  });

  it("returns null for non-JSON and for null", () => {
    expect(extractNarrativeArchitecture("просто текст")).toBeNull();
    expect(extractNarrativeArchitecture(null)).toBeNull();
  });
});

describe("outlineChapterSchema", () => {
  it("принимает строку с одним только названием — оглавление автора бывает голым", () => {
    const parsed = outlineChapterSchema.parse({ title: "Глава 1. Порог" });
    expect(parsed.title).toBe("Глава 1. Порог");
    expect(parsed.pov).toBeUndefined();
  });

  it("принимает полную строку", () => {
    const parsed = outlineChapterSchema.parse({
      title: "Порог",
      pov: "Рин",
      goal: "Уйти незамеченной",
      conflict: "Сторож не спит",
      stakes: "Поймают — не выйдет больше никогда",
      hook: "За спиной щёлкает замок",
    });
    expect(parsed.pov).toBe("Рин");
    expect(parsed.hook).toBe("За спиной щёлкает замок");
  });

  it("пустое название отвергается", () => {
    expect(() => outlineChapterSchema.parse({ title: "  " })).toThrow();
  });
});

describe("bookOutlineVariantSchema — вариант из материалов автора", () => {
  it("принимает вариант без синопсиса и арок, но с главами", () => {
    const parsed = bookOutlineVariantSchema.parse({
      label: "из ваших материалов",
      estimatedChapters: 2,
      source: "author_material",
      chapters: [{ title: "Порог" }, { title: "Мост", pov: "Сарек" }],
    });
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.source).toBe("author_material");
    expect(parsed.logline).toBeUndefined();
  });

  it("старый сгенерированный вариант без chapters и source читается как был", () => {
    const parsed = bookOutlineVariantSchema.parse({
      label: "тёмный",
      logline: "Логлайн",
      synopsis: "Синопсис",
      themes: ["предательство"],
      protagonist: "Ратибор",
      antagonist: null,
      setting: "Лес",
      arcs: [{ title: "Арка", summary: "s", keyBeats: ["b"] }],
      estimatedChapters: 12,
    });
    expect(parsed.chapters).toBeUndefined();
    expect(parsed.source).toBeUndefined();
  });
});

describe("renderOutlineChapterIntent", () => {
  it("собирает намерение из заполненных полей и пропускает пустые", () => {
    const text = renderOutlineChapterIntent({
      title: "Порог",
      pov: "Рин",
      goal: "Уйти незамеченной",
      conflict: "Сторож не спит",
    });
    expect(text).toContain("POV: Рин");
    expect(text).toContain("Цель: Уйти незамеченной");
    expect(text).toContain("Конфликт: Сторож не спит");
    expect(text).not.toContain("Ставки:");
    expect(text).not.toContain("Крючок:");
  });

  it("строка с одним названием даёт непустое намерение", () => {
    expect(renderOutlineChapterIntent({ title: "Порог" }).trim().length).toBeGreaterThan(0);
  });
});

describe("chapterBeatSheetVariantSchema — closing", () => {
  const legacyBeatSheet = {
    label: "v1",
    pov: "Ратибор",
    emotionalGoal: "тревога",
    estimatedWords: 4000,
    beats: [
      { index: 0, type: "hook", summary: "s", goal: "g", conflict: "c", outcome: "o" },
      { index: 1, type: "climax", summary: "s", goal: "g", conflict: "c", outcome: "o" },
      { index: 2, type: "resolution", summary: "s", goal: "g", conflict: "c", outcome: "o" },
    ],
  };

  it("still accepts a stored beat-sheet without closing", () => {
    expect(chapterBeatSheetVariantSchema.safeParse(legacyBeatSheet).success).toBe(true);
  });

  it("accepts a closing with mode and note", () => {
    const r = chapterBeatSheetVariantSchema.safeParse({
      ...legacyBeatSheet,
      closing: { mode: "external_act", note: "Дверь закрывается, он не оборачивается." },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown closing mode", () => {
    const r = chapterBeatSheetVariantSchema.safeParse({
      ...legacyBeatSheet,
      closing: { mode: "moral_lesson", note: "n" },
    });
    expect(r.success).toBe(false);
  });

  it("renders the closing in Russian", () => {
    const text = renderChapterClosing({
      mode: "cut_mid_action",
      note: "Обрыв на шаге через порог.",
    });
    expect(text).toContain("обрыв посреди действия");
    expect(text).toContain("Обрыв на шаге через порог.");
  });
});

/**
 * Слайс 4.5: план главы говорит не только «какие сцены», но и «что обязано
 * случиться, чего быть не должно, что раскрывается и какой факт канона глава
 * вправе отменить». Без последнего критик канона блокирует ровно тот поворот,
 * ради которого глава писалась.
 */
describe("контракт главы", () => {
  const beats = [
    { index: 0, type: "hook", summary: "s", goal: "g", conflict: "c", outcome: "o" },
    { index: 1, type: "climax", summary: "s", goal: "g", conflict: "c", outcome: "o" },
    { index: 2, type: "resolution", summary: "s", goal: "g", conflict: "c", outcome: "o" },
  ];
  const legacyBeatSheet = {
    label: "v1",
    pov: "Рин",
    emotionalGoal: "страх",
    estimatedWords: 1200,
    beats,
  };

  it("старый план без контракта читается", () => {
    const r = chapterPlanSchema.safeParse({
      variants: [legacyBeatSheet],
      selectedIndex: 0,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.variants[0]?.contract).toBeUndefined();
  });

  it("контракт принимается вариантом плана", () => {
    const r = chapterBeatSheetVariantSchema.safeParse({
      ...legacyBeatSheet,
      contract: {
        mustHappen: ["Рин находит медальон"],
        mustNotHappen: ["Сарек называет имя убийцы"],
        expectedRevelations: ["Станцию закрывают"],
        allowedCanonSupersessions: [
          { factId: "fact_12", statement: "брат погиб", becomes: "брат жив" },
        ],
      },
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.contract?.mustHappen).toEqual(["Рин находит медальон"]);
  });

  it("пустой контракт не рисует заголовка", () => {
    expect(
      renderChapterContract({
        mustHappen: [],
        mustNotHappen: [],
        expectedRevelations: [],
        allowedCanonSupersessions: [],
      }),
    ).toBeNull();
  });

  it("печатает только непустые списки", () => {
    const out = renderChapterContract({
      mustHappen: ["Рин находит медальон"],
      mustNotHappen: [],
      expectedRevelations: [],
      allowedCanonSupersessions: [
        { factId: "fact_12", statement: "брат погиб", becomes: "брат жив" },
      ],
    })!;
    expect(out).toContain("Контракт главы");
    expect(out).toContain("Рин находит медальон");
    expect(out).toContain("fact_12");
    expect(out).toContain("брат жив");
    // Пустое не печатается: заголовок без строк читается как «ничего не
    // запрещено», тогда как на деле это «не задано».
    expect(out).not.toMatch(/Чего быть не должно/);
    expect(out).not.toMatch(/Что раскрывается/);
  });

  it("отмена без идентификатора печатается формулировкой", () => {
    const out = renderChapterContract({
      mustHappen: [],
      mustNotHappen: [],
      expectedRevelations: [],
      allowedCanonSupersessions: [
        { factId: null, statement: "станция заброшена", becomes: "станция жилая" },
      ],
    })!;
    expect(out).toContain("станция заброшена");
    expect(out).toContain("станция жилая");
    expect(out).not.toContain("null");
  });

  it("отмена без формулировки отвергается, без идентификатора — нет", () => {
    expect(
      canonSupersessionSchema.safeParse({ statement: "", becomes: "x" }).success,
    ).toBe(false);
    const ok = canonSupersessionSchema.safeParse({
      statement: "брат погиб",
      becomes: "брат жив",
    });
    expect(ok.success).toBe(true);
    // Планировщик не всегда видит факт в списке действующих; формулировка
    // обязательна всегда, идентификатор — нет.
    expect(ok.success && ok.data.factId).toBeNull();
  });

  it("идентификатор не в форме fact_<число> отвергается", () => {
    expect(
      canonSupersessionSchema.safeParse({
        factId: "12",
        statement: "s",
        becomes: "b",
      }).success,
    ).toBe(false);
  });
});

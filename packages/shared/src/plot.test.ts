import { describe, it, expect } from "vitest";
import {
  bookOutlineVariantSchema,
  chapterBeatSheetVariantSchema,
  extractNarrativeArchitecture,
  narrativeArchitectureSchema,
  renderNarrativeArchitecture,
  renderChapterClosing,
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

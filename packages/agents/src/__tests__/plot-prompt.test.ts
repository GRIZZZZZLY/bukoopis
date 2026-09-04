import { describe, it, expect } from "vitest";
import {
  bookOutlineToolSchema,
  chapterBeatSheetToolSchema,
  SYSTEM_BOOK_OUTLINE,
  SYSTEM_CHAPTER_PLAN,
} from "../plot.js";

// The stored schemas keep architecture/closing optional so old outline_json
// rows still parse. The agent tool schemas do not: a fresh generation must
// commit to the structural decisions, that is the whole point of asking.

const variant = {
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
};

const architecture = {
  themeHandling: "withheld",
  subplot: "none",
  resolutionDriver: "mixed",
  endingMode: "open",
  timeStructure: "linear",
  revelationPacing: "even",
  emotionMode: "mixed",
  rarityMove: "r",
  humanMoves: ["a", "b", "c"],
};

describe("plot tool schemas", () => {
  it("outline tool output requires the architecture sheet", () => {
    expect(bookOutlineToolSchema.safeParse({ variants: [variant] }).success).toBe(false);
    expect(
      bookOutlineToolSchema.safeParse({ variants: [{ ...variant, architecture }] }).success,
    ).toBe(true);
  });

  it("outline tool output requires at least three human-leaning moves", () => {
    const r = bookOutlineToolSchema.safeParse({
      variants: [{ ...variant, architecture: { ...architecture, humanMoves: ["a"] } }],
    });
    expect(r.success).toBe(false);
  });

  it("beat-sheet tool output requires a closing", () => {
    const beatSheet = {
      label: "v1",
      pov: "p",
      emotionalGoal: "e",
      estimatedWords: 3000,
      beats: [
        { index: 0, type: "hook", summary: "s", goal: "g", conflict: "c", outcome: "o" },
        { index: 1, type: "climax", summary: "s", goal: "g", conflict: "c", outcome: "o" },
        { index: 2, type: "resolution", summary: "s", goal: "g", conflict: "c", outcome: "o" },
      ],
    };
    expect(chapterBeatSheetToolSchema.safeParse({ variants: [beatSheet] }).success).toBe(false);
    expect(
      chapterBeatSheetToolSchema.safeParse({
        variants: [{ ...beatSheet, closing: { mode: "open", note: "n" } }],
      }).success,
    ).toBe(true);
  });
});

describe("plot system prompts — architecture calibration", () => {
  it("outline prompt asks for the architecture sheet with human bands and a 3–5 move budget", () => {
    expect(SYSTEM_BOOK_OUTLINE).toContain("architecture");
    expect(SYSTEM_BOOK_OUTLINE).toMatch(/3[–-]5/);
    expect(SYSTEM_BOOK_OUTLINE).toContain("rarityMove");
    expect(SYSTEM_BOOK_OUTLINE).toMatch(/внутренн\S* принят/i);
  });

  it("chapter plan prompt bans the reflection tail and the acceptance default", () => {
    expect(SYSTEM_CHAPTER_PLAN).toContain("closing");
    expect(SYSTEM_CHAPTER_PLAN).toMatch(/рефлекси/i);
    expect(SYSTEM_CHAPTER_PLAN).toMatch(/внутренн\S* принят/i);
  });
});

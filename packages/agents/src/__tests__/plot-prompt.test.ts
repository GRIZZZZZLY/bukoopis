import { describe, it, expect } from "vitest";
import {
  bookOutlineToolSchema,
  chapterBeatSheetToolSchema,
  SYSTEM_BOOK_OUTLINE,
  SYSTEM_CHAPTER_PLAN,
  buildChapterPlanPrompt,
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

  it("beat-sheet tool output requires a closing and a contract", () => {
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
    // Contract is required on the way out for the same reason closing is: a
    // fresh plan must commit, and «не задано» is indistinguishable from
    // «ничего не запрещено» once it reaches the critics.
    expect(
      chapterBeatSheetToolSchema.safeParse({
        variants: [{ ...beatSheet, closing: { mode: "open", note: "n" } }],
      }).success,
    ).toBe(false);
    expect(
      chapterBeatSheetToolSchema.safeParse({
        variants: [
          {
            ...beatSheet,
            closing: { mode: "open", note: "n" },
            contract: {
              mustHappen: ["Рин находит медальон"],
              mustNotHappen: [],
              expectedRevelations: [],
              allowedCanonSupersessions: [],
            },
            // Регистр диалога обязателен на выходе по той же причине: без
            // него образцы речи героев молча отбираются как нейтральные.
            dialogueRegister: "conflict",
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("контракт главы в промпте планировщика", () => {
  it("объясняет все четыре поля контракта", () => {
    expect(SYSTEM_CHAPTER_PLAN).toMatch(/mustHappen/);
    expect(SYSTEM_CHAPTER_PLAN).toMatch(/mustNotHappen/);
    expect(SYSTEM_CHAPTER_PLAN).toMatch(/expectedRevelations/);
    expect(SYSTEM_CHAPTER_PLAN).toMatch(/allowedCanonSupersessions/);
  });

  it("называет форму ссылки на факт и цену её отсутствия", () => {
    // Без разрешения критик канона блокирует запланированный поворот; модель
    // должна знать, что это единственный способ его разрешить.
    const line = SYSTEM_CHAPTER_PLAN.split("\n").find((l) =>
      l.includes("allowedCanonSupersessions"),
    );
    expect(line).toBeDefined();
    expect(line).toMatch(/fact_/);
    const block = SYSTEM_CHAPTER_PLAN.slice(
      SYSTEM_CHAPTER_PLAN.indexOf("allowedCanonSupersessions"),
    );
    expect(block).toMatch(/критик канона/i);
  });

  it("действующие факты попадают в промпт, когда они переданы", () => {
    const base = {
      bookTitle: "К",
      bookPremise: "П",
      bookOutline: null,
      chapterTitle: "Глава",
      intent: "намерение",
      previousChaptersSummary: null,
    };
    const withFacts = buildChapterPlanPrompt({
      ...base,
      activeFacts: "## Действующие факты\n- fact_12: брат погиб",
    });
    expect(withFacts).toContain("fact_12");
    // Без фактов промпт прежний — старый вызывающий ничего не теряет.
    expect(buildChapterPlanPrompt(base)).not.toContain("Действующие факты");
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

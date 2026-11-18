import { describe, it, expect } from "vitest";
import {
  mostRepeatedPhrase,
  measureChapter,
  judgeLiveRun,
  type LiveMetrics,
} from "../live-metrics.js";

const THIRD = "Он шёл по дороге и думал о доме. Дверь закрылась за ним тихо.";
const FIRST = "Я вышел на дорогу. Мне было холодно. Ветер бил меня в лицо, и я шёл дальше.";

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `слово${i}`).join(" ");
}

describe("mostRepeatedPhrase", () => {
  it("finds a phrase repeated 3 times, case-insensitive", () => {
    const text =
      "Он посмотрел на неё долгим тяжёлым взглядом. Потом ушёл. " +
      "Она посмотрела на него долгим тяжёлым взглядом. Ничего. " +
      "ОН ПОСМОТРЕЛ НА НЕЁ ДОЛГИМ ТЯЖЁЛЫМ взглядом снова. " +
      "Он посмотрел на неё долгим тяжёлым взглядом.";
    expect(mostRepeatedPhrase(text, 6)).toEqual({
      count: 3,
      phrase: "он посмотрел на неё долгим тяжёлым",
    });
  });

  it("short text gives zero", () => {
    expect(mostRepeatedPhrase("Раз два три.", 6)).toEqual({ count: 0, phrase: "" });
  });
});

describe("measureChapter", () => {
  it("per-scene words and person; person kept", () => {
    const m = measureChapter({ scenes: [THIRD, THIRD], previousChapterText: THIRD });
    expect(m.scenes).toEqual([
      { words: 13, person: "third" },
      { words: 13, person: "third" },
    ]);
    expect(m.words).toBe(26);
    expect(m.person).toBe("third");
    expect(m.previousPerson).toBe("third");
    expect(m.personKept).toBe(true);
    expect(m.manner).toMatch(/^Манера: повествование от третьего лица/u);
  });

  it("person not kept after a first-person chapter", () => {
    const m = measureChapter({ scenes: [THIRD], previousChapterText: FIRST });
    expect(m.previousPerson).toBe("first");
    expect(m.personKept).toBe(false);
  });

  it("no previous chapter gives null", () => {
    const m = measureChapter({ scenes: [FIRST], previousChapterText: null });
    expect(m.person).toBe("first");
    expect(m.previousPerson).toBeNull();
    expect(m.personKept).toBeNull();
  });
});

describe("judgeLiveRun", () => {
  function metrics(over: Partial<LiveMetrics> = {}): LiveMetrics {
    return {
      words: 400,
      scenes: [
        { words: 200, person: "third" },
        { words: 200, person: "third" },
      ],
      person: "third",
      previousPerson: "third",
      personKept: true,
      repeat: { count: 2, phrase: "а б в г д е" },
      manner: "Манера: …",
      ...over,
    };
  }

  it("clean run: both lists empty", () => {
    expect(judgeLiveRun({ metrics: metrics(), proposalStatus: "ready", stopReason: "end_turn" })).toEqual({
      failures: [],
      warnings: [],
    });
  });

  it("incomplete status is a failure", () => {
    const r = judgeLiveRun({ metrics: metrics(), proposalStatus: "incomplete", stopReason: "max_tokens" });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("incomplete");
  });

  it("person not kept is a failure", () => {
    const r = judgeLiveRun({
      metrics: metrics({ previousPerson: "first", personKept: false }),
      proposalStatus: "ready",
      stopReason: "end_turn",
    });
    expect(r.failures).toEqual([
      "Лицо повествования сменилось: прошлая глава написана от первого лица, эта от третьего.",
    ]);
  });

  it("repeat of 4 is a warning", () => {
    const r = judgeLiveRun({
      metrics: metrics({ repeat: { count: 4, phrase: "а б в г д е" } }),
      proposalStatus: "ready",
      stopReason: "end_turn",
    });
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual(["Фраза «а б в г д е» повторяется 4 раза."]);
  });

  it("a 100-word scene is a warning", () => {
    const r = judgeLiveRun({
      metrics: metrics({
        scenes: [
          { words: 300, person: "third" },
          { words: 100, person: "third" },
        ],
      }),
      proposalStatus: "ready",
      stopReason: "end_turn",
    });
    expect(r.warnings).toEqual(["Сцена 2 короткая: 100 слов, меньше 150."]);
  });

  it("a scene in another person is a warning", () => {
    const r = judgeLiveRun({
      metrics: metrics({
        scenes: [
          { words: 300, person: "third" },
          { words: 300, person: "first" },
        ],
      }),
      proposalStatus: "ready",
      stopReason: "end_turn",
    });
    expect(r.warnings).toEqual(["Сцена 2 написана от первого лица, глава в целом от третьего."]);
  });

  it("words with digits count once each", () => {
    expect(measureChapter({ scenes: [words(7)], previousChapterText: null }).words).toBe(7);
  });
});

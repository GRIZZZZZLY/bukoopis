import { describe, it, expect } from "vitest";
import type { ChapterBeatSheetVariant } from "@book-forge/shared";
import {
  buildLocalScenePrompt,
  localCastLine,
  localTail,
  planLocalScenes,
} from "../local-writer.js";

function sheet(
  n: number,
  estimatedWords: number,
  closingNote?: string,
): ChapterBeatSheetVariant {
  return {
    label: "A",
    pov: "Лис",
    emotionalGoal: "g",
    estimatedWords,
    beats: Array.from({ length: n }, (_, i) => ({
      index: i,
      type: "rising_action" as const,
      summary: `Бит ${i + 1}.`,
      goal: "g",
      conflict: "c",
      outcome: "o",
    })),
    ...(closingNote ? { closing: { mode: "open" as const, note: closingNote } } : {}),
  };
}
const plan = (beatSheet: ChapterBeatSheetVariant | null, chapterContent: string | null = null) =>
  planLocalScenes({ beatSheet, chapterContent });

describe("buildLocalScenePrompt", () => {
  const scene = { events: ["А.", "Б."], must: "Б.", stop: "Б." };
  it("is byte-exact", () => {
    expect(
      buildLocalScenePrompt({ chapterTitle: "Шрам", manner: "Манера: X", scene, cast: ["Лис — вор"], tail: "конец." }),
    ).toBe(
      "### План главы\nГлава: Шрам\nМанера: X\nСобытия:\n1. А.\n2. Б.\nОбязано произойти: Б.\nОстанавливается на: Б.\n\n### Действующие лица\nЛис — вор\n\n### Конец предыдущей сцены\nконец.\n\n### Текст главы\n",
    );
  });
  it("omits the manner line", () => {
    const p = buildLocalScenePrompt({ chapterTitle: "Шрам", manner: null, scene, cast: [], tail: "—" });
    expect(p).not.toContain("Манера:");
    expect(p).toContain("Глава: Шрам\nСобытия:");
  });
});

describe("planLocalScenes", () => {
  // Порог плотности: не больше сцен, чем по 7 событий на сцену.
  it("density floor caps scene count", () => {
    expect(plan(sheet(14, 4000)).map((s) => s.events.length)).toEqual([7, 7]);
    expect(plan(sheet(7, 4000)).map((s) => s.events.length)).toEqual([7]);
    expect(plan(sheet(3, 4000)).map((s) => s.events.length)).toEqual([3]);
  });
  it("enough beats: scene count from estimatedWords", () => {
    expect(plan(sheet(49, 4000)).map((s) => s.events.length)).toEqual([7, 7, 7, 7, 7, 7, 7]);
  });
  it("uneven split", () => {
    expect(plan(sheet(16, 4000)).map((s) => s.events.length)).toEqual([6, 5, 5]);
  });
  it("closing note stops the last scene", () => {
    const s = plan(sheet(14, 1200, "Дверь закрылась."));
    expect(s).toHaveLength(2);
    expect(s[1]!.stop).toBe("Дверь закрылась.");
    expect(s[1]!.must).toBe("Бит 14.");
    expect(s[0]!.stop).toBe("Бит 7.");
  });
  it("thin content without beats gives one scene", () => {
    const s = plan(null, "Раз. Два. Три. Четыре.");
    expect(s).toHaveLength(1);
    expect(s[0]!.events).toEqual(["Раз.", "Два.", "Три.", "Четыре."]);
  });
  it("nothing at all", () => {
    expect(plan(null, null)).toEqual([
      { events: ["Продолжение главы"], must: "Продолжение главы", stop: "Продолжение главы" },
    ]);
  });
});

describe("localTail", () => {
  it("cuts to 600 and drops up to first '. '", () => {
    const text = "а".repeat(500) + ". Конец. " + "б".repeat(491);
    expect(text).toHaveLength(1000);
    const cut = text.slice(-600);
    expect(localTail(text)).toBe(cut.slice(cut.indexOf(". ") + 2));
  });
  it("keeps short text", () => {
    expect(localTail("  " + "а".repeat(300) + " ")).toBe("а".repeat(300));
  });
  it("empty is a dash", () => {
    expect(localTail(null)).toBe("—");
    expect(localTail("")).toBe("—");
  });
});

describe("localCastLine", () => {
  it("role, description fallback, bare name", () => {
    expect(localCastLine({ name: "Лис", role: "вор", description: "Тень." })).toBe("Лис — вор");
    expect(localCastLine({ name: "Лис", role: " ", description: "Тень. Хитрый." })).toBe("Лис — Тень.");
    expect(localCastLine({ name: "Лис", role: null, description: null })).toBe("Лис");
  });
});

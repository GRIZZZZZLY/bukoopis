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
  it("scene count from estimatedWords", () => {
    expect(plan(sheet(7, 4000)).map((s) => s.events.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(plan(sheet(14, 4000)).map((s) => s.events.length)).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });
  it("fewer beats than scenes", () => {
    const s = plan(sheet(3, 4000));
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.events.length > 0)).toBe(true);
  });
  it("uneven split", () => {
    expect(plan(sheet(8, 1800)).map((s) => s.events.length)).toEqual([3, 3, 2]);
  });
  it("closing note stops the last scene", () => {
    const s = plan(sheet(6, 1200, "Дверь закрылась."));
    expect(s[1]!.stop).toBe("Дверь закрылась.");
    expect(s[1]!.must).toBe("Бит 6.");
    expect(s[0]!.stop).toBe("Бит 3.");
  });
  it("content without beats", () => {
    const content = Array.from({ length: 10 }, (_, i) => `Фраза ${i + 1}.`).join(" ");
    const s = plan(null, content);
    expect(s).toHaveLength(5);
    expect(s.every((x) => x.events.length === 2)).toBe(true);
  });
  it("nothing at all", () => {
    const s = plan(null, null);
    expect(s).toHaveLength(5);
    expect(s.every((x) => x.events.length === 1 && x.events[0] === "Продолжение главы")).toBe(true);
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

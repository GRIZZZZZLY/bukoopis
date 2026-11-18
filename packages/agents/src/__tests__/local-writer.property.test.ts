// Property tests of the local Writer planner: seeded random inputs, 500 cases per property.
// A failure message carries the seed and the case number; rerun with the same seed to reproduce.
import { describe, expect, it } from "vitest";
import type { ChapterBeatSheetVariant } from "@book-forge/shared";
import {
  buildLocalScenePrompt,
  localTail,
  planLocalScenes,
  type LocalScene,
} from "../local-writer.js";

const SEED = 20261118;
const CASES = 500;

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

interface Input {
  beatSheet: ChapterBeatSheetVariant | null;
  chapterContent: string | null;
  items: string[];
}

function genInput(r: () => number): Input {
  const nBeats = int(r, 0, 40);
  const summaries = Array.from({ length: nBeats }, (_, i) => `Бит ${i + 1}.`);
  const ew = [undefined, 0, int(r, 200, 12000)][int(r, 0, 2)];
  const note = r() < 0.5 ? ["Дверь закрылась.", "  Конец главы.  ", "   "][int(r, 0, 2)] : undefined;
  const beatSheet: ChapterBeatSheetVariant | null =
    r() < 0.1 && nBeats === 0
      ? null
      : {
          label: "A",
          pov: "Лис",
          emotionalGoal: "g",
          // estimatedWords is required by the type but absent in old stored rows; the planner defaults it.
          ...(ew !== undefined ? { estimatedWords: ew } : {}),
          beats: summaries.map((summary, index) => ({
            index,
            type: "rising_action" as const,
            summary,
            goal: "g",
            conflict: "c",
            outcome: "o",
          })),
          ...(note !== undefined ? { closing: { mode: "open" as const, note } } : {}),
        } as ChapterBeatSheetVariant;
  const sentences = Array.from({ length: int(r, 0, 40) }, (_, i) => `Фраза ${i + 1}.`);
  const chapterContent = r() < 0.1 ? null : sentences.join(" ");
  const items = nBeats > 0 ? summaries : chapterContent === null ? [] : sentences;
  return { beatSheet, chapterContent, items };
}

function forAll(name: string, check: (r: () => number, tag: string) => void) {
  it(name, () => {
    const r = mulberry32(SEED);
    for (let n = 0; n < CASES; n++) check(r, `seed ${SEED}, case ${n}`);
  });
}

const plan = (i: Input): LocalScene[] =>
  planLocalScenes({ beatSheet: i.beatSheet, chapterContent: i.chapterContent });

describe("planLocalScenes properties", () => {
  forAll("P1 nothing lost", (r, tag) => {
    const i = genInput(r);
    const got = plan(i).flatMap((s) => s.events);
    const want = i.items.length ? i.items : ["Продолжение главы"];
    expect(got, tag).toEqual(want);
  });

  forAll("P2 scene count", (r, tag) => {
    const i = genInput(r);
    const target = i.beatSheet?.estimatedWords ?? 3000;
    const want = Math.max(1, Math.min(Math.ceil(target / 600), Math.ceil(i.items.length / 7)));
    expect(plan(i).length, tag).toBe(want);
  });

  forAll("P3 even split", (r, tag) => {
    const i = genInput(r);
    const sizes = plan(i).map((s) => s.events.length);
    for (let k = 1; k < sizes.length; k++) expect(sizes[k]!, tag).toBeLessThanOrEqual(sizes[k - 1]!);
    expect(Math.max(...sizes) - Math.min(...sizes), tag).toBeLessThanOrEqual(1);
  });

  forAll("P4 obligations", (r, tag) => {
    const i = genInput(r);
    const scenes = plan(i);
    const note = i.beatSheet?.closing?.note?.trim();
    scenes.forEach((s, k) => {
      expect(s.events.length, tag).toBeGreaterThanOrEqual(1);
      const last = s.events[s.events.length - 1];
      expect(s.must, tag).toBe(last);
      expect(s.stop, tag).toBe(k === scenes.length - 1 && note ? note : last);
    });
  });
});

describe("buildLocalScenePrompt properties", () => {
  const HEADERS = ["### План главы\n", "### Действующие лица\n", "### Конец предыдущей сцены\n", "### Текст главы\n"];
  forAll("P5 prompt shape", (r, tag) => {
    const i = genInput(r);
    const manner = r() < 0.5 ? "Манера: X" : null;
    for (const scene of plan(i)) {
      const p = buildLocalScenePrompt({
        chapterTitle: "Шрам",
        manner,
        scene,
        cast: ["Лис — вор"],
        tail: "конец.",
      });
      expect(p.startsWith(HEADERS[0]!), tag).toBe(true);
      expect(p.endsWith(HEADERS[3]!), tag).toBe(true);
      for (const h of HEADERS) expect(p.split(h).length - 1, tag).toBe(1);
      const block = p.split("События:\n")[1]!.split("Обязано произойти:")[0]!;
      const nums = block.trimEnd().split("\n").map((l) => Number(l.split(". ")[0]));
      expect(nums, tag).toEqual(scene.events.map((_, k) => k + 1));
      expect(p.includes("Манера:"), tag).toBe(manner !== null);
    }
  });
});

describe("localTail properties", () => {
  forAll("P6 tail", (r, tag) => {
    const k = r();
    const text =
      k < 0.1
        ? null
        : k < 0.2
          ? " ".repeat(int(r, 0, 5))
          : (() => {
              let s = "";
              const goal = int(r, 1, 3000);
              while (s.length < goal) s += `Фраза ${int(r, 1, 999)}. `;
              return (r() < 0.5 ? " \n" : "") + s.slice(0, goal) + (r() < 0.5 ? " " : "");
            })();
    const t = (text ?? "").trim();
    const out = localTail(text);
    expect(out.length, tag).toBeLessThanOrEqual(600);
    expect(out === "—", tag).toBe(t === "");
    if (t.length > 0 && t.length <= 600) expect(out, tag).toBe(t);
    if (t.length > 600) expect(t.endsWith(out), tag).toBe(true);
  });
});

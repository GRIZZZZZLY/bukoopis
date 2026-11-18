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
  mode: number;
}

const MODES = ["beats", "content only", "empty", "null sheet"];
const ENDINGS = [".", "!", "?", "…"];

function sheetOf(r: () => number, summaries: string[]): ChapterBeatSheetVariant {
  const ew = [undefined, 0, int(r, 200, 12000)][int(r, 0, 2)];
  const note = r() < 0.5 ? ["Дверь закрылась.", "  Конец главы.  ", "   "][int(r, 0, 2)] : undefined;
  return {
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
}

/** Sentences with varied endings, joined by one or two spaces; the list is the oracle for the split. */
function genSentences(r: () => number, n: number): { text: string; list: string[] } {
  const list = Array.from({ length: n }, (_, i) => `Фраза ${i + 1}${ENDINGS[int(r, 0, 3)]}`);
  return { text: list.map((s, i) => (i === 0 ? s : (r() < 0.3 ? "  " : " ") + s)).join(""), list };
}

// The mode is chosen explicitly, so each path gets about a quarter of the cases.
function genInput(r: () => number): Input {
  const mode = int(r, 0, 3);
  if (mode === 0) {
    const summaries = Array.from({ length: int(r, 1, 40) }, (_, i) => `Бит ${i + 1}.`);
    const c = r() < 0.5 ? genSentences(r, int(r, 0, 5)).text : null;
    return { beatSheet: sheetOf(r, summaries), chapterContent: c, items: summaries, mode };
  }
  if (mode === 1) {
    const c = genSentences(r, int(r, 1, 40));
    return { beatSheet: sheetOf(r, []), chapterContent: c.text, items: c.list, mode };
  }
  if (mode === 2) {
    const content = [null, "", "   "][int(r, 0, 2)] ?? null;
    return { beatSheet: sheetOf(r, []), chapterContent: content, items: [], mode };
  }
  const c = genSentences(r, int(r, 0, 40));
  return { beatSheet: null, chapterContent: c.text, items: c.list, mode };
}

/** check may return the mode of its case; then every mode must occur at least 50 times. */
function forAll(name: string, check: (r: () => number, tag: string) => number | void) {
  it(name, () => {
    const r = mulberry32(SEED);
    const seen = [0, 0, 0, 0];
    for (let n = 0; n < CASES; n++) {
      const m = check(r, `seed ${SEED}, case ${n}`);
      if (m !== undefined) seen[m]!++;
    }
    if (seen.some((x) => x > 0)) {
      seen.forEach((x, m) => expect(x, `mode "${MODES[m]}" seen ${x} times, counts ${seen}`).toBeGreaterThanOrEqual(50));
    }
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
    return i.mode;
  });

  forAll("P2 scene count", (r, tag) => {
    const i = genInput(r);
    const target = i.beatSheet?.estimatedWords ?? 3000;
    const want = Math.max(1, Math.min(Math.ceil(target / 600), Math.ceil(i.items.length / 7)));
    expect(plan(i).length, tag).toBe(want);
    return i.mode;
  });

  forAll("P3 even split", (r, tag) => {
    const i = genInput(r);
    const sizes = plan(i).map((s) => s.events.length);
    for (let k = 1; k < sizes.length; k++) expect(sizes[k]!, tag).toBeLessThanOrEqual(sizes[k - 1]!);
    expect(Math.max(...sizes) - Math.min(...sizes), tag).toBeLessThanOrEqual(1);
    return i.mode;
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
    return i.mode;
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
    return i.mode;
  });
});

describe("localTail properties", () => {
  const kinds = { null: 0, blank: 0, short: 0, longBoundary: 0, longNoBoundary: 0 };
  forAll("P6 tail", (r, tag) => {
    const k = r();
    const words = () => `слово${int(r, 1, 999)} `;
    const fill = (unit: () => string, goal: number) => {
      let s = "";
      while (s.length < goal) s += unit();
      return s.slice(0, goal);
    };
    const pad = (s: string) => (r() < 0.5 ? " \n" : "") + s + (r() < 0.5 ? " " : "");
    const text =
      k < 0.1
        ? null
        : k < 0.2
          ? " ".repeat(int(r, 0, 5))
          : k < 0.45
            ? pad(fill(() => `Фраза ${int(r, 1, 999)}. `, int(r, 1, 600)))
            : k < 0.75
              ? pad(fill(() => `Фраза ${int(r, 1, 999)}. `, int(r, 601, 3000)))
              : pad(fill(words, int(r, 601, 3000))); // no full stop at all
    const t = (text ?? "").trim();
    const out = localTail(text);
    expect(out.length, tag).toBeLessThanOrEqual(600);
    expect(out === "—", tag).toBe(t === "");
    if (t === "") {
      kinds[text === null ? "null" : "blank"]++;
      return;
    }
    expect(out, tag).not.toBe("");
    expect(out, tag).not.toBe("—");
    if (t.length <= 600) {
      expect(out, tag).toBe(t);
      kinds.short++;
      return;
    }
    expect(t.endsWith(out), tag).toBe(true);
    const cut = t.slice(-600);
    const b = cut.indexOf(". ");
    if (b === -1) {
      expect(out, tag).toBe(cut.trim());
      kinds.longNoBoundary++;
    } else {
      // The result starts right after the space of a ". " boundary.
      const before = t.slice(0, t.length - out.length);
      expect(before.endsWith(". "), tag).toBe(true);
      kinds.longBoundary++;
    }
  });
  it("P6 covered every input kind", () => {
    for (const [name, n] of Object.entries(kinds)) expect(n, `${name}: ${JSON.stringify(kinds)}`).toBeGreaterThanOrEqual(50);
  });
});

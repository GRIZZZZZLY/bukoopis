import { describe, it, expect } from "vitest";
import {
  composeDensity,
  computeDialogueShare,
  computeSentenceLengths,
  countWords,
  splitSentences,
} from "../metrics.js";

describe("splitSentences / countWords", () => {
  it("splits on terminal punctuation and counts words", () => {
    const s = splitSentences("Он ушёл. Она осталась! Почему?");
    expect(s).toHaveLength(3);
    expect(countWords("Он ушёл")).toBe(2);
  });

  it("treats a hyphenated word as one word", () => {
    expect(countWords("что-то произошло")).toBe(2);
  });

  it("ignores punctuation-only fragments", () => {
    expect(splitSentences("...\n\n   \n")).toHaveLength(0);
  });
});

describe("computeSentenceLengths", () => {
  it("measures mean, median and the length buckets", () => {
    // 3 words, 3 words, 25 words.
    const long = Array.from({ length: 25 }, (_, i) => `сл${i}`).join(" ");
    const d = computeSentenceLengths([`Он тихо ушёл. Она молча осталась. ${long}.`]);

    expect(d.meanWords).toBeCloseTo(31 / 3, 1);
    expect(d.medianWords).toBe(3);
    expect(d.shortShare).toBeCloseTo(2 / 3, 2);
    expect(d.longShare).toBeCloseTo(1 / 3, 2);
    expect(d.shortShare + d.mediumShare + d.longShare).toBeCloseTo(1, 2);
  });

  it("returns zeros for an empty corpus rather than NaN", () => {
    const d = computeSentenceLengths([]);
    expect(d.meanWords).toBe(0);
    expect(d.medianWords).toBe(0);
    expect(d.shortShare).toBe(0);
  });
});

describe("computeDialogueShare", () => {
  it("counts a dash-opened line as direct speech, attribution included", () => {
    // 3 words on the dialogue line, 6 in the narration that follows.
    const share = computeDialogueShare([
      "— Уходи, — сказал он.\nОна не двинулась с места вовсе.",
    ]);
    expect(share).toBeCloseTo(1 / 3, 2);
  });

  it("scales with how much of the scene is spoken", () => {
    const mostlyDialogue = computeDialogueShare([
      "— Уходи, — сказал он.\n— Не уйду, — ответила она.\nОн молчал.",
    ]);
    expect(mostlyDialogue).toBeGreaterThan(0.7);
  });

  it("does not count a quoted word inside narration", () => {
    const share = computeDialogueShare([
      'Корабль назывался «Вестник» и стоял в гавани уже третью неделю подряд.',
    ]);
    expect(share).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(computeDialogueShare([])).toBe(0);
  });
});

describe("composeDensity", () => {
  it("rescales the narrative mix into the non-dialogue remainder", () => {
    const d = composeDensity(0.4, {
      description: 0.5,
      action: 0.3,
      introspection: 0.2,
    });
    expect(d.dialogue).toBe(0.4);
    expect(d.description).toBeCloseTo(0.3, 2);
    expect(d.action).toBeCloseTo(0.18, 2);
    expect(d.introspection).toBeCloseTo(0.12, 2);
    expect(
      d.dialogue + d.description + d.action + d.introspection,
    ).toBeCloseTo(1, 2);
  });

  it("normalises a mix that does not sum to 1", () => {
    const d = composeDensity(0, { description: 2, action: 1, introspection: 1 });
    expect(d.description).toBeCloseTo(0.5, 2);
    expect(
      d.dialogue + d.description + d.action + d.introspection,
    ).toBeCloseTo(1, 2);
  });

  it("falls back to description when the model returns an all-zero mix", () => {
    const d = composeDensity(0.2, {
      description: 0,
      action: 0,
      introspection: 0,
    });
    expect(d.description).toBeCloseTo(0.8, 2);
  });
});

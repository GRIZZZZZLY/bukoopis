// Parity of mannerLine with the Python original (manner_line in the fine-tune workspace).
// manner-parity.json holds 200 {text, expected} pairs: expected was produced once by the
// Python original from seeded synthetic texts. The Python output is the oracle, because the
// fine-tuned model was trained on exactly that line. Regenerating the fixture needs the
// fine-tune workspace; do not edit it by hand.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mannerLine } from "../manner.js";

interface Case {
  text: string;
  expected: string;
}

const cases = JSON.parse(
  readFileSync(new URL("./fixtures/manner-parity.json", import.meta.url), "utf8"),
) as Case[];

describe("mannerLine parity with the Python original", () => {
  it("fixture is large and covers every kind", () => {
    expect(cases.length).toBeGreaterThanOrEqual(150);
    const has = (f: (e: string) => boolean) => cases.some((c) => f(c.expected));
    expect(has((e) => e.includes("от первого лица"))).toBe(true);
    expect(has((e) => e.includes("от третьего лица"))).toBe(true);
    expect(has((e) => e.includes("реплика в среднем"))).toBe(true);
    expect(has((e) => !e.includes("реплика в среднем"))).toBe(true);
  });

  it("every case equals the oracle", () => {
    cases.forEach((c, i) => {
      expect(mannerLine(c.text), `case ${i}: ${c.text.slice(0, 60)}`).toBe(c.expected);
    });
  });
});

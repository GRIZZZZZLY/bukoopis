import { describe, it, expect } from "vitest";
import { splitIntakeFile, splitIntakeText } from "../intake-split.js";

describe("splitIntakeText", () => {
  it("leaves a text within the limit as one piece", () => {
    expect(splitIntakeText("а\nб\nв", 100)).toEqual(["а\nб\nв"]);
  });

  it("cuts on line boundaries and keeps every piece within the limit", () => {
    const line = "я".repeat(30);
    const content = Array.from({ length: 10 }, () => line).join("\n");
    const parts = splitIntakeText(content, 100);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    // Ничего не потеряно и не переставлено.
    expect(parts.join("\n")).toBe(content);
  });

  it("hard-cuts a single line that is longer than the limit", () => {
    const parts = splitIntakeText("я".repeat(250), 100);
    expect(parts.map((p) => p.length)).toEqual([100, 100, 50]);
  });

  it("does not swallow a text that is all blank lines", () => {
    const content = "\n".repeat(50);
    expect(splitIntakeText(content, 10)).toEqual([content]);
  });
});

describe("splitIntakeFile", () => {
  it("keeps the original filename when the file fits", () => {
    expect(splitIntakeFile({ filename: "а.md", content: "текст" }, 100)).toEqual([
      { filename: "а.md", content: "текст" },
    ]);
  });

  it("names each part so progress, failures and resume speak of that part", () => {
    const content = Array.from({ length: 6 }, () => "я".repeat(30)).join("\n");
    const units = splitIntakeFile({ filename: "библия.docx", content }, 100);
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.filename)).toEqual([
      "библия.docx (часть 1 из 2)",
      "библия.docx (часть 2 из 2)",
    ]);
    expect(units.map((u) => u.content).join("\n")).toBe(content);
  });
});

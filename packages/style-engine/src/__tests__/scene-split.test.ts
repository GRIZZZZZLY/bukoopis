import { describe, it, expect } from "vitest";
import { capByParagraphs, splitIntoScenes, MAX_SCENE_CHARS } from "../parsers.js";

/** Шаг 2 правки прозы 2026-09-23: fb2 склеивает абзацы одной пустой строкой,
 *  и глава на 40 000 символов становилась одной «сценой». */
const para = (i: number) => `Абзац ${i}: ` + "слово ".repeat(60).trim() + ".";

describe("splitIntoScenes — длинная глава", () => {
  it("режет главу без разделителей на куски не длиннее предела, по абзацам", () => {
    const chapter = (n: number) => [`Глава ${n}`, ...Array.from({ length: 120 }, (_, i) => para(i))].join("\n\n");
    const scenes = splitIntoScenes([chapter(1), chapter(2)].join("\n\n"));
    expect(scenes.length).toBeGreaterThan(4);
    for (const s of scenes) {
      expect(s.length).toBeLessThanOrEqual(MAX_SCENE_CHARS + 500);
      expect(s.trim().endsWith(".")).toBe(true);
    }
  });

  it("понимает разделитель «* * *»", () => {
    const text = ["Глава 1", para(1), para(2), para(3), para(4), "* * *", para(5), para(6), para(7), para(8), "Глава 2", para(9), para(10), para(11), para(12)].join("\n\n");
    expect(splitIntoScenes(text).length).toBeGreaterThanOrEqual(3);
  });
});

describe("capByParagraphs", () => {
  it("не трогает короткий текст", () => {
    expect(capByParagraphs("коротко", 100)).toEqual(["коротко"]);
  });
  it("не режет абзац посреди фразы", () => {
    const text = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");
    for (const piece of capByParagraphs(text, 2000)) {
      expect(piece.startsWith("Абзац")).toBe(true);
    }
  });
});

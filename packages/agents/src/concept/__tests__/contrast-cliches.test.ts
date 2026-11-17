import { describe, it, expect } from "vitest";
import { findContrastClichés } from "../contrast-cliches.js";

describe("findContrastClichés", () => {
  it.each([
    ["Это настоящий поворот, а не просто закрытие арки.", "настоящий поворот, а не просто закрытие арки"],
    ["Он крадёт не из амбиций, а из необходимости.", "не из амбиций, а из необходимости"],
    ["Он боится остаться одиночкой без будущего, а не тем, кем мог стать.", "одиночкой без будущего, а не тем"],
    ["Кинжал для неё не трофей, а инструмент.", "не трофей, а инструмент"],
  ])("finds the contrast in «%s»", (text, fragment) => {
    const found = findContrastClichés(text);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(fragment);
  });

  it.each([
    "Он не пришёл. А потом пришла она.",
    "Это не важно, сказал он.",
    "Она ушла, а он остался.",
    "Нейла ведёт караван, а Ормо считает воду.",
    "",
  ])("plain sentence «%s» does not match", (text) => {
    expect(findContrastClichés(text)).toEqual([]);
  });

  it("«не» inside a word is not «не»", () => {
    expect(findContrastClichés("Нейла молчит, а караван идёт.")).toEqual([]);
  });

  it("finds every fragment in a longer text", () => {
    const text =
      "Вор крадёт не из амбиций, а из необходимости. Финал — настоящий поворот, а не закрытие сюжета.";
    expect(findContrastClichés(text)).toHaveLength(2);
  });
});

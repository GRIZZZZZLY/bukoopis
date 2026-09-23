import { describe, it, expect } from "vitest";
import { STYLE_EXTRACTOR_SYSTEM } from "../extractor.js";

/** Второй разбор прозы 2026-09-23: образец «инверсия в начале каждого 3-4-го»
 *  превращал авторский приём в механическую периодичность. */
describe("STYLE_EXTRACTOR_SYSTEM", () => {
  it("describes when and why a device is used, not how often", () => {
    expect(STYLE_EXTRACTOR_SYSTEM).toMatch(/КОГДА и ЗАЧЕМ/);
    expect(STYLE_EXTRACTOR_SYSTEM).not.toMatch(/3-4-го/);
  });

  it("allows a short list when the corpus is small", () => {
    expect(STYLE_EXTRACTOR_SYSTEM).toMatch(/короткий список наблюдений лучше длинного/);
  });
});

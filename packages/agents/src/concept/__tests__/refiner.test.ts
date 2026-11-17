import { describe, it, expect } from "vitest";
import { renderClicheRule } from "@book-forge/shared";
import { CONCEPT_REFINER_SYSTEM, FIELD_INSTRUCTIONS } from "../refiner.js";

describe("CONCEPT_REFINER_SYSTEM", () => {
  it("carries the shared cliche rule and the plain-language rule", () => {
    expect(CONCEPT_REFINER_SYSTEM).toContain(renderClicheRule());
    expect(CONCEPT_REFINER_SYSTEM).toContain("рабочая записка редактора");
  });

  it("does not use the «не X, а Y» pattern itself", () => {
    expect(CONCEPT_REFINER_SYSTEM).not.toContain("Не один правильный ответ");
  });

  it("does not force the «Когда» logline template or the contrast in stakes", () => {
    expect(FIELD_INSTRUCTIONS.logline).not.toContain("Когда");
    expect(FIELD_INSTRUCTIONS.stakes).not.toContain("а не абстрактными");
  });
});

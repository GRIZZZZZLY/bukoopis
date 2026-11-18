import { describe, it, expect } from "vitest";
import { z } from "zod";
import { pitchDraftSchema } from "../concept/pitches.js";
import { bookOutlineToolSchema } from "../plot.js";

// Метку «локальная» ставит сервер; модель её не видит и не пишет.
describe("generatedBy не попадает в тулсхемы моделей", () => {
  it("питч (генератор и блендер)", () => {
    expect(JSON.stringify(z.toJSONSchema(pitchDraftSchema))).not.toContain("generatedBy");
  });
  it("вариант плана", () => {
    expect(JSON.stringify(z.toJSONSchema(bookOutlineToolSchema))).not.toContain("generatedBy");
  });
});

import { describe, it, expect } from "vitest";
import { renderClicheRule } from "@book-forge/shared";
import { getAgentContract, type AgentStructuredContract } from "@book-forge/llm";
import type { BookConcept } from "@book-forge/shared";
import {
  CONCEPT_REFINER_SYSTEM,
  FIELD_INSTRUCTIONS,
  registerConceptRefinerContract,
  type ConceptRefinerInput,
} from "../refiner.js";

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

describe("variant count is stated once", () => {
  registerConceptRefinerContract();
  const contract = getAgentContract("concept_refiner") as AgentStructuredContract<
    ConceptRefinerInput,
    unknown
  >;

  it("the system prompt keeps «ровно 2 или 3 варианта»", () => {
    expect(CONCEPT_REFINER_SYSTEM).toContain("ровно 2 или 3 варианта");
  });

  it("the user message and the tool description carry no number", () => {
    const prompt = contract.buildPrompt({
      field: "stakes",
      concept: { genre: null, tone: null, audience: "adult" } as unknown as BookConcept,
      accumulated: {},
    });
    expect(prompt).not.toMatch(/2[–-]3/u);
    expect(contract.mcp?.toolDescription).not.toMatch(/\d/u);
  });
});

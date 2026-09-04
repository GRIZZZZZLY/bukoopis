import { describe, it, expect } from "vitest";
import {
  findConceptInvariantViolations,
  assertConceptInvariants,
} from "./concept-invariants.js";
import { emptyBookConcept } from "./concept.js";

describe("concept-invariants", () => {
  it("an unlocked concept without a logline has no violations — that is the ordinary state of a book being drafted", () => {
    const concept = { ...emptyBookConcept(), premise: {} };
    expect(findConceptInvariantViolations(concept)).toEqual([]);
    expect(() => assertConceptInvariants(concept)).not.toThrow();
  });

  it("a locked concept without a logline is a violation", () => {
    const concept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: {},
    };
    const violations = findConceptInvariantViolations(concept);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("locked_without_logline");
    expect(() => assertConceptInvariants(concept)).toThrow(/Concept invariant violations/);
  });

  it("a locked concept with a blank/whitespace-only logline is still a violation", () => {
    const concept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "   " },
    };
    expect(findConceptInvariantViolations(concept)).toHaveLength(1);
  });

  it("a locked concept with a non-empty logline has no violations", () => {
    const concept = {
      ...emptyBookConcept(),
      lockedAt: "2026-09-04T10:00:00.000Z",
      premise: { logline: "Картограф ищет остров, которого нет." },
    };
    expect(findConceptInvariantViolations(concept)).toEqual([]);
    expect(() => assertConceptInvariants(concept)).not.toThrow();
  });
});

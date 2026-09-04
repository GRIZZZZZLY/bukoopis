import type { BookConcept } from "./concept.js";

export interface ConceptInvariantViolation {
  code: "locked_without_logline";
  message: string;
}

/** A locked concept ("Замысел утверждён") without a logline is the exact
 *  half-finished state this phase set out to remove: the stage reads as
 *  complete and the recommender walks on, but there is nothing to write from.
 *  PATCH /concept accepts any well-formed body (ConceptCard saves edits to a
 *  locked concept through it), so this has to be checked after normalization,
 *  not just at the /concept/lock route that first sets lockedAt. */
export function findConceptInvariantViolations(
  concept: BookConcept,
): ConceptInvariantViolation[] {
  const out: ConceptInvariantViolation[] = [];
  const locked = typeof concept.lockedAt === "string" && concept.lockedAt.length > 0;
  const hasLogline = (concept.premise.logline ?? "").trim().length > 0;
  if (locked && !hasLogline) {
    out.push({
      code: "locked_without_logline",
      message: "concept is locked (lockedAt set) but premise.logline is empty",
    });
  }
  return out;
}

export function assertConceptInvariants(concept: BookConcept): void {
  const v = findConceptInvariantViolations(concept);
  if (v.length > 0) {
    const msg = v.map((x) => `[${x.code}] ${x.message}`).join("\n");
    throw new Error(`Concept invariant violations:\n${msg}`);
  }
}

import { createHash } from "node:crypto";
import type { BookConcept, ContextRef, StageId } from "@book-forge/shared";

interface BuildContextRefInput {
  stageId: StageId;
  concept: BookConcept;
  accumulated: Array<{
    id: string;
    name: string;
    finalPayload: string;
  }>;
  /** Extra metadata (e.g. parentVariantId for refine, draft for variants). */
  extra?: Record<string, unknown>;
}

export function buildContextRef(input: BuildContextRefInput): ContextRef {
  const conceptHash = createHash("sha256")
    .update(JSON.stringify(input.concept))
    .digest("hex")
    .slice(0, 16);
  const canonical = JSON.stringify({
    stageId: input.stageId,
    conceptHash,
    accumulated: input.accumulated.map((a) => ({
      id: a.id,
      name: a.name,
      payloadHash: createHash("sha256")
        .update(a.finalPayload)
        .digest("hex")
        .slice(0, 16),
    })),
    extra: input.extra ?? {},
  });
  const hash = createHash("sha256").update(canonical).digest("hex");
  const summary = `stage=${input.stageId} concept=${conceptHash} acc=${input.accumulated.length}`;
  return {
    hash,
    summary,
    includedAspectIds: input.accumulated.map((a) => a.id),
    includedEntityIds: [],
  };
}

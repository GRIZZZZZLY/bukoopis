import type { AspectVariant } from "@book-forge/shared";
import type { GenerateInput, VariantGenerator } from "./types.js";

/** Deterministic mock generator for C1 tests + dev. Returns 2 canned variants
 *  whose payload incorporates the aspect name + accumulated context summary,
 *  so tests can verify the generator was called with the right input. */
export function createMockMarkdownGenerator(): VariantGenerator<string> {
  return {
    async generate(input: GenerateInput<string>): Promise<AspectVariant[]> {
      const accSummary = input.accumulated.acceptedAspects
        .map((a) => a.name)
        .join(",");
      const accLabel = accSummary ? ` (accumulated: ${accSummary})` : "";
      const refineNote = input.refineFrom
        ? ` (refined from ${input.refineFrom.variantId}: ${input.refineFrom.instructions})`
        : "";
      const draftNote = input.draft ? ` (draft: ${input.draft})` : "";
      const aspect = input.aspect;
      const now = new Date().toISOString();
      return [
        {
          id: crypto.randomUUID(),
          label: "первый",
          payloadKind: "markdown",
          payload: `Variant 1 for ${aspect.name}${accLabel}${refineNote}${draftNote}`,
          status: "generated",
          editSource: input.refineFrom ? "refine" : "llm",
          generatedAt: now,
          ...(input.refineFrom !== undefined
            ? { parentVariantId: input.refineFrom.variantId }
            : {}),
        },
        {
          id: crypto.randomUUID(),
          label: "второй",
          payloadKind: "markdown",
          payload: `Variant 2 for ${aspect.name}${accLabel}${refineNote}${draftNote}`,
          status: "generated",
          editSource: input.refineFrom ? "refine" : "llm",
          generatedAt: now,
          ...(input.refineFrom !== undefined
            ? { parentVariantId: input.refineFrom.variantId }
            : {}),
        },
      ];
    },
  };
}

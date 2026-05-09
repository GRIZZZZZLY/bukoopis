import type { AspectVariant, EntitySetPayload, StageId } from "@book-forge/shared";
import { api } from "@/api/client";
import type {
  GenerateInput,
  VariantGenerator,
} from "./types.js";

/** LLM-backed VariantGenerator for markdown stages (world/lore). Wraps the
 *  POST /generate endpoint and translates the response into AspectVariant[]. */
export function createLLMMarkdownVariantGenerator(args: {
  bookId: number;
  stageId: StageId;
}): VariantGenerator<string> {
  return {
    async generate(input: GenerateInput<string>): Promise<AspectVariant[]> {
      if (input.refineFrom) {
        const r = await api.refineAspectVariant(
          args.bookId,
          args.stageId,
          input.aspect.id,
          {
            aspect: {
              id: input.aspect.id,
              name: input.aspect.name,
              ...(input.aspect.description !== undefined
                ? { description: input.aspect.description }
                : {}),
            },
            parentVariant: {
              id: input.refineFrom.variantId,
              label: "исходный",
              payload: input.refineFrom.payload,
            },
            instructions: input.refineFrom.instructions,
            accumulated: input.accumulated.acceptedAspects.map((a) => ({
              name: a.name,
              finalPayload: String(a.finalPayload),
            })),
          },
        );
        return [r.variant];
      }
      const r = await api.generateAspectVariants(
        args.bookId,
        args.stageId,
        input.aspect.id,
        {
          aspect: {
            id: input.aspect.id,
            name: input.aspect.name,
            ...(input.aspect.description !== undefined
              ? { description: input.aspect.description }
              : {}),
          },
          accumulated: input.accumulated.acceptedAspects.map((a) => ({
            id: a.id,
            name: a.name,
            finalPayload: String(a.finalPayload),
          })),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        },
      );
      return r.variants;
    },
  };
}

/** Standalone playbook generator (returns proposed aspect templates, NOT
 *  variants). Used by Phase D's per-stage page when the stage has no
 *  aspects yet and the user wants the LLM to propose them. */
export interface PlaybookGenerator {
  generate(args: {
    existingAspectNames?: string[];
  }): Promise<{
    aspects: Array<{
      name: string;
      description: string;
      required: boolean;
      payloadKind: "markdown";
    }>;
  }>;
}

export function createLLMPlaybookGenerator(args: {
  bookId: number;
  stageId: StageId;
}): PlaybookGenerator {
  return {
    async generate(input) {
      const r = await api.generateStagePlaybook(
        args.bookId,
        args.stageId,
        input.existingAspectNames ?? [],
      );
      return { aspects: r.aspects };
    },
  };
}

/** LLM-backed VariantGenerator for entity_set stages (characters/items). */
export function createLLMEntityVariantGenerator(args: {
  bookId: number;
  stageId: "characters" | "items";
}): VariantGenerator<EntitySetPayload> {
  return {
    async generate(input) {
      if (input.refineFrom) {
        throw new Error("refine for entity_set not supported in Phase E");
      }
      const r = await api.generateAspectEntityVariants(
        args.bookId,
        args.stageId,
        input.aspect.id,
        {
          aspect: {
            id: input.aspect.id,
            name: input.aspect.name,
            ...(input.aspect.description !== undefined
              ? { description: input.aspect.description }
              : {}),
            payloadKind: "entity_set",
          },
          accumulated: input.accumulated.acceptedAspects.map((a) => ({
            id: a.id,
            name: a.name,
            finalPayload: a.finalPayload,
          })),
        },
      );
      return r.variants;
    },
  };
}

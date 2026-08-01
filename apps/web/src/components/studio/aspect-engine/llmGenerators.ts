import type { AspectVariant, EntitySetPayload, StageId } from "@book-forge/shared";
import {
  api,
  streamAspectEntityVariants,
  streamAspectRefine,
  streamAspectVariants,
  streamStagePlaybook,
  type AspectGenerationProgress,
  type AspectStreamHandlers,
} from "@/api/client";
import type {
  GenerateInput,
  VariantGenerator,
} from "./types.js";

/** SSE-вызов → Promise с результатом. Прогресс уходит вызывающему, `done`
 *  разрешает промис, `error` — отклоняет. */
function collectStream<T>(
  onProgress: (p: AspectGenerationProgress) => void,
  start: (handlers: AspectStreamHandlers<T>) => Promise<void>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    start({
      onProgress,
      onDone: resolve,
      onError: (message) => reject(new Error(message)),
    }).catch(reject);
  });
}

/** LLM-backed VariantGenerator for markdown stages (world/lore). Без
 *  `onProgress` идёт обычным POST, с ним — по SSE с живым прогрессом. */
export function createLLMMarkdownVariantGenerator(args: {
  bookId: number;
  stageId: StageId;
}): VariantGenerator<string> {
  return {
    async generate(
      input: GenerateInput<string>,
      onProgress?: (p: AspectGenerationProgress) => void,
    ): Promise<AspectVariant[]> {
      const aspect = {
        id: input.aspect.id,
        name: input.aspect.name,
        ...(input.aspect.description !== undefined
          ? { description: input.aspect.description }
          : {}),
      };
      if (input.refineFrom) {
        const refineBody = {
          aspect,
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
        };
        if (!onProgress) {
          const r = await api.refineAspectVariant(
            args.bookId,
            args.stageId,
            input.aspect.id,
            refineBody,
          );
          return [r.variant];
        }
        const { variant } = await collectStream<{ variant: AspectVariant }>(
          onProgress,
          (handlers) =>
            streamAspectRefine(
              args.bookId,
              args.stageId,
              input.aspect.id,
              refineBody,
              handlers,
            ),
        );
        return [variant];
      }
      const body = {
        aspect,
        accumulated: input.accumulated.acceptedAspects.map((a) => ({
          id: a.id,
          name: a.name,
          finalPayload: String(a.finalPayload),
        })),
        ...(input.draft !== undefined ? { draft: input.draft } : {}),
      };
      if (!onProgress) {
        const r = await api.generateAspectVariants(
          args.bookId,
          args.stageId,
          input.aspect.id,
          body,
        );
        return r.variants;
      }
      const { variants } = await collectStream<{ variants: AspectVariant[] }>(
        onProgress,
        (handlers) =>
          streamAspectVariants(
            args.bookId,
            args.stageId,
            input.aspect.id,
            body,
            handlers,
          ),
      );
      return variants;
    },
  };
}

/** Standalone playbook generator (returns proposed aspect templates, NOT
 *  variants). Used by Phase D's per-stage page when the stage has no
 *  aspects yet and the user wants the LLM to propose them. */
export interface PlaybookGenerator {
  generate(
    args: { existingAspectNames?: string[] },
    onProgress?: (p: AspectGenerationProgress) => void,
  ): Promise<{
    aspects: Array<{
      name: string;
      description: string;
      required: boolean;
      payloadKind: "markdown" | "entity_set";
    }>;
  }>;
}

export function createLLMPlaybookGenerator(args: {
  bookId: number;
  stageId: StageId;
}): PlaybookGenerator {
  return {
    async generate(input, onProgress) {
      const existingAspectNames = input.existingAspectNames ?? [];
      if (!onProgress) {
        const r = await api.generateStagePlaybook(
          args.bookId,
          args.stageId,
          existingAspectNames,
        );
        return { aspects: r.aspects };
      }
      return await collectStream<{
        aspects: Array<{
          name: string;
          description: string;
          required: boolean;
          payloadKind: "markdown" | "entity_set";
        }>;
      }>(onProgress, (handlers) =>
        streamStagePlaybook(
          args.bookId,
          args.stageId,
          existingAspectNames,
          handlers,
        ),
      );
    },
  };
}

/** LLM-backed VariantGenerator for entity_set stages (characters/items). */
export function createLLMEntityVariantGenerator(args: {
  bookId: number;
  stageId: "characters" | "items";
}): VariantGenerator<EntitySetPayload> {
  return {
    async generate(input, onProgress) {
      if (input.refineFrom) {
        throw new Error("refine for entity_set not supported in Phase E");
      }
      const body = {
        aspect: {
          id: input.aspect.id,
          name: input.aspect.name,
          ...(input.aspect.description !== undefined
            ? { description: input.aspect.description }
            : {}),
          payloadKind: "entity_set" as const,
        },
        accumulated: input.accumulated.acceptedAspects.map((a) => ({
          id: a.id,
          name: a.name,
          finalPayload: a.finalPayload,
        })),
      };
      // Без обработчика прогресса нет смысла держать SSE-соединение.
      if (!onProgress) {
        const r = await api.generateAspectEntityVariants(
          args.bookId,
          args.stageId,
          input.aspect.id,
          body,
        );
        return r.variants;
      }
      const { variants } = await collectStream<{ variants: AspectVariant[] }>(
        onProgress,
        (handlers) =>
          streamAspectEntityVariants(
            args.bookId,
            args.stageId,
            input.aspect.id,
            body,
            handlers,
          ),
      );
      return variants;
    },
  };
}

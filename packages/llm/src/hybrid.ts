import type { ZodType } from "zod";
import { LLMError } from "./errors.js";
import { getSubscriptionClient } from "./clients/subscription.js";
import { callStructured, type StructuredUsage } from "./structured.js";
import type { SystemBlock, StreamCallResult } from "./stream.js";
import type { AgentName } from "./types.js";
import type { ModelChoice } from "@book-forge/shared";

/**
 * Hybrid pipeline: heavy text generation through subscription (free under
 * Claude Pro/Max), then a small structured extraction pass through the
 * Anthropic API to convert prose into a typed object.
 *
 * Pass 1 (subscription, opus-class): produces unstructured prose / markdown
 * containing all the substantive content.
 *
 * Pass 2 (api, sonnet by default): tool_use call that re-reads the prose and
 * emits the schema-conformant JSON. Cheap (~$0.001/call) and reliable
 * because it goes through the real tool_use path.
 *
 * Use this for any agent where:
 *   - the bulk of the work is generative writing (lots of tokens), AND
 *   - the consumer ultimately needs structured output.
 *
 * Examples: book outline, chapter beat-sheet, canon extraction, critic
 * verdicts, style fingerprints.
 *
 * Errors propagate from either stage. Subscription failures (auth, rate
 * limit) surface as LLMAuthError/LLMError; extraction failures surface as
 * LLMValidationError. No automatic fallback to all-api — caller decides.
 */

export interface HybridUsageEvent {
  stage: "generate" | "extract";
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface GenerateThenStructureInput<T> {
  /** Used as agentName for the extraction (api) pass — telemetry/routing. */
  agentName: AgentName;

  // ─── Pass 1: subscription text generation ───
  textModel: ModelChoice;
  textSystem: string | SystemBlock[];
  textPrompt: string;

  // ─── Pass 2: api structured extraction ───
  extractModel?: ModelChoice; // default "sonnet"
  extractSystem: string | SystemBlock[];
  /** Build the extraction prompt from the prose produced in pass 1. */
  extractPrompt: (prose: string) => string;
  extractSchema: ZodType<T>;
  extractSchemaName: string;
  extractSchemaDescription: string;
  extractMaxTokens?: number;

  /** Emitted twice — once per stage — with separate token counts. */
  onUsage?: (event: HybridUsageEvent) => void;
}

export async function generateThenStructure<T>(
  input: GenerateThenStructureInput<T>,
): Promise<T> {
  const sub = getSubscriptionClient();
  const proseGen = sub.streamMessages({
    model: input.textModel,
    system: input.textSystem,
    prompt: input.textPrompt,
  });

  let prose = "";
  let proseFinal: StreamCallResult | undefined;
  while (true) {
    const next = await proseGen.next();
    if (next.done) {
      proseFinal = next.value;
      break;
    }
    prose += next.value;
  }
  if (!proseFinal) {
    throw new LLMError("hybrid: subscription stream returned no final result");
  }
  if (input.onUsage) {
    input.onUsage({
      stage: "generate",
      modelId: proseFinal.modelId,
      inputTokens: proseFinal.inputTokens,
      outputTokens: proseFinal.outputTokens,
      cacheCreationInputTokens: proseFinal.cacheCreationInputTokens,
      cacheReadInputTokens: proseFinal.cacheReadInputTokens,
    });
  }

  const extractOptions = {
    agentName: input.agentName,
    model: input.extractModel ?? ("sonnet" as ModelChoice),
    system: input.extractSystem,
    prompt: input.extractPrompt(prose),
    schema: input.extractSchema,
    schemaName: input.extractSchemaName,
    schemaDescription: input.extractSchemaDescription,
    ...(input.extractMaxTokens !== undefined
      ? { maxTokens: input.extractMaxTokens }
      : {}),
    ...(input.onUsage
      ? {
          onUsage: (u: StructuredUsage) =>
            input.onUsage?.({
              stage: "extract",
              modelId: u.modelId,
              inputTokens: u.inputTokens,
              outputTokens: u.outputTokens,
              cacheCreationInputTokens: u.cacheCreationInputTokens,
              cacheReadInputTokens: u.cacheReadInputTokens,
            }),
        }
      : {}),
  };
  return await callStructured(extractOptions);
}

import { z } from "zod";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import type { ModelChoice, GenerationConfig } from "@book-forge/shared";

/**
 * Phase 5 — relevance reranker.
 *
 * LLM-judge that re-scores a candidate pool against a query. RRF/vector
 * similarity returns a good candidate set but imperfect ordering; this
 * sharpens precision of what actually enters the prompt. Gated behind
 * `RETRIEVAL_RERANK` (off by default) at the call sites.
 */

export interface RerankCandidate {
  id: number;
  text: string;
}

export interface RerankInput {
  query: string;
  candidates: RerankCandidate[];
  model?: ModelChoice;
  config?: GenerationConfig;
  onUsage?: (u: StructuredUsage) => void;
}

const rerankOutputSchema = z.object({
  ranked: z
    .array(
      z.object({
        id: z.number().int(),
        score: z.number().min(0).max(1),
      }),
    )
    .max(100),
});
export type RerankOutput = z.infer<typeof rerankOutputSchema>;

const SYSTEM = `Ты — Relevance Judge. Оцениваешь, насколько каждый фрагмент-кандидат полезен для написания/планирования сцены по запросу.

Для КАЖДОГО кандидата верни его id и score 0..1:
- 1.0 — прямо относится к запросу (те же персонажи/место/событие/конфликт)
- 0.5 — косвенно полезен (фон, отголоски)
- 0.0 — нерелевантен

Только релевантность к запросу. Не оценивай стиль/качество. Верни ВСЕ id ровно один раз.`;

function buildPrompt(input: RerankInput): string {
  const cands = input.candidates
    .map((c) => `[#${c.id}]\n${c.text}`)
    .join("\n\n---\n\n");
  return [`Запрос:\n${input.query}`, `Кандидаты:\n\n${cands}`].join(
    "\n\n===\n\n",
  );
}

const rerankerContract: AgentStructuredContract<RerankInput, RerankOutput> = {
  agentName: "reranker",
  getOutputSchema: () => rerankOutputSchema,
  systemPrompt: SYSTEM,
  buildPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_rerank_scores",
    toolDescription:
      "Submit a relevance score (0..1) for every candidate id against the query.",
  },
};

export function registerRerankerContract(): void {
  registerAgentContract(rerankerContract);
}

export async function rerankCandidates(
  input: RerankInput,
): Promise<RerankOutput> {
  const { raw, diagnostics } = await dispatchStructured<
    RerankInput,
    RerankOutput
  >({
    agentName: "reranker",
    payload: input,
    model: input.model ?? input.config?.model ?? "sonnet",
    ...(input.config?.temperature !== undefined
      ? { temperature: input.config.temperature }
      : {}),
    maxTokens: 2048,
  });
  if (input.onUsage) {
    try {
      input.onUsage({
        modelId: diagnostics.modelId,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
        cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
        cacheReadInputTokens: diagnostics.cacheReadInputTokens,
      });
    } catch (e) {
      console.warn(
        "[reranker] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

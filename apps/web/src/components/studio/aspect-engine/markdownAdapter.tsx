import { z } from "zod";
import type { StageAdapter } from "./types.js";
import type { StageId } from "@book-forge/shared";

const markdownPayloadSchema = z.string().min(1).max(20000);
type MarkdownPayload = z.infer<typeof markdownPayloadSchema>;

/** Factory: a markdown adapter scoped to one stage. Used by world/lore in
 *  Phase D and by C1 tests via the mock generator. */
export function createMarkdownAdapter(stageId: StageId): StageAdapter<MarkdownPayload> {
  return {
    stageId,
    payloadKind: "markdown",
    payloadSchema: markdownPayloadSchema,
    renderVariant: (payload) => (
      <div className="text-sm whitespace-pre-wrap">{payload}</div>
    ),
    renderFinal: (payload) => (
      <div className="text-sm whitespace-pre-wrap rounded bg-[var(--color-muted)] px-3 py-2">
        {payload}
      </div>
    ),
    editable: {
      toText: (payload) => payload,
      fromText: (text) => text,
    },
  };
}

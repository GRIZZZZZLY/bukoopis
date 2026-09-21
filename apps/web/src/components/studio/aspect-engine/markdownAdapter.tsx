import { z } from "zod";
import type { StageAdapter } from "./types.js";
import type { StageId } from "@book-forge/shared";
import { Markdown } from "@/components/Markdown";

const markdownPayloadSchema = z.string().min(1).max(20000);
type MarkdownPayload = z.infer<typeof markdownPayloadSchema>;

/** Factory: a markdown adapter scoped to one stage. Used by world/lore in
 *  Phase D and by C1 tests via the mock generator. */
export function createMarkdownAdapter(stageId: StageId): StageAdapter<MarkdownPayload> {
  return {
    stageId,
    payloadKind: "markdown",
    payloadSchema: markdownPayloadSchema,
    // Автор читает раздел как текст, а не как исходник: решётки и звёздочки
    // на экране — это и есть «сырой markdown» из ТЗ конвейера (фаза 6).
    // Правка по-прежнему идёт исходником — `editable` ниже.
    renderVariant: (payload) => <Markdown className="text-sm" text={payload} />,
    renderFinal: (payload) => (
      <Markdown
        className="text-sm rounded bg-[var(--color-muted)] px-3 py-2"
        text={payload}
      />
    ),
    editable: {
      toText: (payload) => payload,
      fromText: (text) => text,
    },
  };
}

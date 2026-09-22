import { z } from "zod";
import type {
  AspectVariant,
  BookConcept,
  ContextRef,
  ModelChoice,
  StageId,
} from "@book-forge/shared";
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredProgressEvent,
  type StructuredUsage,
} from "@book-forge/llm";

export interface AspectDocumentInput {
  stageId: StageId;
  concept: BookConcept;
  /** Разделы, у которых уже есть текст: контекст, переписывать нельзя. */
  existingSections: Array<{ name: string; text: string }>;
  /** Разделы, имена которых автор уже видит, а текста нет: их надо написать. */
  emptySectionNames: string[];
  /** Заметки автора к этапу. Обязательны к учёту. */
  authorNotes?: string;
  contextRef: ContextRef;
}

const documentSectionSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(200),
  markdown: z.string().min(100).max(8000),
});

const aspectDocumentOutputSchema = z.object({
  sections: z.array(documentSectionSchema).min(1).max(9),
});

export type DocumentSectionOut = z.infer<typeof documentSectionSchema>;
export type AspectDocumentOutput = z.infer<typeof aspectDocumentOutputSchema>;

const STAGE_LABELS: Record<StageId, string> = {
  concept: "Замысел",
  world: "Мир",
  lore: "Лор",
  characters: "Персонажи",
  items: "Предметы",
  plot: "План",
  chapters: "Главы",
};

const STAGE_GUIDANCE: Partial<Record<StageId, string>> = {
  world:
    "Внешний слой реальности книги: где это происходит, кто там правит, чем живут, что за техника или её отсутствие, как устроен быт и что в этом мире невозможно.",
  lore: "Внутренний слой смыслов: во что здесь верят, что помнят о прошлом, какие истории рассказывают друг другу, что считают святым и что — позорным.",
};

export const documentSystemPrompt = `Ты — литературный соавтор. Пишешь по-русски один связный документ книжной библии для одного этапа.

Документ состоит из разделов. Раздел — это короткая тема (география, власть, вера, ремёсла) и текст к ней: 150–400 слов сплошной прозой или списками, без воды и без штампов. Разделы читаются подряд, поэтому не повторяй в одном то, что уже сказал в другом, и не начинай каждый одинаково.

Чего делать нельзя:
- выдавать общие места, которые подошли бы любой книге («мир полон опасностей», «магия имеет цену»);
- объяснять замысел книги вместо того, чтобы описывать её мир;
- называть разделы служебными словами интерфейса — имя раздела это одно-два слова по существу;
- писать раздел, которого автор не просил, вместо того, который просил.

Если даны РАЗДЕЛЫ С ТЕКСТОМ — это материал автора. НЕ переписывай их и не выдавай своей версии: они уже есть. Учитывай их и не противоречь им.
Если даны ПУСТЫЕ РАЗДЕЛЫ — напиши каждый из них под тем же именем.
Если даны только разделы с текстом, а пустых нет — значит документ уже собран и тебя просят его дополнить: добавь разделы, которых этапу не хватает, и ни один из перечисленных не трогай.
Если ни тех, ни других нет — собери документ целиком: 5–9 разделов, сам выбери темы под жанр и тон.
Если даны ЗАМЕТКИ АВТОРА — это ограничения, а не пожелания: то, что в них сказано, обязано попасть в документ и не может быть отменено.

Каждый раздел возвращается тремя полями: name (одно-два слова), description (одна строка, о чём раздел), markdown (сам текст).`;

export function buildDocumentPrompt(input: AspectDocumentInput): string {
  const label = STAGE_LABELS[input.stageId];
  const parts: string[] = [`Этап: ${label}`];
  const guidance = STAGE_GUIDANCE[input.stageId];
  if (guidance) parts.push(guidance);
  parts.push(
    "",
    "ЗАМЫСЕЛ КНИГИ:",
    `Жанр: ${input.concept.genre ?? "не задан"}`,
    `Тон: ${input.concept.tone ?? "не задан"}`,
    `Аудитория: ${input.concept.audience}`,
  );
  if (input.concept.premise.logline) {
    parts.push("Логлайн:", input.concept.premise.logline);
  }
  if (input.concept.premise.protagonist) {
    parts.push(`Главный герой: ${input.concept.premise.protagonist}`);
  }
  if (input.concept.premise.conflict) {
    parts.push(`Конфликт: ${input.concept.premise.conflict}`);
  }
  if (input.authorNotes && input.authorNotes.trim()) {
    parts.push("", "ЗАМЕТКИ АВТОРА (обязательны к учёту):", input.authorNotes.trim());
  }
  if (input.existingSections.length > 0) {
    parts.push("", "РАЗДЕЛЫ С ТЕКСТОМ (материал автора, НЕ переписывай и не возвращай):");
    for (const s of input.existingSections) {
      parts.push(`### ${s.name}`, s.text, "");
    }
  }
  if (input.emptySectionNames.length > 0) {
    parts.push(
      "",
      `ПУСТЫЕ РАЗДЕЛЫ (напиши каждый под этим же именем): ${input.emptySectionNames.join(", ")}`,
    );
    parts.push(
      "",
      "Верни ровно эти разделы. Добавь новый только если без него документ не читается.",
    );
  } else if (input.existingSections.length > 0) {
    // Пустых разделов нет, но автор нажал «Дополнить»: это просьба о том,
    // чего не хватает, а не о пересборке. Без этой ветки промпт говорил
    // «не переписывай перечисленное» и «собери 5–9 разделов» разом, и
    // модель сама решала, какому указанию верить.
    parts.push(
      "",
      `Документ этапа «${label}» уже собран, пустых разделов нет. Добавь 1–4 раздела, которых ему не хватает. Ни один из перечисленных выше не переписывай и не возвращай.`,
    );
  } else {
    parts.push("", `Собери документ этапа «${label}» целиком: 5–9 разделов.`);
  }
  return parts.join("\n");
}

const aspectDocumentContract: AgentStructuredContract<
  AspectDocumentInput,
  AspectDocumentOutput
> = {
  agentName: "aspect_document",
  getOutputSchema: () => aspectDocumentOutputSchema,
  systemPrompt: documentSystemPrompt,
  buildPrompt: buildDocumentPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_stage_document",
    toolDescription:
      "Submit the whole stage document as a list of sections; each section has name, description and markdown text.",
  },
};

export function registerAspectDocumentContract(): void {
  registerAgentContract(aspectDocumentContract);
}

export interface RunAspectDocumentOptions {
  model?: ModelChoice;
  temperature?: number;
  onProgress?: (e: StructuredProgressEvent) => void;
  onUsage?: (usage: StructuredUsage & { modelId: string }) => void;
}

/** Один вызов на весь документ. Предел ожидания свой: общий `LLM_TIMEOUT_MS`
 *  (120 с) рассчитан на короткий структурный ответ, а здесь модель пишет
 *  разом столько же, сколько прежде писала шестью вызовами вариантов
 *  (замер 2026-08-01: один markdown-вариант ~121 с). */
export async function runAspectDocument(
  input: AspectDocumentInput,
  options: RunAspectDocumentOptions = {},
): Promise<AspectDocumentOutput> {
  const { raw, diagnostics } = await dispatchStructured<
    AspectDocumentInput,
    AspectDocumentOutput
  >({
    agentName: "aspect_document",
    payload: input,
    model: options.model ?? "sonnet",
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.onProgress !== undefined
      ? { onProgress: options.onProgress }
      : {}),
    maxTokens: 16000,
    timeoutMs: 600_000,
  });
  if (options.onUsage) {
    try {
      options.onUsage({
        modelId: diagnostics.modelId,
        inputTokens: diagnostics.inputTokens,
        outputTokens: diagnostics.outputTokens,
        cacheCreationInputTokens: diagnostics.cacheCreationInputTokens,
        cacheReadInputTokens: diagnostics.cacheReadInputTokens,
      });
    } catch (e) {
      console.warn(
        "[aspect_document] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  return raw;
}

/** Раздел документа → вариант аспекта. Статус `generated`: документ приходит
 *  черновиком, принимает его автор кнопкой «Утвердить». */
export function toStoredDocumentVariant(
  section: DocumentSectionOut,
  meta: { contextRef: ContextRef; modelId: string },
): AspectVariant {
  return {
    id: crypto.randomUUID(),
    label: "документ",
    payloadKind: "markdown",
    payload: section.markdown,
    status: "generated",
    editSource: "llm",
    generatedAt: new Date().toISOString(),
    modelId: meta.modelId,
    contextRef: meta.contextRef,
  };
}

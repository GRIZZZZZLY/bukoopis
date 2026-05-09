// NOTE: Style Extractor agent calls into @book-forge/llm. To avoid creating a
// hard dep cycle (llm depends on shared, agents depends on llm), style-engine
// also depends on llm. We accept this — style-engine is a leaf consumer of
// llm, never the other way around.
import { callStructured, type StructuredUsage } from "@book-forge/llm";
import {
  styleFingerprintSchema,
  type StyleFingerprint,
} from "@book-forge/shared";

export interface StyleExtractInput {
  language: string;
  authorName: string;
  scenes: string[]; // sample of scenes (already truncated to ~30-50)
  model?: "sonnet" | "opus";
  onUsage?: (usage: StructuredUsage) => void;
}

const SYSTEM = `Ты — Style Extractor. Анализируешь корпус художественной прозы автора и описываешь его стиль структурированно.

Цель: дать Writer-агенту достаточно подсказок, чтобы тот мог писать НЕ ПОДРАЖАТЕЛЬНО, а в духе автора. Не цитируй буквально; описывай паттерны.

Принципы:
- Выделяй ОТЛИЧИЯ от среднего LLM-выхода, а не общие литературные правила.
- Давай конкретные операционные подсказки ("предложения средней длины с инверсией в начале каждого 3-4-го") вместо абстракций ("живой стиль").
- voiceSummary — 2-3 предложения, как ты бы описал голос автора другу-писателю.
- thingsToImitate — 5-10 КОНКРЕТНЫХ паттернов (синтаксис, ритм, переходы), которые надо воспроизвести.
- thingsToAvoid — 5-10 паттернов, которыми Writer обычно грешит и которых у этого автора НЕТ.
- metaphorFamilies — категории метафор (например "природные стихии", "телесные ощущения"), а не сами метафоры.
- signatureSyntax — частотные синтаксические конструкции автора (например "обрывы прямой речи многоточием", "длинные перечисления через тире").
- signatureTropes — повторяющиеся литературные приёмы (например "сцена начинается с описания погоды").

Возвращай structured output по схеме.`;

export async function runStyleExtractor(
  input: StyleExtractInput,
): Promise<StyleFingerprint> {
  const sceneBlock = input.scenes
    .map((s, i) => `### Scene ${i + 1}\n${s}`)
    .join("\n\n---\n\n");

  const prompt = [
    `Автор: ${input.authorName}`,
    `Язык: ${input.language}`,
    `Количество сцен в выборке: ${input.scenes.length}`,
    "",
    "Проанализируй корпус и верни style fingerprint в structured формате.",
    "",
    "Корпус:",
    sceneBlock,
  ].join("\n");

  return await callStructured({
    agentName: "style_extractor",
    model: input.model ?? "sonnet",
    system: SYSTEM,
    prompt,
    schema: styleFingerprintSchema,
    schemaName: "submit_style_fingerprint",
    schemaDescription:
      "Submit a structured style fingerprint extracted from the author's corpus.",
    maxTokens: 4096,
    onUsage: input.onUsage,
  });
}

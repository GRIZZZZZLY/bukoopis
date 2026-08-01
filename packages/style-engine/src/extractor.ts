// NOTE: Style Extractor agent calls into @book-forge/llm. To avoid creating a
// hard dep cycle (llm depends on shared, agents depends on llm), style-engine
// also depends on llm. We accept this — style-engine is a leaf consumer of
// llm, never the other way around.
import {
  registerAgentContract,
  dispatchStructured,
  type AgentStructuredContract,
  type StructuredUsage,
} from "@book-forge/llm";
import {
  styleFingerprintLlmSchema,
  type StyleFingerprint,
  type StyleFingerprintLlm,
} from "@book-forge/shared";
import {
  composeDensity,
  computeCorpusMetrics,
  renderCorpusMetrics,
} from "./metrics.js";

export interface StyleExtractInput {
  language: string;
  authorName: string;
  scenes: string[]; // sample of scenes (already truncated to ~30-50)
  model?: "sonnet" | "opus";
  onUsage?: (usage: StructuredUsage) => void;
}

const SYSTEM = `Ты — Style Extractor. Анализируешь корпус художественной прозы автора и описываешь его стиль структурированно.

Цель: дать Writer-агенту достаточно подсказок, чтобы тот мог писать НЕ ПОДРАЖАТЕЛЬНО, а в духе автора. Не цитируй буквально; описывай паттерны.

Числовая статистика корпуса (длины предложений, доля прямой речи) уже посчитана программно и дана во входных данных. Не пересчитывай её и не спорь с ней — опирайся на неё в качественных выводах.

Принципы:
- Выделяй ОТЛИЧИЯ от среднего LLM-выхода, а не общие литературные правила.
- Давай конкретные операционные подсказки ("предложения средней длины с инверсией в начале каждого 3-4-го") вместо абстракций ("живой стиль").
- Каждый пункт должен быть проверяем по тексту: если утверждение нельзя подтвердить конкретным местом в корпусе — не пиши его.
- voiceSummary — 2-3 предложения, как ты бы описал голос автора другу-писателю.
- thingsToImitate — 5-10 КОНКРЕТНЫХ паттернов (синтаксис, ритм, переходы), которые надо воспроизвести.
- thingsToAvoid — 5-10 паттернов, которыми Writer обычно грешит и которых у этого автора НЕТ.
- metaphorFamilies — категории метафор (например "природные стихии", "телесные ощущения"), а не сами метафоры.
- signatureSyntax — частотные синтаксические конструкции автора (например "обрывы прямой речи многоточием", "длинные перечисления через тире").
- signatureTropes — повторяющиеся литературные приёмы (например "сцена начинается с описания погоды").
- narrativeMix — как делится НЕдиалоговая проза между описанием, действием и интроспекцией. Три доли в сумме ≈ 1. Долю самого диалога не оценивай, она измерена.

Возвращай structured output по схеме.`;

function buildStyleExtractorPrompt(input: StyleExtractInput): string {
  const sceneBlock = input.scenes
    .map((s, i) => `### Scene ${i + 1}\n${s}`)
    .join("\n\n---\n\n");
  return [
    `Автор: ${input.authorName}`,
    `Язык: ${input.language}`,
    `Количество сцен в выборке: ${input.scenes.length}`,
    "",
    renderCorpusMetrics(computeCorpusMetrics(input.scenes)),
    "",
    "Проанализируй корпус и верни style fingerprint в structured формате.",
    "",
    "Корпус:",
    sceneBlock,
  ].join("\n");
}

const styleExtractorContract: AgentStructuredContract<
  StyleExtractInput,
  StyleFingerprintLlm
> = {
  agentName: "style_extractor",
  getOutputSchema: () => styleFingerprintLlmSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildStyleExtractorPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_style_fingerprint",
    toolDescription:
      "Submit a structured style fingerprint extracted from the author's corpus.",
  },
};

export function registerStyleExtractorContract(): void {
  registerAgentContract(styleExtractorContract);
}

export async function runStyleExtractor(
  input: StyleExtractInput,
): Promise<StyleFingerprint> {
  const metrics = computeCorpusMetrics(input.scenes);
  const { raw, diagnostics } = await dispatchStructured<
    StyleExtractInput,
    StyleFingerprintLlm
  >({
    agentName: "style_extractor",
    payload: input,
    model: input.model ?? "sonnet",
    maxTokens: 4096,
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
        "[style-engine/extractor] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const { narrativeMix, ...qualitative } = raw;
  return {
    ...qualitative,
    language: input.language,
    sentenceLengths: metrics.sentenceLengths,
    density: composeDensity(metrics.dialogueShare, narrativeMix),
  };
}

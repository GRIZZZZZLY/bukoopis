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
  type SentenceLengthDistribution,
} from "@book-forge/shared";
import { composeDensity } from "./metrics.js";

/**
 * Style Blender — synthesizes a NEW style fingerprint from two or more
 * extracted ones.
 *
 * The point is a voice that does not exist in any source corpus, so the output
 * is an ordinary `StyleFingerprint` stored as an ordinary profile: writer,
 * critics and the per-book selector need no knowledge that a blend happened.
 *
 * Numeric fields are weighted averages computed here, not by the model —
 * same rule as the extractor, for the same reason.
 */

export interface BlendParent {
  /** Profile name, shown to the model as the source's label. */
  name: string;
  /** Normalised 0..1. */
  weight: number;
  /** Which traits to pull from this parent, author's words. */
  emphasis?: string | null;
  fingerprint: StyleFingerprint;
}

export interface StyleBlendInput {
  language: string;
  /** Name of the blend being created — the model writes *its* voice, not a mix report. */
  blendName: string;
  parents: BlendParent[];
  instructions?: string | null;
  model?: "sonnet" | "opus";
  onUsage?: (usage: StructuredUsage) => void;
}

const SYSTEM = `Ты — Style Blender. Из нескольких авторских стилевых профилей ты создаёшь ОДИН НОВЫЙ стиль.

Главное: результат — самостоятельный голос, а не отчёт о смеси и не поочерёдное цитирование источников. Пиши так, будто описываешь стиль реального автора, которого читал. Никогда не пиши «от источника A взято…», «сочетает черты X и Y» — ни в одном поле.

Как смешивать:
- Вес источника — насколько сильно его признаки проступают в результате. Вес 0.7 против 0.3 значит «в основе первый, второй даёт акцент», а не «поровну».
- Если у источника указан акцент (например «ритм» или «метафорика»), бери у него в первую очередь именно это, а остальное — по весу.
- Где источники несовместимы (настоящее время против прошедшего, сухость против орнаментальности), НЕ усредняй в серое. Выбирай в пользу большего веса и указаний автора, а проигравшую черту либо отбрасывай, либо оставляй как редкий приём — и это должно быть видно в signatureSyntax/signatureTropes.
- Указания автора важнее весов, если они прямо противоречат.
- Результат обязан быть исполнимым: Writer должен по нему писать, не видя исходных профилей.

Требования к полям:
- voiceSummary — 2-3 предложения о получившемся голосе.
- thingsToImitate — 5-10 конкретных операционных паттернов (синтаксис, ритм, переходы).
- thingsToAvoid — 5-10 паттернов, которых в этом голосе нет. Сюда же — черты источников, сознательно отброшенные при конфликте.
- metaphorFamilies — категории образности, а не отдельные метафоры.
- signatureSyntax / signatureTropes — узнаваемые приёмы нового стиля.
- tense — одно значение, выбранное, а не усреднённое.
- narrativeMix — как делится НЕдиалоговая проза между описанием, действием и интроспекцией (сумма ≈ 1). Долю самого диалога не оценивай: она посчитана как взвешенное среднее источников.

Числовая статистика (длины предложений, доля прямой речи) уже вычислена программно и дана во входных данных — не пересчитывай и не оспаривай её, а согласуй с ней качественные выводы.`;

function renderParent(p: BlendParent, index: number): string {
  const fp = p.fingerprint;
  const lines: string[] = [
    `### Источник ${index + 1}: «${p.name}» — вес ${p.weight.toFixed(2)}`,
  ];
  if (p.emphasis && p.emphasis.trim()) {
    lines.push(`Брать в первую очередь: ${p.emphasis.trim()}`);
  }
  lines.push(`Голос: ${fp.voiceSummary}`);
  lines.push(`Ритм абзаца: ${fp.paragraphRhythm}`);
  lines.push(`Время: ${fp.tense}`);
  lines.push(`Открытие сцены: ${fp.sceneOpenings}`);
  lines.push(`Закрытие сцены: ${fp.sceneClosings}`);
  if (fp.metaphorFamilies.length > 0) {
    lines.push(`Семейства метафор: ${fp.metaphorFamilies.join(", ")}`);
  }
  if (fp.signatureSyntax.length > 0) {
    lines.push(`Сигнатурный синтаксис: ${fp.signatureSyntax.join("; ")}`);
  }
  if (fp.signatureTropes.length > 0) {
    lines.push(`Сигнатурные приёмы: ${fp.signatureTropes.join("; ")}`);
  }
  if (fp.thingsToImitate.length > 0) {
    lines.push(`Что воспроизводить: ${fp.thingsToImitate.join("; ")}`);
  }
  if (fp.thingsToAvoid.length > 0) {
    lines.push(`Чего у него нет: ${fp.thingsToAvoid.join("; ")}`);
  }
  lines.push(
    `Статистика: средн. ${fp.sentenceLengths.meanWords} слов/предложение, ` +
      `короткие ${pct(fp.sentenceLengths.shortShare)} / средние ${pct(fp.sentenceLengths.mediumShare)} / длинные ${pct(fp.sentenceLengths.longShare)}, ` +
      `диалог ${pct(fp.density.dialogue)}`,
  );
  return lines.join("\n");
}

function buildBlendPrompt(input: StyleBlendInput): string {
  const normalized = normalizeWeights(input.parents);
  const stats = blendNumericStats(normalized);
  const parts: string[] = [
    `Создаваемый стиль: «${input.blendName}»`,
    `Язык: ${input.language}`,
    "",
    "ИСХОДНЫЕ ПРОФИЛИ:",
    normalized.map(renderParent).join("\n\n"),
  ];
  if (input.instructions && input.instructions.trim()) {
    parts.push(
      "",
      "УКАЗАНИЯ АВТОРА (важнее весов при прямом противоречии):",
      input.instructions.trim(),
    );
  }
  parts.push(
    "",
    "ВЗВЕШЕННАЯ СТАТИСТИКА РЕЗУЛЬТАТА (посчитана программно, не пересчитывай):",
    `- Длина предложения: средняя ${stats.sentenceLengths.meanWords} слов, медиана ${stats.sentenceLengths.medianWords}`,
    `- Доли предложений: короткие ${pct(stats.sentenceLengths.shortShare)}, средние ${pct(stats.sentenceLengths.mediumShare)}, длинные ${pct(stats.sentenceLengths.longShare)}`,
    `- Доля прямой речи: ${pct(stats.dialogueShare)}`,
    "",
    "Синтезируй единый новый стиль и верни его в structured формате.",
  );
  return parts.join("\n");
}

const styleBlenderContract: AgentStructuredContract<
  StyleBlendInput,
  StyleFingerprintLlm
> = {
  agentName: "style_blender",
  getOutputSchema: () => styleFingerprintLlmSchema,
  systemPrompt: SYSTEM,
  buildPrompt: buildBlendPrompt,
  defaultMode: "mcp_submit_tool",
  mcp: {
    toolName: "submit_blended_style_fingerprint",
    toolDescription:
      "Submit one synthesized style fingerprint blended from several source profiles.",
  },
};

export function registerStyleBlenderContract(): void {
  registerAgentContract(styleBlenderContract);
}

/** Weights are author-supplied and need not sum to 1; equal split if all zero. */
export function normalizeWeights(parents: BlendParent[]): BlendParent[] {
  const sum = parents.reduce((acc, p) => acc + p.weight, 0);
  if (sum <= 0) {
    const even = parents.length > 0 ? 1 / parents.length : 0;
    return parents.map((p) => ({ ...p, weight: even }));
  }
  return parents.map((p) => ({ ...p, weight: p.weight / sum }));
}

export interface BlendNumericStats {
  sentenceLengths: SentenceLengthDistribution;
  dialogueShare: number;
}

/** Weighted average of the parents' measured statistics. Weights must be normalised. */
export function blendNumericStats(parents: BlendParent[]): BlendNumericStats {
  const acc = {
    meanWords: 0,
    medianWords: 0,
    shortShare: 0,
    mediumShare: 0,
    longShare: 0,
    dialogue: 0,
  };
  for (const p of parents) {
    const sl = p.fingerprint.sentenceLengths;
    acc.meanWords += sl.meanWords * p.weight;
    acc.medianWords += sl.medianWords * p.weight;
    acc.shortShare += sl.shortShare * p.weight;
    acc.mediumShare += sl.mediumShare * p.weight;
    acc.longShare += sl.longShare * p.weight;
    acc.dialogue += p.fingerprint.density.dialogue * p.weight;
  }
  return {
    sentenceLengths: {
      meanWords: round2(acc.meanWords),
      medianWords: round2(acc.medianWords),
      shortShare: round3(acc.shortShare),
      mediumShare: round3(acc.mediumShare),
      longShare: round3(acc.longShare),
    },
    dialogueShare: round3(acc.dialogue),
  };
}

export async function runStyleBlender(
  input: StyleBlendInput,
): Promise<StyleFingerprint> {
  const stats = blendNumericStats(normalizeWeights(input.parents));
  const { raw, diagnostics } = await dispatchStructured<
    StyleBlendInput,
    StyleFingerprintLlm
  >({
    agentName: "style_blender",
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
        "[style-engine/blender] onUsage callback threw:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const { narrativeMix, ...qualitative } = raw;
  return {
    ...qualitative,
    language: input.language,
    sentenceLengths: stats.sentenceLengths,
    density: composeDensity(stats.dialogueShare, narrativeMix),
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

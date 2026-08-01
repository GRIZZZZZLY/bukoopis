import type {
  DensityProfile,
  SentenceLengthDistribution,
} from "@book-forge/shared";

/**
 * Deterministic corpus statistics.
 *
 * Sentence-length distribution and dialogue share used to be fields the Style
 * Extractor filled in by eye — an LLM counting words across 30 scenes produces
 * plausible-looking numbers that are not measurements. Anything countable is
 * counted here; the model is left with the judgements only a reader can make.
 */

const SENTENCE_SPLIT_RE = /[.!?…]+["»'')\]]*\s+|\n+/u;
const WORD_RE = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function countWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

export function computeSentenceLengths(
  scenes: string[],
): SentenceLengthDistribution {
  const lengths: number[] = [];
  for (const scene of scenes) {
    for (const sentence of splitSentences(scene)) {
      const n = countWords(sentence);
      if (n > 0) lengths.push(n);
    }
  }
  if (lengths.length === 0) {
    return {
      meanWords: 0,
      medianWords: 0,
      shortShare: 0,
      mediumShare: 0,
      longShare: 0,
    };
  }

  const total = lengths.reduce((a, b) => a + b, 0);
  const sorted = [...lengths].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

  const short = lengths.filter((n) => n < 8).length;
  const long = lengths.filter((n) => n > 20).length;
  const medium = lengths.length - short - long;

  return {
    meanWords: round2(total / lengths.length),
    medianWords: round2(median),
    shortShare: round3(short / lengths.length),
    mediumShare: round3(medium / lengths.length),
    longShare: round3(long / lengths.length),
  };
}

// A Russian dialogue line opens with an em/en dash; quoted speech is the
// secondary convention. Both are counted, quotes only when the line is
// predominantly quoted text (so mid-paragraph quoted words don't register).
const DIALOGUE_DASH_RE = /^\s*[—–-]\s*\S/u;
const QUOTED_RE = /[«"]([^»"]{4,})[»"]/gu;

/** Share of prose (by word count) that is direct speech. */
export function computeDialogueShare(scenes: string[]): number {
  let dialogueWords = 0;
  let totalWords = 0;
  for (const scene of scenes) {
    for (const rawLine of scene.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const words = countWords(line);
      if (words === 0) continue;
      totalWords += words;

      if (DIALOGUE_DASH_RE.test(line)) {
        dialogueWords += words;
        continue;
      }
      let quoted = 0;
      for (const m of line.matchAll(QUOTED_RE)) {
        quoted += countWords(m[1] ?? "");
      }
      if (quoted / words > 0.5) dialogueWords += quoted;
    }
  }
  return totalWords === 0 ? 0 : round3(dialogueWords / totalWords);
}

/**
 * Combines the measured dialogue share with the model's judgement of how the
 * remaining prose divides. The model reports proportions *within non-dialogue
 * prose*; rescaling here keeps the four densities summing to 1 without asking
 * it to do arithmetic it is bad at.
 */
export function composeDensity(
  dialogueShare: number,
  narrativeMix: { description: number; action: number; introspection: number },
): DensityProfile {
  const rest = Math.max(0, 1 - dialogueShare);
  const sum =
    narrativeMix.description + narrativeMix.action + narrativeMix.introspection;
  if (sum <= 0) {
    return {
      dialogue: round3(dialogueShare),
      description: round3(rest),
      action: 0,
      introspection: 0,
    };
  }
  return {
    dialogue: round3(dialogueShare),
    description: round3((rest * narrativeMix.description) / sum),
    action: round3((rest * narrativeMix.action) / sum),
    introspection: round3((rest * narrativeMix.introspection) / sum),
  };
}

export interface CorpusMetrics {
  sentenceLengths: SentenceLengthDistribution;
  dialogueShare: number;
  sceneCount: number;
  totalWords: number;
}

export function computeCorpusMetrics(scenes: string[]): CorpusMetrics {
  return {
    sentenceLengths: computeSentenceLengths(scenes),
    dialogueShare: computeDialogueShare(scenes),
    sceneCount: scenes.length,
    totalWords: scenes.reduce((acc, s) => acc + countWords(s), 0),
  };
}

/** Human-readable block handed to the extractor as measured ground truth. */
export function renderCorpusMetrics(m: CorpusMetrics): string {
  const sl = m.sentenceLengths;
  return [
    "ИЗМЕРЕННАЯ СТАТИСТИКА КОРПУСА (посчитана программно, не оценивай её заново):",
    `- Сцен в выборке: ${m.sceneCount}, слов: ${m.totalWords}`,
    `- Длина предложения: средняя ${sl.meanWords} слов, медиана ${sl.medianWords}`,
    `- Доли предложений: короткие (<8 слов) ${pct(sl.shortShare)}, средние (8–20) ${pct(sl.mediumShare)}, длинные (>20) ${pct(sl.longShare)}`,
    `- Доля прямой речи в тексте: ${pct(m.dialogueShare)}`,
  ].join("\n");
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

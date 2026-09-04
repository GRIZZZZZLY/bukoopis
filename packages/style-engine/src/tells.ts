import { computeDialogueShare, countWords, splitSentences } from "./metrics.js";

/**
 * Structural LLM tells, counted rather than judged.
 *
 * The 2026-09-04 sepia review of three Writer versions of one chapter showed
 * that single-token bans in the prompt hold («казалось» 2–3 hits, the rest 0)
 * while structural bans in the same prompt are ignored: «не X, а Y» 12–20×,
 * rule-of-three 8–25× per chapter. A construction cannot be banned into
 * absence, but it can be measured — so a critic gets quoted evidence instead
 * of an impression, and a prompt change gets a number to move.
 *
 * Everything here is a heuristic over Russian surface forms. Precision is
 * traded for zero LLM cost: the counts are meant to be compared between
 * versions of the same text, not read as absolute verdicts.
 */

export const STRUCTURAL_TELL_IDS = [
  "negativeParallelism",
  "triad",
  "simile",
  "filterVerb",
  "participialClause",
  "embodiedEmotion",
  "etoBylOpener",
] as const;

export type StructuralTellId = (typeof STRUCTURAL_TELL_IDS)[number];

export const STRUCTURAL_TELL_LABELS_RU: Record<StructuralTellId, string> = {
  negativeParallelism: "«не X, а Y» / «не только… но и» / «Это был не X. Это был Y.»",
  triad: "правило трёх (три однородных члена или три одинаковых зачина подряд)",
  simile: "сравнения (будто/словно/точно/подобно/напоминал)",
  filterVerb: "фильтр-глаголы восприятия (понял/знал/почувствовал/заметил)",
  participialClause: "деепричастный оборот (ведущий или хвостовой)",
  embodiedEmotion: "эмоция через телесную реакцию (сердце/колени/горло + сжало/дрожало/застыло)",
  etoBylOpener: "зачин «Это был…»",
};

export interface SceneCadence {
  sceneCount: number;
  /** Mean words per sentence, one entry per scene. */
  meanWordsPerSentence: number[];
  /** (max − min) / mean across scene means; 0 when there is one scene or one cadence. */
  spread: number;
}

export interface StructuralTellsReport {
  totalWords: number;
  sentenceCount: number;
  counts: Record<StructuralTellId, number>;
  perThousandWords: Record<StructuralTellId, number>;
  /** Up to three quoted sentences per tell, for critics to cite. */
  examples: Record<StructuralTellId, string[]>;
  /** Share of sentences with three words or fewer. */
  shortSentenceShare: number;
  /** Share of narration paragraphs with six words or fewer (dialogue lines excluded). */
  punchParagraphShare: number;
  sceneCadence: SceneCadence;
  dialogueShare: number;
}

export interface MeasureTellsOptions {
  /** Pre-split scenes; when absent the text is split by separator lines or into equal chunks. */
  scenes?: string[];
  /** Number of equal paragraph chunks used when the text has no scene separators. */
  fallbackChunks?: number;
}

const MAX_EXAMPLES = 3;
const MAX_QUOTE_CHARS = 200;

// ─────────── Patterns ───────────

// JavaScript's `\b` is ASCII-only even under the `u` flag, so it never fires
// next to Cyrillic. Patterns below are written with `\b` for readability and
// compiled through `uRe`, which swaps it for a Unicode letter/digit boundary.
const UNICODE_WB =
  String.raw`(?:(?<![\p{L}\p{N}])(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])(?![\p{L}\p{N}]))`;

function uRe(source: string, flags = "gu"): RegExp {
  return new RegExp(source.replaceAll(String.raw`\b`, UNICODE_WB), flags);
}

// «не X, а Y», also «не X — а Y» and the negated list «не X, не Y, а Z»
// (one hit: the lazy span runs from the first «не» to the first «а»). The
// lookahead drops «, а когда/потом/если…» where «а» is a temporal or
// conditional joint, not a contrast.
const NEG_CONTRAST_RE = uRe(
  String.raw`\bне\b[^.!?;«»\n]{1,60}?(?:,\s*|\s[—–]\s*)а\s+(?!(?:когда|потом|затем|после|если|то|вот|пока|теперь|уже|ещё|еще|значит)\b)`,
  "giu",
);
const NEG_NOT_ONLY_RE = uRe(String.raw`\bне\s+только\b[^.!?\n]{1,80}\bно\s+и\b`, "giu");
const NEG_TWO_SENTENCE_RE = uRe(
  String.raw`\bЭто\s+был[аои]?\s+не\b[^.!?\n]*[.!?]\s+Это\s+был[аои]?\b`,
);

// Three coordinated items of one or two words each: «тих, бледен и упрям».
// The lookbehind rejects a run preceded by another item («хлеб, лук, соль и квас»).
const COMMA_TRIAD_RE = uRe(
  String.raw`(?<![\p{L}-],\s)\b([\p{L}-]+(?:\s+[\p{L}-]+)?),\s+([\p{L}-]+(?:\s+[\p{L}-]+)?)\s+и\s+([\p{L}-]+)`,
);

const SIMILE_RE = uRe(
  String.raw`\b(?:как\s+будто|как\s+бы|будто|словно|точно|подобно|напоминал[аои]?|похож[аие]?\s+на)\b`,
  "giu",
);

const FILTER_VERB_RE = uRe(
  String.raw`\b(?:понял|поняла|понимал|понимала|знал|знала|чувствовал|чувствовала|почувствовал|почувствовала|осознал|осознала|осознавал|осознавала|заметил|заметила|увидел|увидела|услышал|услышала|подумал|подумала|ощутил|ощутила|ощущал|ощущала)\b`,
  "giu",
);

// Деепричастие by suffix, precision first. Plain -ая/-яя are mostly feminine
// adjectives («рубленая», «короткая»), so only the imperfective -ивая/-ывая
// stems and -яя outside -няя («синяя») count; the perfective -в forms must be
// lower-case so names like «Всеслав» stay out. A clause is counted in any
// position — sepia flags leading and trailing participial clauses alike.
const GERUND_WORD_RE =
  /^(?:[\p{Ll}-]{3,}(?:ав|ев|ив|яв|ув)|[\p{L}-]{4,}(?:ясь|вшись|шись|вши|учи|ючи|ивая|ывая)|[\p{L}-]{4,}(?<!н)яя)$/u;
const CLAUSE_SPLIT_RE = /[,;—–]/u;

// Emotion rendered as a body event: a body noun within four words of an affect
// verb, in either order. Broader than a cliché list on purpose — the rubric
// feature is "embodied sensation dominates", not "uses the stock phrases".
const BODY_NOUN = String.raw`(?:сердц\p{L}*|груд\p{L}*|рёбр\p{L}*|ребр\p{L}*|живот\p{L}*|горл\p{L}*|дыхани\p{L}*|колен\p{L}*|ладон\p{L}*|пальц\p{L}*|спин\p{L}*|кож\p{L}*|кров\p{L}*|желуд\p{L}*|затыл\p{L}*|виск\p{L}*|лоб|лбу|зуб\p{L}*|челюст\p{L}*|ше[яеию])`;
const AFFECT_VERB = String.raw`(?:сжал\p{L}*|сжим\p{L}*|свело|дрож\p{L}*|задрож\p{L}*|холод\p{L}*|похолод\p{L}*|стыл\p{L}*|застыл\p{L}*|замер\p{L}*|тян\p{L}*|потян\p{L}*|отпуст\p{L}*|упал\p{L}*|ухнул\p{L}*|перехват\p{L}*|колот\p{L}*|заколот\p{L}*|стуч\p{L}*|застуч\p{L}*|ныл\p{L}*|заныл\p{L}*|ватн\p{L}*|онем\p{L}*|ослаб\p{L}*|подкос\p{L}*|вспотел\p{L}*|пересохл\p{L}*|скрут\p{L}*|сдав\p{L}*|стисн\p{L}*|ёкнул\p{L}*|екнул\p{L}*|пропустил\p{L}*|пробежал\p{L}*|пополз\p{L}*|скользнул\p{L}*|прошёл|прошел|оборвал\p{L}*)`;
// One regex, so «сердце упало в живот» is consumed once and not re-matched
// from the verb side.
const EMBODIED_EMOTION_RE = uRe(
  [
    String.raw`\b${BODY_NOUN}\b(?:\s+\S+){0,4}?\s+${AFFECT_VERB}\b`,
    String.raw`\b${AFFECT_VERB}\b(?:\s+\S+){0,3}?\s+${BODY_NOUN}\b`,
    String.raw`\bмурашк\p{L}*\b`,
  ].join("|"),
  "giu",
);

const ETO_BYL_RE = uRe(String.raw`^Это\s+был[аои]?\b`, "u");

const SCENE_SEPARATOR_LINE_RE = /^\s*(?:(?:\*\s*){1,5}|(?:[-—–_]\s*){3,}|#+)\s*$/u;
const PARAGRAPH_SPLIT_RE = /\n\s*\n/u;
const DIALOGUE_LINE_RE = /^\s*[—–-]\s*\S/u;

// ─────────── Scenes ───────────

export function splitScenesForCadence(text: string, fallbackChunks = 5): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const bySeparator: string[] = [];
  let current: string[] = [];
  let sawSeparator = false;
  for (const line of lines) {
    if (SCENE_SEPARATOR_LINE_RE.test(line)) {
      sawSeparator = true;
      if (current.join("\n").trim()) bySeparator.push(current.join("\n").trim());
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.join("\n").trim()) bySeparator.push(current.join("\n").trim());
  if (sawSeparator && bySeparator.length >= 2) return bySeparator;

  const paragraphs = normalized
    .split(PARAGRAPH_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length < 2) return paragraphs;

  const chunkCount = Math.max(1, Math.min(fallbackChunks, paragraphs.length));
  const size = Math.ceil(paragraphs.length / chunkCount);
  const chunks: string[] = [];
  for (let i = 0; i < paragraphs.length; i += size) {
    chunks.push(paragraphs.slice(i, i + size).join("\n\n"));
  }
  return chunks;
}

// ─────────── Helpers ───────────

type Span = readonly [start: number, end: number];

const SENTENCE_BOUNDARY_RE = /[.!?…]+["»'')\]]*\s+|\n+/gu;

function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_BOUNDARY_RE)) {
    const end = m.index + m[0].length;
    if (text.slice(last, end).trim()) spans.push([last, end]);
    last = end;
  }
  if (last < text.length && text.slice(last).trim()) spans.push([last, text.length]);
  return spans;
}

function clip(quote: string): string {
  const q = quote.replace(/\s+/g, " ").trim();
  return q.length > MAX_QUOTE_CHARS ? `${q.slice(0, MAX_QUOTE_CHARS - 1)}…` : q;
}

function quoteAt(text: string, spans: Span[], index: number): string {
  const span = spans.find(([a, b]) => index >= a && index < b);
  return clip(span ? text.slice(span[0], span[1]) : text.slice(index, index + 80));
}

function emptyRecord<T>(make: () => T): Record<StructuralTellId, T> {
  const out = {} as Record<StructuralTellId, T>;
  for (const id of STRUCTURAL_TELL_IDS) out[id] = make();
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function meanOf(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

// ─────────── Measurement ───────────

export function measureStructuralTells(
  text: string,
  options: MeasureTellsOptions = {},
): StructuralTellsReport {
  const normalized = text.replace(/\r\n/g, "\n");
  const spans = sentenceSpans(normalized);
  const sentences = splitSentences(normalized);
  const totalWords = countWords(normalized);

  const counts = emptyRecord(() => 0);
  const examples = emptyRecord<string[]>(() => []);

  const hit = (id: StructuralTellId, quote: string): void => {
    counts[id] += 1;
    if (examples[id].length < MAX_EXAMPLES) examples[id].push(quote);
  };
  const hitRegex = (id: StructuralTellId, re: RegExp, quoteMatch = false): void => {
    for (const m of normalized.matchAll(re)) {
      hit(id, quoteMatch ? clip(m[0]) : quoteAt(normalized, spans, m.index));
    }
  };

  hitRegex("negativeParallelism", NEG_CONTRAST_RE);
  hitRegex("negativeParallelism", NEG_NOT_ONLY_RE);
  hitRegex("negativeParallelism", NEG_TWO_SENTENCE_RE, true);

  hitRegex("triad", COMMA_TRIAD_RE);
  for (let i = 0; i + 2 < sentences.length; i++) {
    const trio = [sentences[i]!, sentences[i + 1]!, sentences[i + 2]!];
    if (trio.some((s) => countWords(s) === 0 || countWords(s) > 6)) continue;
    const heads = trio.map((s) => s.match(/[\p{L}-]+/u)?.[0]?.toLowerCase());
    if (heads[0] && heads[0] === heads[1] && heads[1] === heads[2]) {
      hit("triad", clip(trio.join(" ")));
      i += 2;
    }
  }

  hitRegex("simile", SIMILE_RE);
  hitRegex("filterVerb", FILTER_VERB_RE);
  hitRegex("embodiedEmotion", EMBODIED_EMOTION_RE);

  for (const sentence of sentences) {
    for (const clause of sentence.split(CLAUSE_SPLIT_RE)) {
      const head = clause.trim().match(/^[\p{L}-]+/u)?.[0];
      if (head && GERUND_WORD_RE.test(head)) hit("participialClause", clip(sentence));
    }
    if (ETO_BYL_RE.test(sentence)) hit("etoBylOpener", clip(sentence));
  }

  const perThousandWords = emptyRecord(() => 0);
  for (const id of STRUCTURAL_TELL_IDS) {
    perThousandWords[id] = totalWords === 0 ? 0 : round2((counts[id] * 1000) / totalWords);
  }

  const wordySentences = sentences.map(countWords).filter((n) => n > 0);
  const shortSentenceShare =
    wordySentences.length === 0
      ? 0
      : round3(wordySentences.filter((n) => n <= 3).length / wordySentences.length);

  const narrationParagraphs = normalized
    .split(PARAGRAPH_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !DIALOGUE_LINE_RE.test(p));
  const punchParagraphShare =
    narrationParagraphs.length === 0
      ? 0
      : round3(
          narrationParagraphs.filter((p) => countWords(p) <= 6).length /
            narrationParagraphs.length,
        );

  const scenes = options.scenes ?? splitScenesForCadence(normalized, options.fallbackChunks);
  const meanWordsPerSentence = scenes.map((scene) =>
    round2(meanOf(splitSentences(scene).map(countWords).filter((n) => n > 0))),
  );
  const cadenceMean = meanOf(meanWordsPerSentence);
  const spread =
    meanWordsPerSentence.length < 2 || cadenceMean === 0
      ? 0
      : round3(
          (Math.max(...meanWordsPerSentence) - Math.min(...meanWordsPerSentence)) /
            cadenceMean,
        );

  return {
    totalWords,
    sentenceCount: wordySentences.length,
    counts,
    perThousandWords,
    examples,
    shortSentenceShare,
    punchParagraphShare,
    sceneCadence: { sceneCount: scenes.length, meanWordsPerSentence, spread },
    dialogueShare: computeDialogueShare(scenes.length > 0 ? scenes : [normalized]),
  };
}

// ─────────── Rendering ───────────

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Compact Russian block for critic prompts: measured counts with one quote each. */
export function renderStructuralTells(r: StructuralTellsReport): string {
  const lines = [
    `Структурные маркеры ИИ-прозы (измерено; всего ${r.totalWords} слов, ${r.sentenceCount} предложений; частота на 1000 слов):`,
  ];
  for (const id of STRUCTURAL_TELL_IDS) {
    const example = r.examples[id][0];
    lines.push(
      `- ${STRUCTURAL_TELL_LABELS_RU[id]}: ${r.counts[id]} (${r.perThousandWords[id]} на 1000 слов)` +
        (example ? ` — пример: «${example}»` : ""),
    );
  }
  lines.push(
    `Ритм: предложений ≤3 слов — ${pct(r.shortSentenceShare)}; абзацев-ударов ≤6 слов — ${pct(r.punchParagraphShare)}; ` +
      `разброс каденции между сценами — ${r.sceneCadence.spread} (сцен ${r.sceneCadence.sceneCount}; средняя длина предложения по сценам: ${r.sceneCadence.meanWordsPerSentence.join(", ") || "—"}).`,
  );
  lines.push(`Доля диалога: ${pct(r.dialogueShare)}.`);
  return lines.join("\n");
}

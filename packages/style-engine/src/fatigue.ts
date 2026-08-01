import { LLM_CLICHE_TOKENS_RU, type FatigueWords } from "@book-forge/shared";

// Russian-leaning baseline of LLM-tells / overused literary fillers. These are
// always-on suspect tokens; the Style Extractor adds genre/author-specific
// items on top. Shared with the prose agents' cliché rule so the writer is
// never told to avoid a word the fatigue detector ignores, or vice versa.
const BASELINE_RU_BLACKLIST: string[] = [...LLM_CLICHE_TOKENS_RU];

const BASELINE_RU_SOFT = [
  "несомненно",
  "очевидно",
  "ясно одно",
  "безусловно",
  "тем не менее",
  "впрочем",
  "так или иначе",
];

const BASELINE_EN_BLACKLIST = [
  "delve",
  "tapestry",
  "testament",
  "pivotal",
  "navigate",
  "intricate",
  "leverage",
  "underscore",
];

const BASELINE_EN_SOFT = [
  "robust",
  "seamless",
  "vibrant",
  "essential",
  "meaningful",
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[«»"'„""]/g, '"')
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean);
}

// Simple top-N overused tokens beyond stop-words. Stop-word list is
// intentionally tiny — we want fatigue across the corpus, not "и/в/на".
const RU_STOP = new Set([
  "и", "в", "на", "с", "по", "к", "у", "за", "о", "от", "из",
  "не", "но", "что", "как", "это", "то", "так", "же", "ли",
  "был", "была", "было", "были", "есть", "быть",
  "он", "она", "оно", "они", "мы", "вы", "ты", "я",
  "его", "её", "их", "мне", "тебе", "ему", "ей",
  "себя", "себе",
  "если", "когда", "потому", "хотя", "чтобы", "пока", "уже",
  "где", "куда", "там", "тут", "здесь", "вот",
  "только", "ещё", "уже", "лишь",
  "до", "над", "под", "при", "про", "через",
  "а", "или", "ни", "да", "нет",
]);

const EN_STOP = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on",
  "at", "by", "for", "with", "as", "is", "was", "were", "be", "been",
  "this", "that", "these", "those", "it", "its", "i", "you", "he",
  "she", "we", "they", "him", "her", "them", "my", "your", "our",
  "their", "his", "if", "then", "than", "so", "no", "not",
]);

export function detectFatigueWords(
  scenes: string[],
  language: string,
): FatigueWords {
  const isRu = language === "ru";
  const stop = isRu ? RU_STOP : EN_STOP;
  const baselineBlack = isRu ? BASELINE_RU_BLACKLIST : BASELINE_EN_BLACKLIST;
  const baselineSoft = isRu ? BASELINE_RU_SOFT : BASELINE_EN_SOFT;

  const counts = new Map<string, number>();
  let totalTokens = 0;
  for (const s of scenes) {
    for (const tok of tokenize(s)) {
      if (tok.length < 4) continue;
      if (stop.has(tok)) continue;
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
      totalTokens++;
    }
  }

  // Words appearing in >0.4% of tokens AND >25 times → suspect overuse.
  const threshold = Math.max(25, Math.floor(totalTokens * 0.004));
  const overused = [...counts.entries()]
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([w]) => w);

  return {
    blacklist: Array.from(new Set([...baselineBlack])),
    softWarn: Array.from(new Set([...baselineSoft, ...overused])),
  };
}

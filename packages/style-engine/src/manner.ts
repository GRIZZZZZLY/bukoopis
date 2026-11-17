// Port of manner_line (D:\models\work\build_pairs.py) and its counters (corpus_measure.py).
// Output must match the Python original: the fine-tuned model was trained on this exact line.

const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
// Not metrics.ts splitSentences: its quote class has '' where Python has '’.
const SENT = /[.!?…]+["»'’)\]]*\s+|\n+/u;
const DIALOGUE = /^\s*[—–-]\s*\S/u;
const SAY =
  /(?<![\p{L}\p{N}])(сказал|сказала|ответил|ответила|спросил|спросила|согласился|согласилась|сообщил|сообщила|повторил|повторила)(?![\p{L}\p{N}])/u;
const FIRST_PERSON =
  /(?<![\p{L}\p{N}])(я|меня|мне|мной|мою|мой|моя|моё|мои)(?![\p{L}\p{N}])/giu;

const words = (t: string): number => (t.match(WORD) ?? []).length;
const sum = (a: number[]): number => a.reduce((s, n) => s + n, 0);
const isReply = (p: string): boolean => /^[—–]/u.test(p.trim());

/** Python's round(): half to even. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function sentLens(paras: string[]): number[] {
  const out: number[] = [];
  for (const p of paras) for (const s of p.split(SENT)) {
    const n = words(s);
    if (n > 0) out.push(n);
  }
  return out;
}

/** Measured manner of the scene; paragraphs separated by "\n\n". */
export function mannerLine(text: string): string {
  const paras = text.split("\n\n").filter((p) => p.trim());
  const lens = sentLens(paras);
  const mean = sum(lens) / Math.max(1, lens.length);
  const total = sum(paras.map(words));
  const dlgWords = sum(paras.filter((p) => DIALOGUE.test(p)).map(words));
  const dlg = dlgWords / Math.max(1, total);

  const replies = paras.filter(isReply).map((p) => ({ n: words(p), said: SAY.test(p) }));
  const narr = paras.filter((p) => !isReply(p)).join(" ");
  const nw = words(narr);
  const first = nw > 0 && ((narr.match(FIRST_PERSON) ?? []).length * 100) / nw >= 1.0;

  let line = `Манера: повествование от ${first ? "первого" : "третьего"} лица, предложения в среднем ${roundHalfEven(mean)} слов, реплики ${5 * roundHalfEven(dlg * 20)}% текста`;
  if (replies.length >= 3) {
    line += `, реплика в среднем ${roundHalfEven(sum(replies.map((r) => r.n)) / replies.length)} слов`;
    line += `, с подписью «сказал» ${10 * roundHalfEven((replies.filter((r) => r.said).length / replies.length) * 10)}% реплик`;
  }
  return line;
}

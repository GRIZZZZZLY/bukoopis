export interface Chunk {
  text: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

// Russian-leaning approximation: 1 token ~ 0.6 words; we use word-count as a
// cheap proxy. If you wire @anthropic-ai/tokenizer later, swap this.
function approxTokenCount(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 0.6);
}

// Split into paragraphs first, then pack paragraphs into windows of ~targetTokens
// with ~overlapTokens of overlap between consecutive windows.
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? 600;
  const overlap = opts.overlapTokens ?? 100;
  if (!text.trim()) return [];

  // Split on blank lines (paragraphs). Keep absolute offsets.
  const paragraphs: { text: string; start: number; end: number }[] = [];
  const re = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    paragraphs.push({
      text: m[0].trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  if (paragraphs.length === 0) return [];

  const tokenCounts = paragraphs.map((p) => approxTokenCount(p.text));
  const chunks: Chunk[] = [];

  let i = 0;
  while (i < paragraphs.length) {
    let cumulative = 0;
    let j = i;
    while (j < paragraphs.length && cumulative + tokenCounts[j]! <= target) {
      cumulative += tokenCounts[j]!;
      j++;
    }
    if (j === i) {
      // Single paragraph already exceeds target — keep it as one chunk.
      j = i + 1;
      cumulative = tokenCounts[i]!;
    }

    const slice = paragraphs.slice(i, j);
    chunks.push({
      text: slice.map((p) => p.text).join("\n\n"),
      startOffset: slice[0]!.start,
      endOffset: slice[slice.length - 1]!.end,
      tokenCount: cumulative,
    });

    // Move forward, leaving overlap behind.
    let back = 0;
    let k = j - 1;
    while (k > i && back < overlap) {
      back += tokenCounts[k]!;
      k--;
    }
    const next = Math.max(i + 1, k + 1);
    if (next <= i) break;
    i = next;
  }

  return chunks;
}

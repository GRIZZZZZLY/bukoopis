// Embedding provider. MVP ships with a deterministic local stub that produces
// reproducible 384-dim vectors via FNV-1a hashing across word n-grams. This
// makes vector search behave consistently for tests/dev without network calls.
//
// When the user wires a real provider (voyage-3-lite / text-embedding-3-small),
// swap `getEmbeddingProvider()` to return the network-backed implementation.

export const EMBEDDING_DIM = 384;

export interface EmbeddingProvider {
  name: string;
  dim: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return tokens.slice();
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

// Produce a deterministic 384-dim float vector from text. Sums hashed n-grams
// across positions (mimics bag-of-words + bigrams), then L2-normalizes.
function stubEmbed(text: string): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  const tokens = tokenize(text);
  const features = [...tokens, ...ngrams(tokens, 2)];
  if (features.length === 0) return v;
  for (const f of features) {
    const h = fnv1a(f);
    const idx = h % EMBEDDING_DIM;
    const sign = (h >> 31) & 1 ? -1 : 1;
    v[idx]! += sign;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= norm;
  return v;
}

export const stubProvider: EmbeddingProvider = {
  name: "stub-fnv1a-bigram",
  dim: EMBEDDING_DIM,
  async embed(text) {
    return stubEmbed(text);
  },
  async embedBatch(texts) {
    return texts.map(stubEmbed);
  },
};

let active: EmbeddingProvider = stubProvider;

export function getEmbeddingProvider(): EmbeddingProvider {
  return active;
}

export function setEmbeddingProvider(p: EmbeddingProvider): void {
  active = p;
}

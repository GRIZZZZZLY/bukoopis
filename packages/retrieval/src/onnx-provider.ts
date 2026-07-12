import { homedir } from "node:os";
import { join } from "node:path";
import { EMBEDDING_DIM, type EmbeddingProvider } from "./embeddings.js";

// Local ONNX sentence-embedding provider (real semantics, no network at query
// time, no external API key). Runs via transformers.js on onnxruntime-node.
//
// Default model: paraphrase-multilingual-MiniLM-L12-v2 — 384-dim (matches
// EMBEDDING_DIM, so the sqlite-vec tables need no schema change), multilingual
// incl. Russian, and *symmetric* (query and document use the same encoding),
// which fits our single `embed()` interface. Asymmetric models like e5 want
// "query:"/"passage:" prefixes we can't express here, so avoid them.
//
// The model (~120MB) is downloaded and cached on first use by transformers.js
// (cache dir configurable via HF_HOME / TRANSFORMERS_CACHE). transformers.js is
// imported lazily so the retrieval package stays importable (and tests keep the
// deterministic stub) without pulling onnxruntime.

const DEFAULT_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

type FeatureExtractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

export function createOnnxEmbeddingProvider(
  modelId: string = DEFAULT_MODEL,
): EmbeddingProvider {
  let extractorPromise: Promise<FeatureExtractor> | null = null;
  let warnedLoadFailure = false;

  async function getExtractor(): Promise<FeatureExtractor> {
    if (!extractorPromise) {
      extractorPromise = (async () => {
        // String-typed specifier so `tsc` doesn't resolve (and thus require)
        // the package at typecheck time — it's only needed at runtime.
        const specifier: string = "@huggingface/transformers";
        const mod = (await import(specifier)) as {
          pipeline: (task: string, model: string) => Promise<FeatureExtractor>;
          env: { cacheDir: string };
        };
        // Cache the model OUTSIDE node_modules: the default (.cache inside the
        // pnpm store) is wiped on reinstall and can be unreadable by
        // onnxruntime-node on Windows (EACCES). A stable home-dir cache is
        // writable and survives installs. Override with TRANSFORMERS_CACHE.
        mod.env.cacheDir =
          process.env.TRANSFORMERS_CACHE ??
          join(homedir(), ".cache", "book-forge-transformers");
        return mod.pipeline("feature-extraction", modelId);
      })().catch((e) => {
        // Reset so a transient failure (e.g. download hiccup) can be retried.
        extractorPromise = null;
        // Surface the degradation once — callers swallow the throw (search and
        // indexing fall back to lexical/FTS), so without this it's invisible.
        if (!warnedLoadFailure) {
          warnedLoadFailure = true;
          console.warn(
            `[onnx-embeddings] failed to load model ${modelId} — semantic search falls back to lexical (FTS). ` +
              `Ensure the model is cached/reachable (TRANSFORMERS_CACHE), or set EMBEDDING_PROVIDER=stub. Reason:`,
            e instanceof Error ? e.message : e,
          );
        }
        throw e;
      });
    }
    return extractorPromise;
  }

  function toVec(row: number[] | undefined): Float32Array {
    if (!row || row.length !== EMBEDDING_DIM) {
      throw new Error(
        `[onnx-embeddings] model ${modelId} produced ${row?.length ?? 0}-dim vector, expected ${EMBEDDING_DIM}. ` +
          `Pick a ${EMBEDDING_DIM}-dim model or migrate the vec tables.`,
      );
    }
    return Float32Array.from(row);
  }

  return {
    name: `onnx:${modelId}`,
    dim: EMBEDDING_DIM,
    async embed(text) {
      const extractor = await getExtractor();
      const out = await extractor(text, { pooling: "mean", normalize: true });
      return toVec(out.tolist()[0]);
    },
    async embedBatch(texts) {
      if (texts.length === 0) return [];
      const extractor = await getExtractor();
      const out = await extractor(texts, { pooling: "mean", normalize: true });
      return out.tolist().map((row) => toVec(row));
    },
  };
}

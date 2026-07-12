import {
  createOnnxEmbeddingProvider,
  getEmbeddingProvider,
  setEmbeddingProvider,
} from "@book-forge/retrieval";

/**
 * Select the runtime embedding provider from env and install it globally.
 *
 * - `EMBEDDING_PROVIDER=stub`  → keep the deterministic FNV-1a stub
 *   (lexical-only; used by tests and offline dev without the ONNX model).
 * - anything else (default)    → real local ONNX sentence embeddings.
 *   Override the model with `EMBEDDING_MODEL`.
 *
 * The stub remains the module default in `@book-forge/retrieval`, so unit tests
 * that import the package directly are unaffected — only the server boot (and
 * the reindex script) switch to ONNX.
 *
 * Returns the active provider's name for logging.
 */
export function configureEmbeddingProvider(): string {
  const mode = process.env.EMBEDDING_PROVIDER ?? "onnx";
  if (mode === "stub") {
    return getEmbeddingProvider().name;
  }
  const provider = createOnnxEmbeddingProvider(process.env.EMBEDDING_MODEL);
  setEmbeddingProvider(provider);
  return provider.name;
}

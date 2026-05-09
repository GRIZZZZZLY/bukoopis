export { chunkText, type Chunk, type ChunkOptions } from "./chunker.js";
export {
  EMBEDDING_DIM,
  stubProvider,
  getEmbeddingProvider,
  setEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings.js";
export {
  indexChapterVersion,
  type IndexChapterVersionInput,
} from "./index-pipeline.js";
export { hybridSearch, type SearchHit, type SearchOptions } from "./search.js";

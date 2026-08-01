import "dotenv/config";
import { serve } from "@hono/node-server";
import { registerAllAgentContracts } from "@book-forge/agents/bootstrap";
import {
  registerStyleExtractorContract,
  registerStyleBlenderContract,
} from "@book-forge/style-engine";
import { assertAllStructuredAgentsHaveContracts } from "@book-forge/llm";
import { createApp } from "./app.js";
import { configureEmbeddingProvider } from "./utils/embedding-setup.js";

// Register every structured-output agent contract before the app boots so
// `dispatchStructured` can resolve them. The assert verifies that every
// agent listed in STRUCTURED_AGENT_NAMES actually has a registration.
// style_extractor and style_blender live in @book-forge/style-engine (separate
// workspace package), so their register calls are wired here at the server
// boundary.
registerAllAgentContracts();
registerStyleExtractorContract();
registerStyleBlenderContract();
assertAllStructuredAgentsHaveContracts();

// Install the real (local ONNX) embedding provider for retrieval. The model is
// loaded lazily on first embed; set EMBEDDING_PROVIDER=stub to skip it.
const embeddingProvider = configureEmbeddingProvider();
console.log(`🧬 embeddings: ${embeddingProvider}`);

const { app } = createApp();
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ server listening on http://localhost:${info.port}`);
});

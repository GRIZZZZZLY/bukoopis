import "dotenv/config";
import { serve } from "@hono/node-server";
import { registerAllAgentContracts } from "@book-forge/agents/bootstrap";
import { assertAllStructuredAgentsHaveContracts } from "@book-forge/llm";
import { createApp } from "./app.js";

// Register every structured-output agent contract before the app boots so
// `dispatchStructured` can resolve them. The assert verifies that every
// agent listed in STRUCTURED_AGENT_NAMES actually has a registration.
registerAllAgentContracts();
assertAllStructuredAgentsHaveContracts();

const { app } = createApp();
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`✅ server listening on http://localhost:${info.port}`);
});

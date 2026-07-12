import { Hono } from "hono";
import { createDb, resolveDbPath } from "./db/client.js";
import { createHealthRoute } from "./routes/health.js";
import { createBooksRoute } from "./routes/books.js";
import { createChaptersRoute } from "./routes/chapters.js";
import { createPlotRoute } from "./routes/plot.js";
import { createRetrievalRoute } from "./routes/retrieval.js";
import { createImportExportRoute } from "./routes/import-export.js";
import { createEntitiesRoute } from "./routes/entities.js";
import { createCritiqueRoute } from "./routes/critique.js";
import { createInlineRoute } from "./routes/inline.js";
import { createStyleRoute } from "./routes/style.js";
import { createUsageRoute } from "./routes/usage.js";
import { createWritingProgressRoute } from "./routes/writing-progress.js";
import { createCanonExtractionRoute } from "./routes/canon-extraction.js";
import { createStudioRoute } from "./routes/studio.js";
import { startMemoryWorker, type MemoryWorker } from "./utils/memory-worker.js";

export interface AppHandle {
  app: Hono;
  close: () => void;
  /** ADR 0002 — durable memory pipeline worker (tests use drain()). */
  memoryWorker: MemoryWorker;
}

export function createApp(dbPath: string = resolveDbPath()): AppHandle {
  const { sqlite, hasVec } = createDb(dbPath);
  const memoryWorker = startMemoryWorker(sqlite, hasVec);
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });

  app.route("/api/health", createHealthRoute({ sqlite, hasVec }));
  // Mounted before /api/books: GET /api/books/recommended must not be shadowed by books' GET /:id.
  app.route("/api", createStudioRoute(sqlite));
  app.route("/api/books", createBooksRoute(sqlite, memoryWorker));
  app.route("/api/chapters", createChaptersRoute(sqlite, memoryWorker));
  app.route("/api", createPlotRoute(sqlite, hasVec, memoryWorker));
  app.route("/api", createRetrievalRoute(sqlite, hasVec));
  app.route("/api", createImportExportRoute(sqlite, hasVec));
  app.route("/api", createEntitiesRoute(sqlite));
  app.route("/api", createCritiqueRoute(sqlite, memoryWorker));
  app.route("/api", createInlineRoute(sqlite));
  app.route("/api", createStyleRoute(sqlite));
  app.route("/api", createUsageRoute(sqlite));
  app.route("/api", createWritingProgressRoute(sqlite));
  app.route("/api", createCanonExtractionRoute(sqlite));

  return {
    app,
    memoryWorker,
    close: () => {
      memoryWorker.stop();
      sqlite.close();
    },
  };
}

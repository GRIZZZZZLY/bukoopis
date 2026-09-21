import { Hono } from "hono";
import { z, ZodError } from "zod";
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
import { createProposalsRoute } from "./routes/proposals.js";
import { createChatRoute } from "./routes/chat.js";
import { startMemoryWorker, type MemoryWorker } from "./utils/memory-worker.js";
import { createProposalCancelRegistry } from "./utils/proposal-cancel.js";
import {
  recoverStaleCritiqueReports,
  recoverStaleProseProposals,
} from "./utils/critique-recovery.js";

export interface AppHandle {
  app: Hono;
  close: () => void;
  /** ADR 0002 — durable memory pipeline worker (tests use drain()). */
  memoryWorker: MemoryWorker;
}

export function createApp(dbPath: string = resolveDbPath()): AppHandle {
  const { sqlite, hasVec } = createDb(dbPath);
  // Отчёты критики, застрявшие в `pending` от прошлого запуска: писать их
  // больше некому, и вечное «критика идёт» хуже честной ошибки (В13).
  const staleReports = recoverStaleCritiqueReports(sqlite);
  if (staleReports > 0) {
    console.warn(
      `[critique] ${staleReports} отчёт(ов) остались от прошлого запуска — помечены ошибкой`,
    );
  }
  // Кандидаты прозы, оставшиеся в `streaming` от прошлого запуска: писать в
  // них некому, а экран их не показывает — автор платит за второй прогон
  // того же текста (С8).
  const staleProposals = recoverStaleProseProposals(sqlite);
  if (staleProposals > 0) {
    console.warn(
      `[proposals] ${staleProposals} кандидат(ов) остались от прошлого запуска — помечены ошибкой`,
    );
  }
  const memoryWorker = startMemoryWorker(sqlite, hasVec);
  // Один реестр на процесс: его смотрит генерация и правка, а маршрут отмены
  // в него пишет.
  const proposalCancels = createProposalCancelRegistry();
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

  // Global safety net: any error thrown out of a route becomes a structured
  // 500 instead of a bare crash. Validation/404 helpers already return their
  // own envelopes; this catches the unexpected (e.g. a synchronous DB throw).
  app.onError((err, c) => {
    console.error("[app] unhandled route error:", err);
    // Негодные данные — это 400 с причиной, а не «internal_error». Схема,
    // брошенная из маршрута (испорченный studio_state, кривой профиль),
    // приходила автору как «HTTP 500: internal_error» — сообщение, по
    // которому нельзя понять ни что случилось, ни что делать.
    if (err instanceof ZodError) {
      return c.json(
        {
          error: "validation_failed",
          details: z.treeifyError(err),
        },
        400,
      );
    }
    return c.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  });

  app.route("/api/health", createHealthRoute({ sqlite, hasVec }));
  // Mounted before /api/books: GET /api/books/recommended must not be shadowed by books' GET /:id.
  app.route("/api", createStudioRoute(sqlite, hasVec));
  app.route("/api/books", createBooksRoute(sqlite, memoryWorker));
  app.route("/api/chapters", createChaptersRoute(sqlite, memoryWorker));
  app.route("/api", createPlotRoute(sqlite, hasVec, proposalCancels, memoryWorker));
  app.route("/api", createRetrievalRoute(sqlite, hasVec));
  app.route("/api", createImportExportRoute(sqlite, hasVec));
  app.route("/api", createEntitiesRoute(sqlite));
  app.route("/api", createCritiqueRoute(sqlite, hasVec, proposalCancels, memoryWorker));
  app.route("/api", createInlineRoute(sqlite));
  app.route("/api", createStyleRoute(sqlite));
  app.route("/api", createUsageRoute(sqlite));
  app.route("/api", createWritingProgressRoute(sqlite));
  app.route("/api", createCanonExtractionRoute(sqlite));
  app.route("/api", createProposalsRoute(sqlite, proposalCancels, memoryWorker));
  app.route("/api", createChatRoute(sqlite, hasVec));

  return {
    app,
    memoryWorker,
    close: () => {
      memoryWorker.stop();
      sqlite.close();
    },
  };
}

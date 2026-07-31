import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  generateBookOutlineInputSchema,
  selectBookOutlineInputSchema,
  generateChapterPlanInputSchema,
  selectChapterPlanInputSchema,
  writeChapterInputSchema,
  type BookOutline,
  type ChapterPlan,
} from "@book-forge/shared";
import {
  runBookPlanning,
  runChapterPlan,
  runChapterWriter,
  gatherCharacterContext,
  characterContextToPrompt,
  gatherLoreContext,
  loreContextToPrompt,
} from "@book-forge/agents";
import { loadStyleContext } from "../utils/style-context.js";
import {
  loadStudioContext,
  studioContextToPrompt,
} from "../utils/studio-context.js";
import { gatherRetrievedChunks } from "../utils/chapter-retrieval.js";
import {
  loadRollingChapterContext,
  ROLLING_WINDOW,
} from "../utils/rolling-context.js";
import {
  compileContext,
  describeCompiledContext,
} from "../utils/context-compiler.js";
import {
  loadPovKnowledge,
  renderPovKnowledgePrompt,
} from "../utils/pov-context.js";
import { renderActiveFactsPrompt } from "../utils/book-facts.js";
import {
  gatherRelevantNotes,
  renderOpenNotesPrompt,
} from "../utils/book-notes.js";
import { logUsage } from "../utils/usageLogger.js";
import { triggerCanonExtractionAfterWriter } from "./canon-extraction.js";
import {
  enqueueMemoryJobs,
  COMMIT_JOB_KINDS,
} from "../utils/memory-queue.js";
import { markMemoryStaleOnCommit } from "../utils/memory-activation.js";
import type { MemoryWorker } from "../utils/memory-worker.js";
import {
  toBook,
  toChapter,
  toVersion,
  type BookRow,
  type ChapterRow,
  type ChapterVersionRow,
} from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { extractText, countWords } from "../utils/prosemirror.js";
import { EMPTY_DOC } from "@book-forge/shared";

interface BookContext {
  title: string;
  premise: string;
  language: string;
  outlineSelected: string | null;
  styleProfileId: number | null;
  writerModel: "sonnet" | "opus";
  plotModel: "sonnet" | "opus";
  criticModel: "sonnet" | "opus";
  writerProvider: "anthropic" | "ollama";
  writerLocalModel: string | null;
}

function loadBookContext(
  sqlite: DatabaseType,
  bookId: number,
): BookContext | null {
  const row = sqlite
    .prepare("SELECT * FROM books WHERE id = ?")
    .get(bookId) as BookRow | undefined;
  if (!row) return null;
  let outlineSelected: string | null = null;
  if (row.outline_json) {
    try {
      const parsed = JSON.parse(row.outline_json) as BookOutline;
      if (
        parsed.selectedIndex !== null &&
        parsed.variants[parsed.selectedIndex]
      ) {
        outlineSelected = JSON.stringify(parsed.variants[parsed.selectedIndex]);
      }
    } catch {
      /* ignore corrupt outline */
    }
  }
  return {
    title: row.title,
    premise: row.premise ?? "(премиса не задана)",
    language: row.language,
    outlineSelected,
    styleProfileId: row.style_profile_id,
    writerModel: row.writer_model as "sonnet" | "opus",
    plotModel: row.plot_model as "sonnet" | "opus",
    criticModel: row.critic_model as "sonnet" | "opus",
    writerProvider: (row.writer_provider as "anthropic" | "ollama") ?? "anthropic",
    writerLocalModel: row.writer_local_model,
  };
}

// Phase 2: previous-chapters context moved to ../utils/rolling-context.ts
// (loadRollingChapterContext — bounded rolling window + meta-summary).

// ADR 0003 slice 3: hard cap on assembled Writer context (trimmable layers,
// excludes the always-sent beat-sheet + book premise/outline). Generous — the
// point is a safety ceiling on very long books + Context Inspector visibility,
// not aggressive trimming of normal chapters.
const MAX_WRITER_CONTEXT_TOKENS = 80_000;

export function createPlotRoute(
  sqlite: DatabaseType,
  hasVec: boolean,
  memoryWorker?: Pick<MemoryWorker, "kick">,
): Hono {
  const r = new Hono();

  // ───────── Book outline ─────────

  r.post("/books/:id/outline", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateBookOutlineInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const ctx = loadBookContext(sqlite, id);
    if (!ctx) return notFound(c, "book");
    if (!ctx.premise || ctx.premise === "(премиса не задана)") {
      return badRequest(c, "premise required to generate outline");
    }

    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, id));
    const variants = await runBookPlanning({
      bookTitle: ctx.title,
      premise: ctx.premise,
      language: ctx.language,
      ...(studioCtx !== null ? { studioContext: studioCtx } : {}),
      config: { variants: 2, ...parsed.data.config, model: parsed.data.config?.model ?? ctx.plotModel },
      onUsage: (usage) =>
        logUsage(sqlite, {
          route: "plot.book_outline",
          model: usage.modelId,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
          },
          bookId: id,
        }),
    });

    const outline: BookOutline = {
      variants,
      selectedIndex: null,
      generatedAt: new Date().toISOString(),
    };
    const now = new Date().toISOString();
    sqlite
      .prepare("UPDATE books SET outline_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(outline), now, id);
    return c.json(outline);
  });

  r.post("/books/:id/outline/select", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = selectBookOutlineInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const row = sqlite
      .prepare("SELECT outline_json FROM books WHERE id = ?")
      .get(id) as { outline_json: string | null } | undefined;
    if (!row) return notFound(c, "book");
    if (!row.outline_json) return badRequest(c, "no outline generated yet");
    const outline = JSON.parse(row.outline_json) as BookOutline;
    if (!outline.variants[parsed.data.selectedIndex]) {
      return badRequest(c, "selectedIndex out of range");
    }
    outline.selectedIndex = parsed.data.selectedIndex;
    const now = new Date().toISOString();
    sqlite
      .prepare("UPDATE books SET outline_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(outline), now, id);
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow;
    return c.json(toBook(book));
  });

  // ───────── Chapter plan ─────────

  r.post("/chapters/:id/plan", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = generateChapterPlanInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const ctx = loadBookContext(sqlite, ch.book_id);
    if (!ctx) return notFound(c, "book");

    const prevSummary = loadRollingChapterContext(
      sqlite,
      ch.book_id,
      ch.order_index,
    );

    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, ch.book_id));
    const planRetrieved = await gatherRetrievedChunks(sqlite, {
      bookId: ch.book_id,
      queryText: `${ch.title}\n${parsed.data.intent}`,
      currentChapterOrder: ch.order_index,
      hasVec,
      // ADR 0003 slice 3: don't re-surface chapters the rolling window already
      // gives the plotter verbatim.
      excludeFromChapterOrder: ch.order_index - ROLLING_WINDOW,
    });
    const planNotes = await gatherRelevantNotes(
      sqlite,
      ch.book_id,
      `${ch.title}\n${parsed.data.intent}`,
      ch.order_index,
    );
    const planOpenThreads = renderOpenNotesPrompt(
      planNotes,
      "Открытые линии",
      ch.order_index,
    );
    const variants = await runChapterPlan({
      bookTitle: ctx.title,
      bookPremise: ctx.premise,
      bookOutline: ctx.outlineSelected,
      chapterTitle: ch.title,
      intent: parsed.data.intent,
      previousChaptersSummary: prevSummary,
      ...(studioCtx !== null ? { studioContext: studioCtx } : {}),
      ...(planRetrieved.promptBlock !== null
        ? { retrievedContext: planRetrieved.promptBlock }
        : {}),
      ...(planOpenThreads !== null ? { openThreads: planOpenThreads } : {}),
      config: { variants: 2, ...parsed.data.config, model: parsed.data.config?.model ?? ctx.plotModel },
      onUsage: (usage) =>
        logUsage(sqlite, {
          route: "plot.chapter_plan",
          model: usage.modelId,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
        }),
    });

    const plan: ChapterPlan = {
      variants,
      selectedIndex: null,
      generatedAt: new Date().toISOString(),
    };
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE chapters SET plan_json = ?, intent = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(plan), parsed.data.intent, now, id);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(now, ch.book_id);
    return c.json(plan);
  });

  r.post("/chapters/:id/plan/select", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = selectChapterPlanInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const row = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!row) return notFound(c, "chapter");
    if (!row.plan_json) return badRequest(c, "no plan generated yet");
    const plan = JSON.parse(row.plan_json) as ChapterPlan;
    if (!plan.variants[parsed.data.selectedIndex]) {
      return badRequest(c, "selectedIndex out of range");
    }
    plan.selectedIndex = parsed.data.selectedIndex;
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "UPDATE chapters SET plan_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(JSON.stringify(plan), now, id);
    sqlite
      .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
      .run(now, row.book_id);
    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow;
    return c.json(toChapter(ch));
  });

  // ───────── Writer (SSE streaming) ─────────

  r.post("/chapters/:id/write", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = writeChapterInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    if (!ch.plan_json) return badRequest(c, "no plan available");
    const plan = JSON.parse(ch.plan_json) as ChapterPlan;
    if (plan.selectedIndex === null) {
      return badRequest(c, "no plan variant selected");
    }
    const beatSheet = plan.variants[plan.selectedIndex];
    if (!beatSheet) return badRequest(c, "selected plan variant missing");

    const ctx = loadBookContext(sqlite, ch.book_id);
    if (!ctx) return notFound(c, "book");
    const prevSummary = loadRollingChapterContext(
      sqlite,
      ch.book_id,
      ch.order_index,
    );

    // Build character + lore context from intent / plan / previous chapters.
    // Etap 3: knowledge nodes (deterministic, no LLM call).
    const beatBlob = beatSheet.beats
      .map((b) => `${b.summary} ${b.goal} ${b.conflict} ${b.outcome}`)
      .join("\n");
    const contextTexts = [
      ch.intent,
      ctx.title,
      ctx.premise,
      ctx.outlineSelected,
      beatSheet.pov,
      beatSheet.emotionalGoal,
      beatBlob,
      prevSummary,
    ];
    const charResult = gatherCharacterContext(sqlite, ch.book_id, contextTexts);
    const charNameById = new Map(
      charResult.characters.map((cc) => [cc.character.id, cc.character.canonicalName]),
    );
    const characterContext =
      charResult.characters.length > 0
        ? characterContextToPrompt(charResult, charNameById)
        : null;
    const loreResult = gatherLoreContext(
      sqlite,
      ch.book_id,
      contextTexts,
      ch.order_index,
    );
    const loreContext =
      loreResult.locations.length > 0 ||
      loreResult.items.length > 0 ||
      loreResult.openHooks.length > 0
        ? loreContextToPrompt(loreResult)
        : null;

    // Phase 3: temporal canon facts for the entities in this scene. Injected
    // at the route layer (not inside gatherCharacterContext) to keep the
    // agents package free of the server-only book_facts table.
    const factEntityNames = [
      ...charResult.characters.map((cc) => cc.character.canonicalName),
      ...loreResult.locations.map((l) => l.name),
      ...loreResult.items.map((i) => i.name),
    ];
    const factsPrompt = renderActiveFactsPrompt(
      sqlite,
      ch.book_id,
      ch.order_index,
      factEntityNames.length > 0
        ? { entityNames: factEntityNames }
        : undefined,
    );
    const characterContextFinal =
      factsPrompt !== null
        ? `${characterContext ? `${characterContext}\n\n` : ""}${factsPrompt}`
        : characterContext;

    const styleCtx = loadStyleContext(sqlite, ctx.styleProfileId);
    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, ch.book_id));
    const writerRetrieved = await gatherRetrievedChunks(sqlite, {
      bookId: ch.book_id,
      queryText: beatBlob,
      currentChapterOrder: ch.order_index,
      hasVec,
      // ADR 0003 slice 3: don't retrieve chunks from chapters the rolling
      // window already injects verbatim (dedup).
      excludeFromChapterOrder: ch.order_index - ROLLING_WINDOW,
    });

    // ADR 0003 slice 3b: what the POV character knows so far (POV guard).
    const povKnowledge = renderPovKnowledgePrompt(
      loadPovKnowledge(sqlite, ch.book_id, beatSheet.pov, ch.order_index),
    );

    // ADR 0003 slice 3: bound the assembled context under a token budget and
    // log what was included/dropped (Context Inspector). The beat-sheet is
    // always sent (passed separately); these are the trimmable layers.
    const compiled = compileContext(
      [
        { id: "characters", text: characterContextFinal, priority: 1 },
        { id: "pov", text: povKnowledge, priority: 1 },
        { id: "rolling", text: prevSummary, priority: 2 },
        { id: "lore", text: loreContext, priority: 3 },
        { id: "studio", text: studioCtx, priority: 4 },
        { id: "retrieval", text: writerRetrieved.promptBlock, priority: 5 },
        { id: "style", text: styleCtx.prompt, priority: 6 },
      ],
      { maxTokens: MAX_WRITER_CONTEXT_TOKENS },
    );
    console.warn(describeCompiledContext(compiled, `writer ch#${ch.order_index}`));
    const inc = new Set(compiled.includedIds);

    return streamSSE(c, async (stream) => {
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      let modelId = "";
      try {
        const gen = runChapterWriter({
          bookTitle: ctx.title,
          bookPremise: ctx.premise,
          bookOutline: ctx.outlineSelected,
          chapterTitle: ch.title,
          beatSheet,
          previousChaptersSummary: inc.has("rolling") ? prevSummary : null,
          characterContext: inc.has("characters") ? characterContextFinal : null,
          povKnowledge: inc.has("pov") ? povKnowledge : null,
          loreContext: inc.has("lore") ? loreContext : null,
          styleContext: inc.has("style") ? styleCtx.prompt : null,
          studioContext: inc.has("studio") ? studioCtx : null,
          retrievedContext: inc.has("retrieval")
            ? writerRetrieved.promptBlock
            : null,
          fatigueWords: styleCtx.fatigueBlacklist,
          config: { variants: 1, ...parsed.data.config, model: parsed.data.config?.model ?? ctx.writerModel },
          provider: ctx.writerProvider,
          ...(ctx.writerLocalModel
            ? { localModelTag: ctx.writerLocalModel }
            : {}),
        });
        while (true) {
          const next = await gen.next();
          if (next.done) {
            fullText = next.value.text;
            modelId = next.value.modelId;
            inputTokens = next.value.tokens.input;
            outputTokens = next.value.tokens.output;
            cacheCreationTokens = next.value.tokens.cacheCreation;
            cacheReadTokens = next.value.tokens.cacheRead;
            break;
          }
          await stream.writeSSE({
            event: "chunk",
            data: JSON.stringify({ text: next.value }),
          });
        }

        // Persist version
        const contentJson = JSON.stringify(prosePlainTextToProseMirror(fullText));
        const wordCount = countWords(fullText);
        const now = new Date().toISOString();
        const parentVersionId = ch.current_version_id;
        const tx = sqlite.transaction(() => {
          const info = sqlite
            .prepare(
              `INSERT INTO chapter_versions
               (chapter_id, parent_version_id, content_json, content_text, word_count, source, created_at)
               VALUES (?, ?, ?, ?, ?, 'agent', ?)`,
            )
            .run(id, parentVersionId, contentJson, fullText, wordCount, now);
          const versionId = Number(info.lastInsertRowid);
          sqlite
            .prepare(
              "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
            )
            .run(versionId, now, id);
          sqlite
            .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
            .run(now, ch.book_id);
          // ADR 0002: writer output is a deliberate commit — version row and
          // memory jobs are created atomically; the durable worker handles
          // index/summary/facts/notes asynchronously.
          enqueueMemoryJobs(sqlite, {
            bookId: ch.book_id,
            chapterId: ch.id,
            chapterVersionId: versionId,
            kinds: COMMIT_JOB_KINDS,
          });
          markMemoryStaleOnCommit(sqlite, ch.book_id, ch.order_index);
          // Writer output replaces the editor content — drop the stale draft.
          sqlite
            .prepare("DELETE FROM chapter_drafts WHERE chapter_id = ?")
            .run(ch.id);
          return versionId;
        });
        const versionId = tx();
        const v = sqlite
          .prepare("SELECT * FROM chapter_versions WHERE id = ?")
          .get(versionId) as ChapterVersionRow;
        memoryWorker?.kick();

        logUsage(sqlite, {
          route: "writer.chapter",
          model: modelId,
          usage: {
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheCreationTokens,
            cacheReadInputTokens: cacheReadTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
          versionId,
        });

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            version: toVersion(v),
            tokens: {
              input: inputTokens,
              output: outputTokens,
              cacheCreation: cacheCreationTokens,
              cacheRead: cacheReadTokens,
            },
          }),
        });

        // Fire-and-forget canon extraction. Frontend polls for the snapshot.
        // (Separate UI feature — memory summary/facts/notes now flow through
        // the durable memory_jobs queue enqueued in the commit tx above.)
        void triggerCanonExtractionAfterWriter(sqlite, ch.id);
      } catch (e) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            message: e instanceof Error ? e.message : String(e),
          }),
        });
      }
    });
  });

  return r;
}

// Convert plain prose text (paragraph-separated) to ProseMirror doc JSON.
function prosePlainTextToProseMirror(text: string): unknown {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return EMPTY_DOC;
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    })),
  };
}

// Suppress unused import warning if extractText isn't used here
void extractText;

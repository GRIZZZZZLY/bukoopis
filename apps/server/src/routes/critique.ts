import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  runCritiqueInputSchema,
  runRepairInputSchema,
  fullCritiqueReportSchema,
  REPAIR_BRANCH_PREFIX,
  REPAIR_MAX_ITERATIONS,
  type CritiqueReport,
  type CritiqueReportStatus,
  type FullCritiqueReport,
} from "@book-forge/shared";
import {
  runCritique,
  reviseChapter,
  gatherCharacterContext,
  characterContextToPrompt,
  gatherLoreContext,
  loreContextToPrompt,
  type CriticInput,
} from "@book-forge/agents";
import { extractText, countWords } from "../utils/prosemirror.js";
import { indexChapterVersion } from "@book-forge/retrieval";
import { toVersion } from "../db/rows.js";
import { loadStyleContext } from "../utils/style-context.js";
import { logUsage } from "../utils/usageLogger.js";
import type {
  ChapterRow,
  ChapterVersionRow,
  BookRow,
} from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";

interface CritiqueReportRow {
  id: number;
  chapter_version_id: number;
  status: string;
  report_json: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

function toReport(row: CritiqueReportRow): CritiqueReport {
  let report: FullCritiqueReport | null = null;
  if (row.report_json) {
    try {
      report = fullCritiqueReportSchema.parse(JSON.parse(row.report_json));
    } catch {
      // tolerate malformed legacy rows by surfacing null + error_message
    }
  }
  return {
    id: row.id,
    chapterVersionId: row.chapter_version_id,
    status: row.status as CritiqueReportStatus,
    report,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function countRepairAncestors(
  sqlite: DatabaseType,
  versionId: number,
): number {
  let count = 0;
  let cursor: number | null = versionId;
  const seen = new Set<number>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const row = sqlite
      .prepare(
        "SELECT parent_version_id, branch_label FROM chapter_versions WHERE id = ?",
      )
      .get(cursor) as
      | { parent_version_id: number | null; branch_label: string | null }
      | undefined;
    if (!row) break;
    if (row.branch_label && row.branch_label.startsWith(REPAIR_BRANCH_PREFIX)) {
      count++;
    }
    cursor = row.parent_version_id;
  }
  return count;
}

function prosePlainTextToProseMirror(text: string): unknown {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    })),
  };
}

void extractText; // keep import alive if unused

export function createCritiqueRoute(
  sqlite: DatabaseType,
  hasVec: boolean,
): Hono {
  const r = new Hono();

  r.get("/chapter-versions/:id/critique", (c) => {
    const id = Number(c.req.param("id"));
    const v = sqlite
      .prepare("SELECT id FROM chapter_versions WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!v) return notFound(c, "chapter_version");
    const row = sqlite
      .prepare(
        `SELECT * FROM critique_reports
         WHERE chapter_version_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(id) as CritiqueReportRow | undefined;
    return c.json(row ? toReport(row) : null);
  });

  r.post("/chapter-versions/:id/critique", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = runCritiqueInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const version = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(id) as ChapterVersionRow | undefined;
    if (!version) return notFound(c, "chapter_version");
    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(version.chapter_id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(ch.book_id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    // Build input context (mirror Writer's context-gathering).
    let outlineSelected: string | null = null;
    if (book.outline_json) {
      try {
        const o = JSON.parse(book.outline_json) as {
          variants: unknown[];
          selectedIndex: number | null;
        };
        if (o.selectedIndex !== null && o.variants[o.selectedIndex]) {
          outlineSelected = JSON.stringify(o.variants[o.selectedIndex]);
        }
      } catch {
        /* ignore */
      }
    }
    let pov = "—";
    let emotionalGoal = "—";
    if (ch.plan_json) {
      try {
        const p = JSON.parse(ch.plan_json) as {
          variants: Array<{ pov: string; emotionalGoal: string }>;
          selectedIndex: number | null;
        };
        if (p.selectedIndex !== null && p.variants[p.selectedIndex]) {
          pov = p.variants[p.selectedIndex]!.pov;
          emotionalGoal = p.variants[p.selectedIndex]!.emotionalGoal;
        }
      } catch {
        /* ignore */
      }
    }

    const prevSummary = (() => {
      const rows = sqlite
        .prepare(
          `SELECT c.id, c.title, c.order_index, v.content_text
           FROM chapters c
           LEFT JOIN chapter_versions v ON v.id = c.current_version_id
           WHERE c.book_id = ? AND c.order_index < ?
           ORDER BY c.order_index ASC`,
        )
        .all(book.id, ch.order_index) as Array<{
        id: number;
        title: string;
        order_index: number;
        content_text: string | null;
      }>;
      if (rows.length === 0) return null;
      return rows
        .map((r) => {
          const snip = r.content_text ? r.content_text.slice(0, 1200) : "(пусто)";
          return `Глава #${r.order_index} «${r.title}»:\n${snip}`;
        })
        .join("\n\n---\n\n");
    })();

    const contextTexts = [
      ch.intent,
      book.title,
      book.premise,
      outlineSelected,
      pov,
      emotionalGoal,
      version.content_text,
      prevSummary,
    ];
    const charResult = gatherCharacterContext(sqlite, book.id, contextTexts);
    const charNameById = new Map(
      charResult.characters.map((cc) => [
        cc.character.id,
        cc.character.canonicalName,
      ]),
    );
    const characterContext =
      charResult.characters.length > 0
        ? characterContextToPrompt(charResult, charNameById)
        : null;
    const loreResult = gatherLoreContext(
      sqlite,
      book.id,
      contextTexts,
      ch.order_index,
    );
    const loreContext =
      loreResult.locations.length > 0 ||
      loreResult.items.length > 0 ||
      loreResult.openHooks.length > 0
        ? loreContextToPrompt(loreResult)
        : null;

    const bookContextLines: string[] = [
      `Название: "${book.title}"`,
      `Премиса: ${book.premise ?? "(не задана)"}`,
    ];
    if (outlineSelected) bookContextLines.push(`Outline:\n${outlineSelected}`);
    const bookContext = bookContextLines.join("\n");

    const criticInput: CriticInput = {
      chapterText: version.content_text,
      chapterTitle: ch.title,
      pov,
      emotionalGoal,
      bookContext,
      previousChaptersSummary: prevSummary,
      characterContext,
      loreContext,
      config: { variants: 1, model: book.critic_model as "sonnet" | "opus" },
      onUsage: (usage) =>
        logUsage(sqlite, {
          route: `critic.${usage.critic}`,
          model: usage.modelId,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
          },
          bookId: book.id,
          chapterId: ch.id,
          versionId: version.id,
        }),
    };

    // Insert pending row
    const now = new Date().toISOString();
    const insertInfo = sqlite
      .prepare(
        `INSERT INTO critique_reports (chapter_version_id, status, created_at)
         VALUES (?, 'pending', ?)`,
      )
      .run(id, now);
    const reportRowId = Number(insertInfo.lastInsertRowid);

    try {
      const result = await runCritique({
        input: criticInput,
        enabledCritics: parsed.data.critics,
      });
      const completedAt = new Date().toISOString();
      const errorMessage =
        result.errors.length > 0
          ? result.errors
              .map((e) => `[${e.critic}] ${e.message}`)
              .join(" | ")
          : null;
      sqlite
        .prepare(
          `UPDATE critique_reports
           SET status = ?, report_json = ?, error_message = ?, completed_at = ?
           WHERE id = ?`,
        )
        .run(
          result.errors.length === result.report.critics.length
            ? "error"
            : "done",
          JSON.stringify(result.report),
          errorMessage,
          completedAt,
          reportRowId,
        );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sqlite
        .prepare(
          `UPDATE critique_reports
           SET status = 'error', error_message = ?, completed_at = ?
           WHERE id = ?`,
        )
        .run(message, new Date().toISOString(), reportRowId);
    }

    const final = sqlite
      .prepare("SELECT * FROM critique_reports WHERE id = ?")
      .get(reportRowId) as CritiqueReportRow;
    return c.json(toReport(final));
  });

  // ─────────── Repair (SSE stream) ───────────

  r.post("/chapter-versions/:id/repair", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = runRepairInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const version = sqlite
      .prepare("SELECT * FROM chapter_versions WHERE id = ?")
      .get(id) as
      | ChapterVersionRow
      | undefined;
    if (!version) return notFound(c, "chapter_version");
    const v = version;

    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(v.chapter_id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(ch.book_id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    // Iteration cap
    const iterationDone = countRepairAncestors(sqlite, v.id);
    if (iterationDone >= REPAIR_MAX_ITERATIONS) {
      return badRequest(
        c,
        `repair iteration cap reached (${REPAIR_MAX_ITERATIONS}). Этой ветке уже сделано ${iterationDone} repair-итераций.`,
      );
    }
    const nextIteration = iterationDone + 1;

    // Latest critique report
    const reportRow = sqlite
      .prepare(
        `SELECT * FROM critique_reports
         WHERE chapter_version_id = ? AND report_json IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(v.id) as CritiqueReportRow | undefined;
    if (!reportRow || !reportRow.report_json) {
      return badRequest(c, "no critique report exists for this version");
    }
    const report = fullCritiqueReportSchema.parse(JSON.parse(reportRow.report_json));

    // Build context (mirror critique POST)
    let outlineSelected: string | null = null;
    if (book.outline_json) {
      try {
        const o = JSON.parse(book.outline_json) as {
          variants: unknown[];
          selectedIndex: number | null;
        };
        if (o.selectedIndex !== null && o.variants[o.selectedIndex]) {
          outlineSelected = JSON.stringify(o.variants[o.selectedIndex]);
        }
      } catch {
        /* ignore */
      }
    }
    let pov = "—";
    let emotionalGoal = "—";
    if (ch.plan_json) {
      try {
        const p = JSON.parse(ch.plan_json) as {
          variants: Array<{ pov: string; emotionalGoal: string }>;
          selectedIndex: number | null;
        };
        if (p.selectedIndex !== null && p.variants[p.selectedIndex]) {
          pov = p.variants[p.selectedIndex]!.pov;
          emotionalGoal = p.variants[p.selectedIndex]!.emotionalGoal;
        }
      } catch {
        /* ignore */
      }
    }
    const prevSummary = (() => {
      const rows = sqlite
        .prepare(
          `SELECT c.id, c.title, c.order_index, v.content_text
           FROM chapters c
           LEFT JOIN chapter_versions v ON v.id = c.current_version_id
           WHERE c.book_id = ? AND c.order_index < ?
           ORDER BY c.order_index ASC`,
        )
        .all(book.id, ch.order_index) as Array<{
        id: number;
        title: string;
        order_index: number;
        content_text: string | null;
      }>;
      if (rows.length === 0) return null;
      return rows
        .map((r) =>
          `Глава #${r.order_index} «${r.title}»:\n${r.content_text ? r.content_text.slice(0, 1200) : "(пусто)"}`,
        )
        .join("\n\n---\n\n");
    })();

    const contextTexts = [
      ch.intent,
      book.title,
      book.premise,
      outlineSelected,
      pov,
      emotionalGoal,
      v.content_text,
      prevSummary,
    ];
    const charResult = gatherCharacterContext(sqlite, book.id, contextTexts);
    const charNameById = new Map(
      charResult.characters.map((cc) => [
        cc.character.id,
        cc.character.canonicalName,
      ]),
    );
    const characterContext =
      charResult.characters.length > 0
        ? characterContextToPrompt(charResult, charNameById)
        : null;
    const loreResult = gatherLoreContext(
      sqlite,
      book.id,
      contextTexts,
      ch.order_index,
    );
    const loreContext =
      loreResult.locations.length > 0 ||
      loreResult.items.length > 0 ||
      loreResult.openHooks.length > 0
        ? loreContextToPrompt(loreResult)
        : null;

    const bookContextLines: string[] = [
      `Название: "${book.title}"`,
      `Премиса: ${book.premise ?? "(не задана)"}`,
    ];
    if (outlineSelected) bookContextLines.push(`Outline:\n${outlineSelected}`);
    const bookContext = bookContextLines.join("\n");

    return streamSSE(c, async (stream) => {
      let fullText = "";
      let modelId = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      try {
        await stream.writeSSE({
          event: "iteration",
          data: JSON.stringify({
            current: nextIteration,
            max: REPAIR_MAX_ITERATIONS,
          }),
        });

        const styleCtx = loadStyleContext(sqlite, book.style_profile_id);
        const gen = reviseChapter({
          bookContext,
          chapterTitle: ch.title,
          pov,
          emotionalGoal,
          characterContext,
          loreContext,
          styleContext: styleCtx.prompt,
          fatigueWords: styleCtx.fatigueBlacklist,
          previousChaptersSummary: prevSummary,
          originalText: v.content_text,
          critics: report.critics,
          severityFilter: parsed.data.severities,
          iteration: nextIteration,
          config: { variants: 1, model: book.writer_model as "sonnet" | "opus" },
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

        // Persist as new version: parent = original, branch = repair-N
        const contentJson = JSON.stringify(prosePlainTextToProseMirror(fullText));
        const wordCount = countWords(fullText);
        const branchLabel = `${REPAIR_BRANCH_PREFIX}${nextIteration}`;
        const now = new Date().toISOString();

        const tx = sqlite.transaction(() => {
          const info = sqlite
            .prepare(
              `INSERT INTO chapter_versions
               (chapter_id, parent_version_id, content_json, content_text, word_count, source, branch_label, created_at)
               VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)`,
            )
            .run(
              v.chapter_id,
              v.id,
              contentJson,
              fullText,
              wordCount,
              branchLabel,
              now,
            );
          const newVersionId = Number(info.lastInsertRowid);
          sqlite
            .prepare(
              "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
            )
            .run(newVersionId, now, v.chapter_id);
          sqlite
            .prepare("UPDATE books SET updated_at = ? WHERE id = ?")
            .run(now, ch.book_id);
          return newVersionId;
        });
        const newVersionId = tx();

        try {
          await indexChapterVersion(sqlite, hasVec, {
            bookId: ch.book_id,
            chapterId: ch.id,
            chapterOrder: ch.order_index,
            versionId: newVersionId,
            language: "ru",
            text: fullText,
          });
        } catch (e) {
          console.warn("[chunks] repair indexing failed:", e);
        }

        const newRow = sqlite
          .prepare("SELECT * FROM chapter_versions WHERE id = ?")
          .get(newVersionId) as
          | ChapterVersionRow
          | undefined;

        logUsage(sqlite, {
          route: "reviser.repair",
          model: modelId,
          usage: {
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheCreationTokens,
            cacheReadInputTokens: cacheReadTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
          versionId: newVersionId,
        });

        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            version: newRow ? toVersion(newRow) : null,
            iteration: nextIteration,
            tokens: {
              input: inputTokens,
              output: outputTokens,
              cacheCreation: cacheCreationTokens,
              cacheRead: cacheReadTokens,
            },
          }),
        });
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

  r.delete("/chapter-versions/:id/critique", (c) => {
    const id = Number(c.req.param("id"));
    const info = sqlite
      .prepare("DELETE FROM critique_reports WHERE chapter_version_id = ?")
      .run(id);
    if (info.changes === 0) return notFound(c, "critique_report");
    return c.body(null, 204);
  });

  return r;
}

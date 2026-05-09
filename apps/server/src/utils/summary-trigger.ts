import type { Database as DatabaseType } from "better-sqlite3";
import { summarizeChapter } from "@book-forge/agents";
import { logUsage } from "./usageLogger.js";

interface VersionRow {
  id: number;
  chapter_id: number;
  content_text: string;
  word_count: number;
  summary: string | null;
}
interface ChapterRow {
  id: number;
  book_id: number;
  title: string;
}
interface BookRow {
  critic_model: "sonnet" | "opus";
}

/**
 * Generate a 80-180 word summary for a chapter version (fire-and-forget).
 *
 * Skips silently when:
 *   - summary already present
 *   - text < 200 chars (handled by agent itself; we just persist short slice)
 *   - the LLM call throws (we don't want to crash the user save flow)
 */
export async function triggerVersionSummary(
  sqlite: DatabaseType,
  versionId: number,
): Promise<void> {
  try {
    const v = sqlite
      .prepare(
        `SELECT id, chapter_id, content_text, word_count, summary
         FROM chapter_versions WHERE id = ?`,
      )
      .get(versionId) as VersionRow | undefined;
    if (!v) return;
    if (v.summary && v.summary.length > 0) return; // already summarized
    if (v.word_count < 80) return; // too short to summarize meaningfully

    const ch = sqlite
      .prepare("SELECT id, book_id, title FROM chapters WHERE id = ?")
      .get(v.chapter_id) as ChapterRow | undefined;
    if (!ch) return;
    const bk = sqlite
      .prepare("SELECT critic_model FROM books WHERE id = ?")
      .get(ch.book_id) as BookRow | undefined;
    const model = bk?.critic_model ?? "sonnet";

    const result = await summarizeChapter({
      chapterTitle: ch.title,
      chapterText: v.content_text,
      model,
    });
    if (!result.summary) return;
    sqlite
      .prepare("UPDATE chapter_versions SET summary = ? WHERE id = ?")
      .run(result.summary, versionId);
    if (result.modelId !== "noop") {
      logUsage(sqlite, {
        route: "summary.chapter",
        model: result.modelId,
        usage: {
          inputTokens: result.tokens.input,
          outputTokens: result.tokens.output,
          cacheCreationInputTokens: result.tokens.cacheCreation,
          cacheReadInputTokens: result.tokens.cacheRead,
        },
        bookId: ch.book_id,
        chapterId: ch.id,
        versionId,
      });
    }
  } catch (e) {
    console.warn(
      "[summary] generation failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  runInlineCommandInputSchema,
  INLINE_COMMANDS_REQUIRING_SELECTION,
  boundaryForChapter,
} from "@book-forge/shared";
import {
  runInlineCommand,
  gatherCharacterContext,
  characterContextToPrompt,
  gatherLoreContext,
  loreContextToPrompt,
} from "@book-forge/agents";
import type { ChapterRow, BookRow } from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { makeCharacterBoundaryReaders } from "../utils/character-events.js";
import { logUsage } from "../utils/usageLogger.js";
import {
  loadStudioContext,
  studioContextToPrompt,
} from "../utils/studio-context.js";

export function createInlineRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();

  r.post("/chapters/:id/inline", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = runInlineCommandInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    if (
      INLINE_COMMANDS_REQUIRING_SELECTION.includes(parsed.data.command) &&
      (!parsed.data.selectionText ||
        parsed.data.selectionText.trim().length === 0)
    ) {
      return badRequest(
        c,
        `command "${parsed.data.command}" requires non-empty selectionText`,
      );
    }

    if (parsed.data.command === "describe" && !parsed.data.sense) {
      return badRequest(c, 'command "describe" requires sense');
    }

    const ch = sqlite
      .prepare("SELECT * FROM chapters WHERE id = ?")
      .get(id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(ch.book_id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

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
    const bookContextLines: string[] = [
      `Название: "${book.title}"`,
      `Премиса: ${book.premise ?? "(не задана)"}`,
    ];
    if (outlineSelected) bookContextLines.push(`Outline:\n${outlineSelected}`);
    bookContextLines.push(`Текущая глава: "${ch.title}"`);
    const baseBookContext = bookContextLines.join("\n");
    const studioCtx = studioContextToPrompt(loadStudioContext(sqlite, book.id));
    const bookContext = studioCtx
      ? `${baseBookContext}\n\n${studioCtx}`
      : baseBookContext;

    const contextTexts = [
      ch.intent,
      book.title,
      book.premise,
      outlineSelected,
      parsed.data.beforeText,
      parsed.data.selectionText,
      parsed.data.afterText,
    ];
    // Правка идёт по прозе ТОЙ ЖЕ главы, что и починка с критикой, поэтому
    // и граница та же. Без неё блок «Знает» приходил пустым: модель знала,
    // кто герой и как он говорит, и не знала ничего из того, что он знает.
    const charResult = gatherCharacterContext(
      sqlite,
      book.id,
      contextTexts,
      [],
      makeCharacterBoundaryReaders(
        sqlite,
        boundaryForChapter(book.id, ch.id, ch.current_version_id),
      ),
    );
    const charNameById = new Map(
      charResult.characters.map((cc) => [
        cc.character.id,
        cc.character.canonicalName,
      ]),
    );
    const characterContext =
      charResult.characters.length > 0
        ? characterContextToPrompt(charResult, charNameById, { chapterOrder: ch.order_index })
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

    return streamSSE(c, async (stream) => {
      try {
        const gen = runInlineCommand({
          command: parsed.data.command,
          selectionText: parsed.data.selectionText,
          beforeText: parsed.data.beforeText,
          // «Описать» текста ПОСЛЕ не видит — см. describeInstruction.
          afterText: parsed.data.command === "describe" ? "" : parsed.data.afterText,
          bookContext,
          characterContext,
          loreContext,
          guidance: parsed.data.guidance ?? null,
          sense: parsed.data.sense ?? null,
          config: parsed.data.config,
        });
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheCreationTokens = 0;
        let cacheReadTokens = 0;
        let modelId = "";
        let fullText = "";
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
        logUsage(sqlite, {
          route: `inline.${parsed.data.command}`,
          model: modelId,
          usage: {
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheCreationTokens,
            cacheReadInputTokens: cacheReadTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
        });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({
            text: fullText,
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

  return r;
}

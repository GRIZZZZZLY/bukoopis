import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createChatThreadInputSchema,
  sendChatMessageInputSchema,
  CHAT_HISTORY_LIMIT,
  CHAT_CHAPTER_TEXT_LIMIT,
  CHAT_TITLE_CHARS,
  type ChatMessage,
  type ChatThread,
} from "@book-forge/shared";
import { runBookChat } from "@book-forge/agents";
import type { BookRow, ChapterRow, ChapterVersionRow } from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { assembleGenerationContext } from "../utils/generation-context.js";
import { requiredOverflowMessage } from "../utils/context-compiler.js";
import { logUsage } from "../utils/usageLogger.js";

interface ThreadRow {
  id: number;
  book_id: number;
  chapter_id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
}
interface MessageRow {
  id: number;
  thread_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const toThread = (r: ThreadRow): ChatThread => ({
  id: r.id,
  bookId: r.book_id,
  chapterId: r.chapter_id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  threadId: r.thread_id,
  role: r.role,
  content: r.content,
  createdAt: r.created_at,
});

/** Текст открытой главы для чата: черновик новее версии, если он есть. */
function openChapterText(
  sqlite: DatabaseType,
  ch: ChapterRow,
): { text: string; truncated: boolean } {
  const draft = sqlite
    .prepare("SELECT content_text FROM chapter_drafts WHERE chapter_id = ?")
    .get(ch.id) as { content_text: string } | undefined;
  let text = draft?.content_text ?? "";
  if (!text && ch.current_version_id !== null) {
    const v = sqlite
      .prepare("SELECT content_text FROM chapter_versions WHERE id = ?")
      .get(ch.current_version_id) as Pick<ChapterVersionRow, "content_text"> | undefined;
    text = v?.content_text ?? "";
  }
  if (text.length > CHAT_CHAPTER_TEXT_LIMIT) {
    return { text: text.slice(0, CHAT_CHAPTER_TEXT_LIMIT), truncated: true };
  }
  return { text, truncated: false };
}

export function createChatRoute(sqlite: DatabaseType, hasVec: boolean): Hono {
  const r = new Hono();

  const loadThread = (id: number): ThreadRow | undefined =>
    sqlite.prepare("SELECT * FROM chat_threads WHERE id = ?").get(id) as ThreadRow | undefined;

  r.get("/chapters/:id/chat/threads", (c) => {
    const chapterId = Number(c.req.param("id"));
    const ch = sqlite.prepare("SELECT id FROM chapters WHERE id = ?").get(chapterId);
    if (!ch) return notFound(c, "chapter");
    const rows = sqlite
      .prepare("SELECT * FROM chat_threads WHERE chapter_id = ? ORDER BY updated_at DESC, id DESC")
      .all(chapterId) as ThreadRow[];
    return c.json(rows.map(toThread));
  });

  r.post("/chapters/:id/chat/threads", async (c) => {
    const chapterId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const parsed = createChatThreadInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const ch = sqlite.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        "INSERT INTO chat_threads (book_id, chapter_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(ch.book_id, ch.id, parsed.data.title ?? null, now, now);
    return c.json(toThread(loadThread(Number(info.lastInsertRowid))!), 201);
  });

  r.delete("/chat/threads/:id", (c) => {
    const id = Number(c.req.param("id"));
    const res = sqlite.prepare("DELETE FROM chat_threads WHERE id = ?").run(id);
    if (res.changes === 0) return notFound(c, "chat_thread");
    return c.body(null, 204);
  });

  r.get("/chat/threads/:id/messages", (c) => {
    const id = Number(c.req.param("id"));
    if (!loadThread(id)) return notFound(c, "chat_thread");
    const rows = sqlite
      .prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id ASC")
      .all(id) as MessageRow[];
    return c.json(rows.map(toMessage));
  });

  r.post("/chat/threads/:id/messages", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = sendChatMessageInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const thread = loadThread(id);
    if (!thread) return notFound(c, "chat_thread");
    const ch = sqlite.prepare("SELECT * FROM chapters WHERE id = ?").get(thread.chapter_id) as ChapterRow | undefined;
    if (!ch) return notFound(c, "chapter");
    const book = sqlite.prepare("SELECT * FROM books WHERE id = ?").get(thread.book_id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    const content = parsed.data.content;
    const chapter = openChapterText(sqlite, ch);

    // Та же сборка, что у Писателя и критиков: второй сборки контекста быть
    // не должно. Чат сканирует текст главы и вопрос; стилевых образцов ноль
    // (это разговор, не проза); план автора виден — автор говорит сам с собой.
    const assembled = await assembleGenerationContext(sqlite, {
      book,
      chapter: ch,
      hasVec,
      scanTexts: [chapter.text, content],
      retrievalQuery: content,
      notesQuery: content,
      povName: null,
      styleFewShot: 0,
      factsBoundary: "at_chapter",
      includeAuthorPlan: true,
      label: `chat ch#${ch.order_index}`,
    });
    if (assembled.compiled.requiredOverflow) {
      return badRequest(c, requiredOverflowMessage(assembled.compiled));
    }

    const history = (
      sqlite
        .prepare(
          `SELECT * FROM (SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT ?)
           ORDER BY id ASC`,
        )
        .all(id, CHAT_HISTORY_LIMIT) as MessageRow[]
    ).map((m) => ({ role: m.role, content: m.content }));

    const now = new Date().toISOString();
    sqlite
      .prepare("INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
      .run(id, content, now);
    if (thread.title === null) {
      sqlite
        .prepare("UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?")
        .run(content.slice(0, CHAT_TITLE_CHARS), now, id);
    } else {
      sqlite.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(now, id);
    }

    const contextBlocks = [
      assembled.bookContextBase,
      assembled.studioContext,
      assembled.previousChapters,
      assembled.sceneState,
      assembled.characterContext,
      assembled.loreContext,
      assembled.retrieval,
      assembled.notesPrompt,
    ].filter((b): b is string => typeof b === "string" && b.length > 0);

    return streamSSE(c, async (stream) => {
      // Кадры уходят цепочкой через `pending`, а не awaitʼом на каждый вызов:
      // у самообслуживающей обёртки Hono над SSE только ПЕРВАЯ запись в поток
      // проходит без читателя (self-priming pull её протаскивает), все
      // следующие ждут реального потребителя и висят вечно, если его нет.
      // Раньше `await stream.writeSSE(...)` внутри цикла главы стоял на
      // втором чанке навечно — ответ ассистента не сохранялся, если вкладка
      // не читала поток (или тест не звал `res.text()`). Прогон и запись в
      // базу не должны зависеть от того, слушает ли кто-то поток.
      let pending: Promise<void> = Promise.resolve();
      const enqueueWrite = (event: string, data: unknown): void => {
        pending = pending
          .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
          .catch(() => {});
      };
      const keepalive = setInterval(() => enqueueWrite("ping", { at: Date.now() }), 20_000);
      try {
        const gen = runBookChat({
          bookTitle: book.title,
          chapterTitle: ch.title,
          chapterText: chapter.text,
          chapterTextTruncated: chapter.truncated,
          contextBlocks,
          history,
          message: content,
          model: book.plot_model as "sonnet" | "opus",
        });
        let full = "";
        let modelId = "";
        let tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        while (true) {
          const next = await gen.next();
          if (next.done) {
            full = next.value.text;
            modelId = next.value.modelId;
            tokens = next.value.tokens;
            break;
          }
          enqueueWrite("chunk", { text: next.value });
        }
        const doneAt = new Date().toISOString();
        const info = sqlite
          .prepare("INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)")
          .run(id, full, doneAt);
        sqlite.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(doneAt, id);
        logUsage(sqlite, {
          route: "chat.message",
          model: modelId,
          usage: {
            inputTokens: tokens.input,
            outputTokens: tokens.output,
            cacheCreationInputTokens: tokens.cacheCreation,
            cacheReadInputTokens: tokens.cacheRead,
          },
          bookId: book.id,
          chapterId: ch.id,
        });
        const saved = sqlite
          .prepare("SELECT * FROM chat_messages WHERE id = ?")
          .get(Number(info.lastInsertRowid)) as MessageRow;
        enqueueWrite("done", { message: toMessage(saved) });
      } catch (e) {
        enqueueWrite("error", { message: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(keepalive);
        await pending.catch(() => {});
      }
    });
  });

  return r;
}

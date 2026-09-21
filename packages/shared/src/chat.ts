import { z } from "zod";

export const chatThreadSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatThread = z.infer<typeof chatThreadSchema>;

export const chatMessageSchema = z.object({
  id: z.number().int().positive(),
  threadId: z.number().int().positive(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const createChatThreadInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

/** Потолок одного сообщения — как у Литраба, 10 000 знаков. */
export const sendChatMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});
export type SendChatMessageInput = z.infer<typeof sendChatMessageInputSchema>;

/** Сколько прежних сообщений треда едет в запрос. */
export const CHAT_HISTORY_LIMIT = 20;
/** Потолок текста открытой главы в запросе, в символах. */
export const CHAT_CHAPTER_TEXT_LIMIT = 40_000;
/** Название треда — первые символы первого сообщения. */
export const CHAT_TITLE_CHARS = 60;

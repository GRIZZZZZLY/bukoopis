import { describe, it, expect } from "vitest";
import {
  buildChatStableSystem,
  buildChatVolatilePrompt,
  type BookChatInput,
} from "../chat.js";

const base: BookChatInput = {
  bookTitle: "Северная",
  chapterTitle: "Глава 4",
  chapterText: "Нина закрыла дверь.",
  chapterTextTruncated: false,
  contextBlocks: ["## Персонажи в сцене\n### Нина", "## Стиль\nкоротко"],
  history: [
    { role: "user", content: "Почему Нина молчит?" },
    { role: "assistant", content: "Она не доверяет Ворту." },
  ],
  message: "А что она сделает дальше?",
  model: "sonnet",
};

describe("book_chat prompt", () => {
  it("стабильная часть несёт правила, материалы книги и текст главы", () => {
    const s = buildChatStableSystem(base);
    expect(s).toContain("## Персонажи в сцене");
    expect(s).toContain("Нина закрыла дверь.");
    expect(s).toMatch(/в материалах книги этого нет/i);
    expect(s).toMatch(/не (меняешь|правишь) .*глав/i);
    expect(s).not.toContain("А что она сделает дальше?");
  });

  it("переменная часть — история по порядку и новый вопрос последним", () => {
    const v = buildChatVolatilePrompt(base);
    const i1 = v.indexOf("Почему Нина молчит?");
    const i2 = v.indexOf("Она не доверяет Ворту.");
    const i3 = v.indexOf("А что она сделает дальше?");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  it("обрезанная глава помечается словами", () => {
    const s = buildChatStableSystem({ ...base, chapterTextTruncated: true });
    expect(s).toMatch(/обрезан/i);
  });
});

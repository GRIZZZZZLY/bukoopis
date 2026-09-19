import { describe, it, expect } from "vitest";
import { judgeProseCompletion } from "./prose-completion.js";

describe("judgeProseCompletion (С5)", () => {
  it("верит бэкенду, когда он назвал причину", () => {
    expect(judgeProseCompletion("end_turn", "Обрывок").looksComplete).toBe(true);
    expect(judgeProseCompletion("max_tokens", "Целая фраза.").looksComplete).toBe(false);
  });

  it("на молчащем бэкенде смотрит на хвост текста", () => {
    const v = judgeProseCompletion(null, "Она закрыла дверь.");
    expect(v).toEqual({ looksComplete: true, reason: "tail_looks_done" });
    expect(judgeProseCompletion(null, "Она закрыла").looksComplete).toBe(false);
  });

  it("реплика в кавычках и троеточие считаются концом", () => {
    expect(judgeProseCompletion(null, "— Уходи, — сказала она.").looksComplete).toBe(true);
    expect(judgeProseCompletion(null, "Он молчал…").looksComplete).toBe(true);
    expect(judgeProseCompletion(null, "«Пора домой»").looksComplete).toBe(true);
  });

  it("пустой текст дописанным не считается", () => {
    expect(judgeProseCompletion(null, "   ").looksComplete).toBe(false);
  });
});

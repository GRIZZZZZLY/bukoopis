import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@book-forge/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@book-forge/llm")>();
  return { ...actual, dispatchStructured: vi.fn() };
});

import { dispatchStructured } from "@book-forge/llm";
import type { CritiqueIssue } from "@book-forge/shared";
import type { CriticInput } from "../base.js";
import { runStyleAgent } from "../style.js";
import { mergeStyleIssues, phraseIssues, STYLE_PHRASE_SYSTEM } from "../style-phrase.js";

const input: CriticInput = {
  chapterText: "Текст.", chapterTitle: "Глава", pov: "Лис", emotionalGoal: "—",
  bookContext: "Книга", previousChaptersSummary: null, characterContext: null, loreContext: null,
};
const diagnostics = {
  modelId: "m", backend: "api", inputTokens: 1, outputTokens: 1,
  cacheCreationInputTokens: 0, cacheReadInputTokens: 0, latencyMs: 1,
};
const general: CritiqueIssue = { severity: "suggestion", summary: "повтор", excerpt: "что-то вроде складской скуки", suggestion: "убрать" };

describe("проход по фразам критика стиля", () => {
  beforeEach(() => vi.mocked(dispatchStructured).mockReset());

  it("не переписывает фразу: без замены, степень «предложение», метка прохода", () => {
    const [i] = phraseIssues({
      overallNotes: "есть",
      issues: [{ excerpt: "рёбра становятся меньше себя", reason: "вещь не бывает меньше себя", category: "broken_image" }],
    });
    expect(i).toMatchObject({ severity: "suggestion", suggestion: null, origin: "style_phrase", excerpt: "рёбра становятся меньше себя" });
    expect(i!.summary).toMatch(/^образ без логики: /);
    expect(STYLE_PHRASE_SYSTEM).toMatch(/Не переписывай фразу и не предлагай замену/);
    expect(STYLE_PHRASE_SYSTEM).toMatch(/Не оценивай композицию, темп, диалоги и сцену целиком/);
  });

  it("совпадение с общим разбором показывается один раз — общим замечанием", () => {
    const phrase: CritiqueIssue[] = [
      { severity: "suggestion", summary: "x", excerpt: "складской скуки", origin: "style_phrase" },
      { severity: "suggestion", summary: "y", excerpt: "«Как письмо в щель.»", origin: "style_phrase" },
      { severity: "suggestion", summary: "y2", excerpt: "как письмо в щель", origin: "style_phrase" },
    ];
    const merged = mergeStyleIssues([general], phrase);
    expect(merged.map((i) => [i.origin, i.excerpt])).toEqual([
      ["style_general", "что-то вроде складской скуки"],
      ["style_phrase", "«Как письмо в щель.»"],
    ]);
  });

  it("два вызова; отказ прохода по фразам не роняет критика", async () => {
    vi.mocked(dispatchStructured)
      .mockResolvedValueOnce({ raw: { overallNotes: "ок", issues: [general] }, diagnostics } as never)
      .mockRejectedValueOnce(new Error("timeout"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUsage = vi.fn();
    const report = await runStyleAgent({ ...input, onUsage });
    expect(vi.mocked(dispatchStructured).mock.calls.map((c) => c[0].agentName)).toEqual(["critic_style", "critic_style_phrase"]);
    expect(report.critic).toBe("style");
    expect(report.issues).toEqual([{ ...general, origin: "style_general" }]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("оба прохода сливаются в один отчёт, расход записан за оба", async () => {
    vi.mocked(dispatchStructured)
      .mockResolvedValueOnce({ raw: { overallNotes: "ок", issues: [general] }, diagnostics } as never)
      .mockResolvedValueOnce({
        raw: { overallNotes: "есть", issues: [{ excerpt: "ладонь до косяка не доехала", reason: "рука не ездит", category: "forced_verb" }] },
        diagnostics,
      } as never);
    const onUsage = vi.fn();
    const report = await runStyleAgent({ ...input, onUsage });
    expect(report.issues.map((i) => i.origin)).toEqual(["style_general", "style_phrase"]);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage.mock.calls.every((c) => c[0].critic === "style")).toBe(true);
  });
});

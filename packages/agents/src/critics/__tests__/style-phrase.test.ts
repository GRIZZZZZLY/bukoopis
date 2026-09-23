import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@book-forge/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@book-forge/llm")>();
  return { ...actual, dispatchStructured: vi.fn() };
});

import { dispatchStructured } from "@book-forge/llm";
import type { CritiqueIssue } from "@book-forge/shared";
import type { CriticInput } from "../base.js";
import { runStyleAgent } from "../style.js";
import {
  mergeStyleIssues,
  phraseChunks,
  phraseFailureNote,
  phraseIssues,
  STYLE_PHRASE_SYSTEM,
} from "../style-phrase.js";

const input: CriticInput = {
  chapterText: "Текст.", chapterTitle: "Глава", pov: "Лис", emotionalGoal: "—",
  bookContext: "Книга", previousChaptersSummary: null, characterContext: null, loreContext: null,
};
const diagnostics = {
  modelId: "m", backend: "api", inputTokens: 1, outputTokens: 1,
  cacheCreationInputTokens: 0, cacheReadInputTokens: 0, latencyMs: 1,
};
const general: CritiqueIssue = { severity: "suggestion", summary: "повтор", excerpt: "что-то вроде складской скуки", suggestion: "убрать" };
const agentOf = (c: unknown[]) => (c[0] as { agentName: string }).agentName;

describe("проход по фразам критика стиля", () => {
  // Скобки обязательны: функция, которую вернул beforeEach, vitest вызывает
  // после теста как очистку — вернуть сам мок значит вызвать его без аргументов.
  beforeEach(() => {
    vi.mocked(dispatchStructured).mockReset();
  });

  it("не переписывает фразу и не доказывает неестественность буквальной невозможностью", () => {
    const [i] = phraseIssues({
      issues: [{ excerpt: "рёбра становятся меньше себя", reason: "так не говорят", category: "forced_image" }],
    });
    expect(i).toMatchObject({ severity: "suggestion", suggestion: null, origin: "style_phrase", excerpt: "рёбра становятся меньше себя" });
    expect(i!.summary).toBe("натянутый образ: так не говорят");
    expect(STYLE_PHRASE_SYSTEM).toMatch(/Не переписывай фразу и не предлагай замену/);
    expect(STYLE_PHRASE_SYSTEM).toMatch(/Не требуй буквальной логичности от метафоры/);
    expect(STYLE_PHRASE_SYSTEM).toMatch(/Проверяй только кусок/);
    // Разбор главы «Тёмного леса»: каскады и перевод обратно ловились плохо (4 из 16),
    // а сравнение с домом героя («печной гул») задевалось зря.
    expect(STYLE_PHRASE_SYSTEM).toMatch(/каскад: в одной фразе образ наращивается на образ/);
    expect(STYLE_PHRASE_SYSTEM).toMatch(/переводить красивую формулировку обратно в обычный смысл/);
    expect(STYLE_PHRASE_SYSTEM).toMatch(/связывает предмет с домом, детством, ремеслом или миром героя/);
  });

  it("режет главу по целым абзацам и прикладывает соседние абзацы", () => {
    const p = (n: number) => `${"абзац ".repeat(50)}${n}.`;
    const text = [1, 2, 3, 4, 5].map(p).join("\n\n");
    const chunks = phraseChunks(text, 700);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join("\n\n")).toBe(text);
    expect(chunks[0]!.before).toBeNull();
    expect(chunks[1]!.before).toBe(chunks[0]!.text.split("\n\n").at(-1));
    expect(chunks.at(-1)!.after).toBeNull();
    expect(chunks.every((c) => c.total === chunks.length)).toBe(true);
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

  it("упавший кусок повторяется; не удалось и повтором — отчёт говорит об этом", async () => {
    vi.mocked(dispatchStructured).mockImplementation(async (opts) => {
      if (opts.agentName === "critic_style") return { raw: { overallNotes: "ок", issues: [general] }, diagnostics } as never;
      throw new Error("timeout");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onUsage = vi.fn();
    const report = await runStyleAgent({ ...input, onUsage });
    expect(vi.mocked(dispatchStructured).mock.calls.map(agentOf)).toEqual(["critic_style", "critic_style_phrase", "critic_style_phrase"]);
    expect(report.issues).toEqual([{ ...general, origin: "style_general" }]);
    expect(report.overallNotes).toMatch(/Проверка отдельных фраз не выполнилась/);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(phraseFailureNote({ failedChunks: 1, totalChunks: 4 })).toBe("Проверка отдельных фраз: 1 из 4 кусков главы не проверены.");
    expect(phraseFailureNote({ failedChunks: 0, totalChunks: 4 })).toBeNull();
    warn.mockRestore();
  });

  it("оба прохода сливаются в один отчёт, расход записан за оба", async () => {
    vi.mocked(dispatchStructured).mockImplementation(async (opts) =>
      opts.agentName === "critic_style"
        ? ({ raw: { overallNotes: "ок", issues: [general] }, diagnostics } as never)
        : ({ raw: { issues: [{ excerpt: "ладонь до косяка не доехала", reason: "рука не ездит", category: "forced_verb" }] }, diagnostics } as never),
    );
    const onUsage = vi.fn();
    const report = await runStyleAgent({ ...input, onUsage });
    expect(report.overallNotes).toBe("ок");
    expect(report.issues.map((i) => i.origin)).toEqual(["style_general", "style_phrase"]);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage.mock.calls.every((c) => c[0].critic === "style")).toBe(true);
  });
});

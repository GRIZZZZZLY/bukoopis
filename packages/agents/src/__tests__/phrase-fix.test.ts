import { describe, it, expect } from "vitest";
import type { CriticReport } from "@book-forge/shared";
import { applyPhraseFixes, locatePhrase, PHRASE_FIX_SYSTEM, type PhraseFixItem } from "../phrase-fix.js";
import { buildReviserVolatilePrompt, isPhraseIssue, selectIssues } from "../reviser.js";

const text = [
  "Я лёг на живот и въехал в шахту, как письмо в щель. Внутри было темно.",
  "Гудит рециркуляция — низко, ровно, с той честной тупостью, с какой гудят машины.",
  "Мама Тэ считает порциями.",
].join("\n\n");
const item = (id: string, excerpt: string): PhraseFixItem => {
  const loc = locatePhrase(text, excerpt);
  return { id, excerpt: "excerpt" in loc ? loc.excerpt : excerpt, reason: "r", paragraph: "paragraph" in loc ? loc.paragraph : "" };
};

describe("хирургическая правка фраз", () => {
  it("правит только отмеченное место, остальной текст не меняется ни на знак", () => {
    const items = [item("style:0", "въехал в шахту, как письмо в щель"), item("style:1", ", с той честной тупостью, с какой гудят машины")];
    const out = applyPhraseFixes(text, items, [
      { id: "style:0", before: "въехал в шахту, как письмо в щель", after: "втиснулся в шахту" },
      { id: "style:1", before: ", с той честной тупостью, с какой гудят машины", after: "" },
    ]);
    expect(out.text).toBe(
      "Я лёг на живот и втиснулся в шахту. Внутри было темно.\n\nГудит рециркуляция — низко, ровно.\n\nМама Тэ считает порциями.",
    );
    expect(out.applied).toHaveLength(2);
    expect(out.skipped).toEqual([]);
  });

  it("отказывает замене, которая не содержит фразу, длиннее предложения, неоднозначна или задевает защищённое", () => {
    const items = [item("a", "как письмо в щель"), item("b", "Мама Тэ считает порциями."), item("c", "низко, ровно")];
    const out = applyPhraseFixes(
      text,
      items,
      [
        { id: "a", before: "в шахту", after: "x" },
        { id: "b", before: `Мама Тэ считает порциями.${" и ещё".repeat(80)}`, after: "x" },
        { id: "c", before: "низко, ровно", after: "ровно" },
        { id: "zzz", before: "Я", after: "Ты" },
      ],
      ["рециркуляция — низко"],
    );
    expect(out.text).toBe(text);
    expect(out.skipped).toEqual([
      { id: "a", reason: "no_excerpt" },
      { id: "b", reason: "too_long" },
      { id: "c", reason: "protected" },
      { id: "zzz", reason: "unknown_id" },
    ]);
  });

  it("удалённый целиком абзац не оставляет пустой строки", () => {
    const out = applyPhraseFixes(text, [item("m", "Мама Тэ считает порциями.")], [{ id: "m", before: "Мама Тэ считает порциями.", after: "" }]);
    expect(out.text.endsWith("ровно, с той честной тупостью, с какой гудят машины.")).toBe(true);
    expect(out.text).not.toMatch(/\n{3,}|\n+$/);
  });

  it("фраза, которой нет или которая встречается дважды, не передаётся правке", () => {
    expect(locatePhrase("а б а", "а")).toEqual({ reason: "ambiguous" });
    expect(locatePhrase(text, "нет такой")).toEqual({ reason: "not_found" });
    // Цитату из начала предложения модель пишет со строчной — в правку идёт текст главы.
    expect(locatePhrase(text, "мама тэ считает порциями.")).toEqual({ paragraph: "Мама Тэ считает порциями.", excerpt: "Мама Тэ считает порциями." });
    expect(PHRASE_FIX_SYSTEM).toMatch(/Не добавляй новую метафору, сравнение, шутку или афоризм/);
    expect(PHRASE_FIX_SYSTEM).toMatch(/Если новая лишь иначе украшает ту же мысль, перепиши ещё проще/);
    // Вторая линия защиты: критик отмечает и хорошее; правка его не трогает.
    expect(PHRASE_FIX_SYSTEM).toMatch(/Такую фразу не включай в ответ, даже если она отмечена/);
    expect(PHRASE_FIX_SYSTEM).toMatch(/пояснение, которое меняет смысл действия, а не повторяет его/);
  });

  it("обычная правка не получает замечаний прохода по фразам", () => {
    const critics: CriticReport[] = [{
      critic: "style", overallNotes: "ок",
      issues: [
        { severity: "suggestion", summary: "повтор приёма", excerpt: "ровно", origin: "style_general" },
        { severity: "suggestion", summary: "натянутый образ: так не говорят", excerpt: "как письмо в щель", origin: "style_phrase" },
      ],
    }];
    const picked = selectIssues(critics, ["blocking", "suggestion"]);
    expect(picked.map(isPhraseIssue)).toEqual([false, true]);
    const prompt = buildReviserVolatilePrompt({
      bookContext: "", chapterTitle: "", pov: "", emotionalGoal: "", characterContext: null, loreContext: null,
      styleContext: null, fatigueWords: [], previousChaptersSummary: null, originalText: text, critics, iteration: 1,
    });
    expect(prompt).toMatch(/повтор приёма/);
    expect(prompt).not.toMatch(/натянутый образ/);
  });
});

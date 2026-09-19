import { describe, it, expect } from "vitest";
import { renderHistoryBlocks, type CriticInput } from "../critics/base.js";
import { buildEditorPrompt } from "../critics/editor.js";
import { buildStylePrompt } from "../critics/style.js";

/**
 * История книги для критиков рендерится одним местом. Раньше блок
 * «Предыдущие главы (краткое)» был переписан в четырёх критиках, базе и
 * Reviser'е, и каждая копия знала только о пересказе (AC-36).
 */

const input: CriticInput = {
  chapterText: "Текст.",
  chapterTitle: "Глава",
  pov: "Рин",
  emotionalGoal: "тревога",
  bookContext: "Книга",
  previousChaptersSummary: "СВОДКА",
  previousChapterTail: "ХВОСТ",
  retrievedContext: "## Релевантные фрагменты предыдущих глав\nФРАГМЕНТ",
  characterContext: null,
  loreContext: null,
};

describe("renderHistoryBlocks", () => {
  it("отдаёт фрагменты, сводку и хвост — в этом порядке", () => {
    const blocks = renderHistoryBlocks(input);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("ФРАГМЕНТ");
    expect(blocks[1]).toBe("Предыдущие главы (краткое):\nСВОДКА");
    expect(blocks[2]).toMatch(/^Финал предыдущей главы \(дословно/);
    expect(blocks[2]).toContain("ХВОСТ");
  });

  it("пропускает отсутствующее, а не рисует пустые заголовки", () => {
    expect(
      renderHistoryBlocks({
        previousChaptersSummary: null,
        previousChapterTail: null,
        retrievedContext: null,
      }),
    ).toEqual([]);
    // Поля необязательные: старый вызывающий без них не ломается.
    expect(renderHistoryBlocks({ previousChaptersSummary: "С" })).toEqual([
      "Предыдущие главы (краткое):\nС",
    ]);
  });

  it("критики получают все три блока через общий рендерер", () => {
    for (const build of [buildEditorPrompt, buildStylePrompt]) {
      const prompt = build(input);
      expect(prompt).toContain("ФРАГМЕНТ");
      expect(prompt).toContain("Предыдущие главы (краткое):\nСВОДКА");
      expect(prompt).toContain("ХВОСТ");
    }
  });
});

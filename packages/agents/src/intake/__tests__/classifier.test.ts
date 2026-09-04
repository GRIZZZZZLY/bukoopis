import { describe, it, expect } from "vitest";
import { buildClassifierPrompt } from "../classifier.js";

const CONTENT = "# Оглавление\n\n## Логлайн\nШестеро героев из двух миров.\n\n## Глава 01\nPOV: Нейла.";

describe("buildClassifierPrompt", () => {
  it("carries the filename and the file content", () => {
    const p = buildClassifierPrompt({ filename: "00_Оглавление.md", content: CONTENT });
    expect(p).toContain("00_Оглавление.md");
    expect(p).toContain("Шестеро героев из двух миров.");
  });

  it("lists every target with its Russian label", () => {
    const p = buildClassifierPrompt({ filename: "x.md", content: CONTENT });
    for (const pair of ["world — Мир", "lore — Лор", "chapters — Готовые главы", "skip — Не пригодилось"]) {
      expect(p).toContain(pair);
    }
  });

  it("includes the book's existing idea when there is one, and says not to replace it", () => {
    const p = buildClassifierPrompt({
      filename: "x.md",
      content: CONTENT,
      bookIdea: "Уже записанная задумка",
    });
    expect(p).toContain("Уже записанная задумка");
    expect(p).toContain("уже есть");
  });

  it("omits the idea block when the book has none", () => {
    expect(buildClassifierPrompt({ filename: "x.md", content: CONTENT })).not.toContain("ЗАДУМКА КНИГИ");
  });

  it("names the stages that already hold material, so the model can match them", () => {
    const p = buildClassifierPrompt({
      filename: "x.md",
      content: CONTENT,
      existingStages: ["Мир: география, климат", "Лор: барьер"],
    });
    expect(p).toContain("Мир: география, климат");
  });
});

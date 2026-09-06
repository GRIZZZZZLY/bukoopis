import { describe, it, expect } from "vitest";
import {
  buildClassifierPrompt,
  registerMaterialClassifierContract,
} from "../intake/classifier.js";
import { getAgentContract } from "@book-forge/llm";

describe("классификатор и поглавное оглавление", () => {
  it("системный промпт велит разбирать оглавление на строки", () => {
    registerMaterialClassifierContract();
    const contract = getAgentContract("material_classifier");
    const system = contract.systemPrompt;
    expect(system).toContain("chapters");
    // Перечислены именно те поля, которые ждёт outlineChapterSchema.
    expect(system).toMatch(/pov/i);
    expect(system).toMatch(/goal/i);
    expect(system).toMatch(/conflict/i);
    expect(system).toMatch(/stakes/i);
    expect(system).toMatch(/hook/i);
  });

  it("промпт запрещает досочинять поля, которых автор не написал", () => {
    registerMaterialClassifierContract();
    const system = getAgentContract("material_classifier").systemPrompt;
    expect(system).toMatch(/не выдумывай|не досочиняй|только то, что написано/i);
  });

  it("промпт файла по-прежнему несёт содержимое и имя", () => {
    const prompt = buildClassifierPrompt({ filename: "план.md", content: "Глава 1" });
    expect(prompt).toContain("план.md");
    expect(prompt).toContain("Глава 1");
  });
});

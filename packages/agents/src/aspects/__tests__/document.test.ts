import { describe, expect, it } from "vitest";
import type { BookConcept, ContextRef } from "@book-forge/shared";
import {
  buildDocumentPrompt,
  documentSystemPrompt,
  toStoredDocumentVariant,
} from "../document.js";

const concept: BookConcept = {
  schemaVersion: 1,
  pitches: [],
  audience: "adult",
  premise: { logline: "Инженер чинит город, который его забыл." },
  genre: "техно-готика",
  tone: "холодный",
};

const contextRef: ContextRef = {
  hash: "h",
  summary: "s",
  includedAspectIds: [],
  includedEntityIds: [],
};

describe("промпт документа", () => {
  it("печатает заметки автора как обязательные к учёту", () => {
    const prompt = buildDocumentPrompt({
      stageId: "world",
      concept,
      existingSections: [],
      emptySectionNames: [],
      authorNotes: "Без магии. Зима круглый год.",
      contextRef,
    });
    expect(prompt).toContain("Без магии. Зима круглый год.");
    expect(prompt).toContain("ЗАМЕТКИ АВТОРА");
  });

  it("называет разделы с текстом неприкосновенными, а пустые — заданием", () => {
    const prompt = buildDocumentPrompt({
      stageId: "world",
      concept,
      existingSections: [{ name: "география", text: "Город стоит на сваях." }],
      emptySectionNames: ["политика"],
      contextRef,
    });
    expect(prompt).toContain("география");
    expect(prompt).toContain("Город стоит на сваях.");
    expect(prompt).toContain("политика");
    // Раздел, у которого уже есть текст, переписывать нельзя — иначе
    // «Собрать» затирало бы материалы автора.
    expect(prompt).toMatch(/НЕ переписывай|не переписывай/);
  });

  it("на пустом этапе просит собрать документ целиком", () => {
    const prompt = buildDocumentPrompt({
      stageId: "lore",
      concept,
      existingSections: [],
      emptySectionNames: [],
      contextRef,
    });
    expect(prompt).toContain("Лор");
    expect(prompt).toContain("5–9");
  });

  it("системный промпт запрещает служебные слова интерфейса", () => {
    expect(documentSystemPrompt).not.toContain("аспект");
  });
});

describe("toStoredDocumentVariant", () => {
  it("кладёт раздел вариантом markdown в статусе generated", () => {
    const v = toStoredDocumentVariant(
      { name: "география", description: "рельеф и климат", markdown: "# география\n\nТекст." },
      { contextRef, modelId: "sonnet" },
    );
    expect(v.payloadKind).toBe("markdown");
    expect(v.status).toBe("generated");
    expect(v.editSource).toBe("llm");
    expect(v.payload).toContain("Текст.");
    expect(v.modelId).toBe("sonnet");
  });
});

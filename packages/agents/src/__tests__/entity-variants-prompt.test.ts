import { describe, it, expect } from "vitest";
import { emptyBookConcept, type BookConcept } from "@book-forge/shared";
import {
  buildEntityVariantsPrompt,
  type AspectEntityVariantsInput,
} from "../aspects/entity-variants.js";

/**
 * Расхождение имён (живой прогон 2026-09-20). Генератор состава получал из
 * замысла только жанр, тон, аудиторию и логлайн. Имя героини стоит в поле
 * `premise.protagonist` — его в промпте не было вовсе, и модель придумывала
 * своё. Дальше книга звала героиню двумя именами: план — как питч, канон —
 * как состав, и события памяти отвергались с «имя героя не разрешилось».
 */

function conceptWith(premise: BookConcept["premise"]): BookConcept {
  return { ...emptyBookConcept(), genre: "магический реализм", tone: "тихий", premise };
}

function inputWith(concept: BookConcept): AspectEntityVariantsInput {
  return {
    stageId: "characters",
    concept,
    aspect: { id: "a1", name: "Протагонист" },
    accumulated: [],
    contextRef: {
      hash: "h",
      summary: "с",
      includedAspectIds: [],
      includedEntityIds: [],
    },
  };
}

describe("buildEntityVariantsPrompt — замысел доезжает до состава", () => {
  it("печатает протагониста из замысла — там стоит имя, выбранное автором", () => {
    const prompt = buildEntityVariantsPrompt(
      inputWith(
        conceptWith({
          logline: "Когда порт замолкает, гидроакустик слышит чужой голос",
          protagonist: "Нина Соловьёва, тридцать четыре, гидроакустик порта",
        }),
      ),
    );
    expect(prompt).toContain("Нина Соловьёва");
  });

  it("печатает конфликт и ставки: там тоже стоят имена второго плана", () => {
    const prompt = buildEntityVariantsPrompt(
      inputWith(
        conceptWith({
          conflict: "Брат Нины, Ворт, подписал акт о списании станции",
          stakes: "Порт закроют до весны",
        }),
      ),
    );
    expect(prompt).toContain("Ворт");
    expect(prompt).toContain("Порт закроют до весны");
  });

  it("печатает крючок замысла", () => {
    const concept: BookConcept = {
      ...conceptWith({ logline: "л" }),
      hook: "Колокол на буе звонит сам",
    };
    expect(buildEntityVariantsPrompt(inputWith(concept))).toContain(
      "Колокол на буе звонит сам",
    );
  });

  it("требует брать названные в замысле имена дословно, а не придумывать свои", () => {
    const prompt = buildEntityVariantsPrompt(
      inputWith(conceptWith({ protagonist: "Нина Соловьёва, гидроакустик" })),
    );
    expect(prompt).toMatch(/имена[^\n]*замысл/i);
  });

  it("без заполненных полей замысла лишних строк не печатает", () => {
    const prompt = buildEntityVariantsPrompt(inputWith(conceptWith({})));
    expect(prompt).not.toContain("Протагонист:");
    expect(prompt).not.toContain("Конфликт:");
    expect(prompt).not.toContain("Ставки:");
    expect(prompt).not.toContain("Крючок:");
  });
});

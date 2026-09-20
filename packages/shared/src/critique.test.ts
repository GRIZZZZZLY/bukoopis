import { describe, it, expect } from "vitest";
import {
  ALL_CRITIC_TYPES,
  criticTypeSchema,
  critiqueIssueSchema,
  characterIssueToolSchema,
  criticReportSchema,
  issueIdFor,
  runRepairInputSchema,
} from "./critique.js";

/**
 * Критик персонажей (этап 5, слайс 2, ТЗ раздел 10). Его замечание несёт
 * больше, чем у четырёх действующих критиков: кого касается, на чём основано,
 * почему это существенно именно здесь и что стоит сохранить. Расширять общую
 * схему обязательными полями нельзя — у четырёх действующих их нет и не
 * будет, — поэтому поля необязательные в схеме отчёта и обязательные в
 * тулсхеме этого критика.
 */

const baseIssue = {
  severity: "suggestion" as const,
  summary: "Ворт и Нина одинаково уходят от прямого ответа",
  excerpt: "— Не знаю. — Не знаю.",
  suggestion: "Разведите способ уклонения: один молчит, другая переводит тему",
};

const characterFields = {
  category: "interchangeable",
  affectedCharacters: ["Нина Соловьёва", "Ворт Соловьёв"],
  basis: "профили: у Ворта принцип «не врать прямо», у Нины его нет",
  whyHere: "сцена строится на том, что один из них должен сломаться первым",
  alternativeReading: "оба молчат от усталости, а не от характера",
  keep: "пауза перед вторым «не знаю» работает",
};

describe("criticTypeSchema", () => {
  it("знает критика персонажей", () => {
    expect(criticTypeSchema.safeParse("character").success).toBe(true);
  });

  it("критик персонажей входит в набор по умолчанию", () => {
    expect(ALL_CRITIC_TYPES).toContain("character");
  });
});

describe("critiqueIssueSchema — поля критика персонажей необязательны", () => {
  it("замечание старого критика по-прежнему проходит", () => {
    expect(critiqueIssueSchema.safeParse(baseIssue).success).toBe(true);
  });

  it("замечание с полями персонажей тоже проходит", () => {
    const out = critiqueIssueSchema.safeParse({ ...baseIssue, ...characterFields });
    expect(out.success).toBe(true);
  });

  it("сохранённый отчёт с такими замечаниями читается целиком", () => {
    const out = criticReportSchema.safeParse({
      critic: "character",
      overallNotes: "Герои различимы, кроме одной пары реплик",
      issues: [{ ...baseIssue, ...characterFields }],
    });
    expect(out.success).toBe(true);
  });
});

describe("characterIssueToolSchema — что критик обязан прислать", () => {
  it("полное замечание принимается", () => {
    expect(characterIssueToolSchema.safeParse({ ...baseIssue, ...characterFields }).success).toBe(
      true,
    );
  });

  it("без цитаты замечания нет: сигнал только с доказательством", () => {
    const { excerpt: _drop, ...noQuote } = { ...baseIssue, ...characterFields };
    expect(characterIssueToolSchema.safeParse(noQuote).success).toBe(false);
  });

  it("без основания не принимается: впечатление не замечание", () => {
    const { basis: _drop, ...noBasis } = { ...baseIssue, ...characterFields };
    expect(characterIssueToolSchema.safeParse(noBasis).success).toBe(false);
  });

  it("взаимозаменяемость с одним персонажем не принимается (AC-28)", () => {
    const out = characterIssueToolSchema.safeParse({
      ...baseIssue,
      ...characterFields,
      affectedCharacters: ["Нина Соловьёва"],
    });
    expect(out.success).toBe(false);
  });

  it("другая категория с одним персонажем — норма", () => {
    const out = characterIssueToolSchema.safeParse({
      ...baseIssue,
      ...characterFields,
      category: "knowledge_breach",
      affectedCharacters: ["Нина Соловьёва"],
    });
    expect(out.success).toBe(true);
  });

  it("категория не из списка отвергается", () => {
    const out = characterIssueToolSchema.safeParse({
      ...baseIssue,
      ...characterFields,
      category: "плохо_написано",
    });
    expect(out.success).toBe(false);
  });
});

// ───────── Локальная правка (этап 5, слайс 3) ─────────
//
// Правка умела только «исправь всё серьёзнее такого-то уровня». Автор не мог
// сказать «вот это одно, и не трогай абзац, который мне нравится» — а после
// критики, которая различает героев, нужно именно это (AC-29).

describe("issueIdFor", () => {
  it("склеивает критика и позицию замечания", () => {
    expect(issueIdFor("character", 0)).toBe("character:0");
    expect(issueIdFor("style", 3)).toBe("style:3");
  });

  it("идентификаторы разных критиков не совпадают", () => {
    expect(issueIdFor("canon", 1)).not.toBe(issueIdFor("reader", 1));
  });
});

describe("runRepairInputSchema — выбранные замечания и защищённые куски", () => {
  it("принимает пустое тело: прежнее поведение не сломано", () => {
    expect(runRepairInputSchema.safeParse({}).success).toBe(true);
  });

  it("принимает выбранные замечания", () => {
    const out = runRepairInputSchema.safeParse({
      selectedIssueIds: ["character:0", "style:2"],
    });
    expect(out.success).toBe(true);
  });

  it("принимает защищённые фрагменты", () => {
    const out = runRepairInputSchema.safeParse({
      protectedFragments: ["Металл был тёплый."],
    });
    expect(out.success).toBe(true);
  });

  it("пустой список выбранных не принимается: это не то же, что «не выбирал»", () => {
    expect(runRepairInputSchema.safeParse({ selectedIssueIds: [] }).success).toBe(false);
  });

  it("пустая строка защищённым фрагментом быть не может", () => {
    expect(runRepairInputSchema.safeParse({ protectedFragments: ["  "] }).success).toBe(false);
  });

  it("слишком короткий фрагмент не принимается: он найдётся где угодно", () => {
    expect(runRepairInputSchema.safeParse({ protectedFragments: ["Да."] }).success).toBe(false);
  });
});

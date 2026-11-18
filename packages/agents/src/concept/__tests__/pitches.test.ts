import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@book-forge/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@book-forge/llm")>()),
  dispatchStructured: vi.fn(),
}));

import { dispatchStructured } from "@book-forge/llm";
import { renderClicheRule, AUDIENCE_LABELS } from "@book-forge/shared";
import {
  PITCH_GENERATOR_SYSTEM,
  buildPitchGeneratorPrompt,
  runPitchGenerator,
  toPitches,
  pitchDraftSchema,
  type PitchDraft,
  type PitchGeneratorInput,
  type PitchGeneratorOutput,
} from "../pitches.js";
import { AUTHOR_FACING_LANGUAGE_RULES, CONCEPT_LANGUAGE_RULES } from "../../language-rules.js";

const DRAFT: PitchDraft = {
  workingTitle: "  Маршрут, который врёт ",
  logline: "Когда карта рода расходится с морем, Нейла должна выбрать между кодексом и глазами.",
  protagonist: "Нейла, проводница каравана.",
  conflict: "Маршрут ведёт в аномалию.",
  stakes: "Караван и репутация семьи.",
  hook: "В архивах маршрута — невозможная правка.",
  genre: "фантастика выживания",
  tone: "холодный",
  audience: "adult",
  strength: "Понятный конфликт долга и наблюдения.",
  risk: "Много мира до первого выбора.",
};

describe("buildPitchGeneratorPrompt", () => {
  it("carries the idea, the count and the direction", () => {
    const p = buildPitchGeneratorPrompt({
      idea: "Шестеро героев из двух враждующих миров.",
      direction: "мрачнее",
      count: 4,
    });
    expect(p).toContain("Шестеро героев из двух враждующих миров.");
    expect(p).toContain("ровно 4");
    expect(p).toContain("мрачнее");
  });

  it("defaults to four pitches and lists pitches to avoid", () => {
    const p = buildPitchGeneratorPrompt({
      idea: "Шестеро героев из двух враждующих миров.",
      avoid: [{ workingTitle: "Соляной архив", logline: "Инженер читает регистр." }],
    });
    expect(p).toContain("ровно 4");
    expect(p).toContain("«Соляной архив»");
    expect(p).toContain("Инженер читает регистр.");
  });

  it("omits the avoid block when there is nothing to avoid", () => {
    const p = buildPitchGeneratorPrompt({ idea: "Шестеро героев из двух враждующих миров." });
    expect(p).not.toContain("УЖЕ ПОКАЗАННЫЕ");
  });
});

describe("toPitches", () => {
  it("assigns ids in order and trims every string field", () => {
    let n = 0;
    const out = toPitches([DRAFT, { ...DRAFT, workingTitle: "Второй" }], () => `id-${++n}`);
    expect(out.map((p) => p.id)).toEqual(["id-1", "id-2"]);
    expect(out[0]?.workingTitle).toBe("Маршрут, который врёт");
    expect(out[1]?.workingTitle).toBe("Второй");
    expect(out[0]?.audience).toBe("adult");
  });
});

describe("pitchDraftSchema", () => {
  it("has no id and rejects blanks", () => {
    expect(pitchDraftSchema.safeParse(DRAFT).success).toBe(true);
    expect(pitchDraftSchema.safeParse({ ...DRAFT, id: "x" }).success).toBe(true);
    expect(pitchDraftSchema.safeParse({ ...DRAFT, risk: "" }).success).toBe(false);
  });
});

describe("PITCH_GENERATOR_SYSTEM", () => {
  it("carries the shared cliche rule", () => {
    expect(PITCH_GENERATOR_SYSTEM).toContain(renderClicheRule());
  });

  it("does not force the «Когда» logline template", () => {
    expect(PITCH_GENERATOR_SYSTEM).not.toContain("Схема: «Когда");
    expect(PITCH_GENERATOR_SYSTEM).toContain("начинаться по-разному");
  });

  it("defaults audience to adult and says a young hero is not a reason for ya", () => {
    expect(PITCH_GENERATOR_SYSTEM).toContain("По умолчанию adult");
    expect(PITCH_GENERATOR_SYSTEM).toContain("Юный герой сам по себе не повод для ya");
  });

  it("forbids invented facts", () => {
    expect(PITCH_GENERATOR_SYSTEM).toContain("не добавляй биографических фактов");
  });

  it("uses the plain label for ya", () => {
    expect(AUDIENCE_LABELS.ya).toBe("подростки и молодёжь");
  });

  it("keeps the author's hero and stage; heroes differ only when the author set none", () => {
    expect(PITCH_GENERATOR_SYSTEM).toContain(
      "Если автор задал героя или этап его пути (например, становление, первая книга цикла), каждый питч сохраняет этого героя и этот этап.",
    );
    expect(PITCH_GENERATOR_SYSTEM).toContain(
      "Питчи тогда различаются конфликтом, противником, местом действия или масштабом.",
    );
    expect(PITCH_GENERATOR_SYSTEM).toContain("Если героя автор не задал, питчи различаются и героями.");
    expect(PITCH_GENERATOR_SYSTEM).not.toContain("разные протагонисты");
  });

  it("the avoid block does not ask to change the author's hero", () => {
    const p = buildPitchGeneratorPrompt({
      idea: "Первая книга — становление героя.",
      avoid: [{ workingTitle: "Соляной архив", logline: "Инженер читает регистр." }],
    });
    expect(p).not.toContain("ни героя");
  });
});

describe("AUTHOR_FACING_LANGUAGE_RULES", () => {
  it("lists the new calques", () => {
    expect(AUTHOR_FACING_LANGUAGE_RULES).toContain("«клиффхэнгер»");
    expect(CONCEPT_LANGUAGE_RULES).toContain("«арка (персонажа)»");
  });

  it("keeps the note register, the no-praise line and «арка» to the concept agents", () => {
    expect(AUTHOR_FACING_LANGUAGE_RULES).not.toMatch(/записка|похвал|арка/);
    expect(CONCEPT_LANGUAGE_RULES.startsWith(AUTHOR_FACING_LANGUAGE_RULES)).toBe(true);
    expect(CONCEPT_LANGUAGE_RULES).toContain("рабочая записка редактора");
    expect(PITCH_GENERATOR_SYSTEM).toContain(CONCEPT_LANGUAGE_RULES);
  });
});

describe("runPitchGenerator: contrast retry", () => {
  const dispatchMock = vi.mocked(dispatchStructured);
  const INPUT: PitchGeneratorInput = { idea: "Первая книга — становление героя.", direction: "мрачнее" };
  const DIAG = {
    modelId: "claude-sonnet",
    backend: "api" as const,
    inputTokens: 10,
    outputTokens: 5,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    latencyMs: 1,
  };

  function out(...extra: Array<Partial<PitchDraft>>): PitchGeneratorOutput {
    return {
      pitches: [DRAFT, DRAFT, DRAFT].map((d, i) => ({ ...d, ...(extra[i] ?? {}) })),
      questions: [],
    };
  }
  function answers(...outs: Array<PitchGeneratorOutput | Error>) {
    for (const o of outs) {
      if (o instanceof Error) dispatchMock.mockRejectedValueOnce(o);
      else dispatchMock.mockResolvedValueOnce({ raw: o, diagnostics: DIAG });
    }
  }
  function payloadOf(call: number): PitchGeneratorInput {
    return dispatchMock.mock.calls[call]![0].payload as PitchGeneratorInput;
  }

  beforeEach(() => dispatchMock.mockReset());

  it("a clean first result makes no retry", async () => {
    const clean = out();
    answers(clean);
    const onUsage = vi.fn();
    expect(await runPitchGenerator(INPUT, { onUsage })).toBe(clean);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledTimes(1);
  });

  it("«не X, а Y» triggers exactly one retry naming the fragment", async () => {
    const dirty = out({ stakes: "Он крадёт не из амбиций, а из необходимости." });
    const clean = out();
    answers(dirty, clean);
    const onUsage = vi.fn();
    expect(await runPitchGenerator(INPUT, { onUsage })).toBe(clean);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    const retry = payloadOf(1);
    expect(retry.idea).toBe(INPUT.idea);
    expect(retry.direction).toContain("мрачнее");
    expect(retry.direction).toContain("не из амбиций, а из необходимости");
    expect(retry.direction).toContain("«не X, а Y»");
    expect(retry.direction).toContain("«X, а не Y»");
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ modelId: "claude-sonnet", inputTokens: 10 }));
  });

  it("a still-dirty retry: the result with fewer matches wins, and no third call", async () => {
    const two = out({ hook: "Это настоящий поворот, а не просто закрытие." }, { risk: "Не трофей, а инструмент." });
    const one = out({ conflict: "Он остаётся одиночкой без будущего, а не тем, кем мог стать." });
    answers(two, one);
    expect(await runPitchGenerator(INPUT)).toBe(one);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it("a tie keeps the first result", async () => {
    const a = out({ hook: "Не трофей, а инструмент." });
    const b = out({ risk: "Не долг, а страх." });
    answers(a, b);
    expect(await runPitchGenerator(INPUT)).toBe(a);
  });

  it("a failed retry returns the first result", async () => {
    const dirty = out({ hook: "Не трофей, а инструмент." });
    answers(dirty, new Error("boom"));
    const onUsage = vi.fn();
    expect(await runPitchGenerator(INPUT, { onUsage })).toBe(dirty);
    expect(onUsage).toHaveBeenCalledTimes(1);
  });
});

describe("runPitchGenerator: local", () => {
  it("forwards local to dispatchStructured, including on the contrast retry", async () => {
    const dispatchMock = vi.mocked(dispatchStructured);
    dispatchMock.mockReset();
    const diag = {
      modelId: "ollama:qwen:9b", backend: "api" as const, inputTokens: 1, outputTokens: 1,
      cacheCreationInputTokens: 0, cacheReadInputTokens: 0, latencyMs: 1,
    };
    const dirty = { pitches: [{ ...DRAFT, hook: "Не трофей, а инструмент." }, DRAFT, DRAFT], questions: [] };
    dispatchMock.mockResolvedValueOnce({ raw: dirty, diagnostics: diag });
    dispatchMock.mockResolvedValueOnce({ raw: { pitches: [DRAFT, DRAFT, DRAFT], questions: [] }, diagnostics: diag });
    await runPitchGenerator({ idea: "Первая книга — становление героя." }, { local: { model: "qwen:9b" } });
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    for (const call of dispatchMock.mock.calls) expect(call[0].local).toEqual({ model: "qwen:9b" });
  });
});

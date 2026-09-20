import { describe, it, expect } from "vitest";
import {
  CAST_CHECK_SITUATIONS,
  castCheckReportSchema,
  castCheckToolSchema,
  castCheckBasisOf,
  isCastCheckStale,
  renderCastForCheck,
} from "./cast-check.js";

/**
 * Проверка различий состава (ТЗ 9.1, этап 5 слайс 4). Отчёт — предложение, а
 * не правка: ничего не меняется автоматически, и требовать сделать героев
 * максимально противоположными нельзя.
 */

const pair = {
  characterIds: [7, 9] as [number, number],
  similarity: "оба уходят от прямого ответа и ждут, пока собеседник договорит за них",
  basis: "у обоих в принципах «не говорить первым», речь построена на отрицании",
  situations: ["request_for_help", "pressure_from_authority"],
  directions: [
    "Ворту дать физическое действие вместо паузы: он идёт проверять насос",
    "Нине оставить прямой вопрос — она давит, а не ждёт",
  ],
  keep: "сама пауза работает, различать нужно то, чем она занята",
};

const report = {
  generatedAt: "2026-09-20T10:00:00.000Z",
  basis: [
    { characterId: 7, revision: 2 },
    { characterId: 9, revision: 1 },
  ],
  pairs: [pair],
  notes: "Остальные герои различимы",
};

describe("castCheckReportSchema", () => {
  it("принимает полный отчёт", () => {
    expect(castCheckReportSchema.parse(report).pairs).toHaveLength(1);
  });

  it("пустой список пар — валидный ответ: состав может быть различим", () => {
    expect(castCheckReportSchema.parse({ ...report, pairs: [] }).pairs).toEqual([]);
  });

  it("не режет длинные формулировки: это схема чтения", () => {
    const long = "я".repeat(3000);
    const parsed = castCheckReportSchema.parse({
      ...report,
      pairs: [{ ...pair, similarity: long }],
    });
    expect(parsed.pairs[0]?.similarity).toHaveLength(3000);
  });
});

describe("castCheckToolSchema — что модель обязана прислать", () => {
  it("полная пара принимается", () => {
    expect(castCheckToolSchema.safeParse({ pairs: [pair], notes: "з" }).success).toBe(true);
  });

  it("пара без основания не принимается: впечатление не отчёт", () => {
    const { basis: _drop, ...noBasis } = pair;
    expect(castCheckToolSchema.safeParse({ pairs: [noBasis], notes: "з" }).success).toBe(false);
  });

  it("пара без направлений не принимается: отчёт обязан предлагать выход", () => {
    expect(
      castCheckToolSchema.safeParse({ pairs: [{ ...pair, directions: [] }], notes: "з" }).success,
    ).toBe(false);
  });

  it("ситуация не из каталога отвергается", () => {
    const out = castCheckToolSchema.safeParse({
      pairs: [{ ...pair, situations: ["ссора_в_баре"] }],
      notes: "з",
    });
    expect(out.success).toBe(false);
  });

  it("пара из одного героя не принимается: сходство показывается на двоих", () => {
    const out = castCheckToolSchema.safeParse({
      pairs: [{ ...pair, characterIds: [7] }],
      notes: "з",
    });
    expect(out.success).toBe(false);
  });

  it("герой сам с собой не пара", () => {
    const out = castCheckToolSchema.safeParse({
      pairs: [{ ...pair, characterIds: [7, 7] }],
      notes: "з",
    });
    expect(out.success).toBe(false);
  });

  it("основы отчёта модель не присылает: их ставит сервер", () => {
    const out = castCheckToolSchema.safeParse({
      pairs: [pair],
      notes: "з",
      basis: [{ characterId: 7, revision: 2 }],
    });
    expect(out.success).toBe(false);
  });
});

describe("castCheckBasisOf и isCastCheckStale", () => {
  const cast = [
    { id: 7, revision: 2 },
    { id: 9, revision: 1 },
  ];

  it("основа отчёта — герои и их ревизии", () => {
    expect(castCheckBasisOf(cast)).toEqual([
      { characterId: 7, revision: 2 },
      { characterId: 9, revision: 1 },
    ]);
  });

  it("тот же состав — отчёт не устарел", () => {
    expect(isCastCheckStale(castCheckReportSchema.parse(report), cast)).toBe(false);
  });

  it("правка героя делает отчёт устаревшим", () => {
    const edited = [
      { id: 7, revision: 3 },
      { id: 9, revision: 1 },
    ];
    expect(isCastCheckStale(castCheckReportSchema.parse(report), edited)).toBe(true);
  });

  it("новый герой делает отчёт устаревшим", () => {
    expect(isCastCheckStale(castCheckReportSchema.parse(report), [...cast, { id: 11, revision: 0 }])).toBe(
      true,
    );
  });

  it("порядок героев на устаревание не влияет", () => {
    expect(isCastCheckStale(castCheckReportSchema.parse(report), [...cast].reverse())).toBe(false);
  });
});

describe("renderCastForCheck", () => {
  const cast = [
    {
      id: 7,
      name: "Нина Соловьёва",
      profile: {
        role: "гидроакустик",
        want: "доказать, что сигнал настоящий",
        voice: "короткие фразы",
        principles: [{ text: "не давить на брата прямо" }],
        values: [{ text: "запись важнее объяснения" }],
      },
    },
    { id: 9, name: "Ворт Соловьёв", profile: { role: "техник" } },
  ];

  it("печатает номер и имя: номер уезжает обратно в ответе", () => {
    const out = renderCastForCheck(cast);
    expect(out).toContain("7");
    expect(out).toContain("Нина Соловьёва");
  });

  it("печатает цели, принципы, ценности и голос — по ним и считается похожесть", () => {
    const out = renderCastForCheck(cast);
    expect(out).toContain("доказать, что сигнал настоящий");
    expect(out).toContain("не давить на брата прямо");
    expect(out).toContain("запись важнее объяснения");
    expect(out).toContain("короткие фразы");
  });

  it("у героя без полей лишних заголовков нет", () => {
    const out = renderCastForCheck([cast[1]!]);
    expect(out).not.toContain("Хочет:");
    expect(out).not.toContain("Принципы:");
  });
});

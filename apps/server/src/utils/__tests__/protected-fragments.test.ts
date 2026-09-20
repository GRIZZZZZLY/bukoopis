import { describe, it, expect } from "vitest";
import {
  locateProtectedFragments,
  survivingFragments,
} from "../protected-fragments.js";

/**
 * Защищённые фрагменты (этап 5, AC-29). Правило то же, что у доказательства
 * события: привязка либо однозначна, либо её нет. Фрагмент, встречающийся
 * дважды, защитить нельзя — непонятно, какой из двух автор имел в виду.
 */

const TEXT = `Порт молчал третью неделю. Металл был тёплый.

— Не знаю, — сказал Ворт.

Она не обернулась. Металл был тёплый.`;

describe("locateProtectedFragments", () => {
  it("принимает фрагмент, встречающийся ровно один раз", () => {
    const out = locateProtectedFragments(TEXT, ["Она не обернулась."]);
    expect(out.accepted).toEqual(["Она не обернулась."]);
    expect(out.rejected).toEqual([]);
  });

  it("отвергает фрагмент, встречающийся дважды", () => {
    const out = locateProtectedFragments(TEXT, ["Металл был тёплый."]);
    expect(out.accepted).toEqual([]);
    expect(out.rejected[0]?.reason).toBe("ambiguous");
  });

  it("отвергает фрагмент, которого в тексте нет", () => {
    const out = locateProtectedFragments(TEXT, ["Металл был холодный."]);
    expect(out.rejected[0]?.reason).toBe("not_found");
  });

  it("сравнивает с поправкой на пробелы и переносы, а не байт в байт", () => {
    const out = locateProtectedFragments(TEXT, ["Порт  молчал\n  третью неделю."]);
    expect(out.accepted).toHaveLength(1);
  });

  it("разбирает все фрагменты, а не останавливается на первом отказе", () => {
    const out = locateProtectedFragments(TEXT, [
      "Металл был тёплый.",
      "Она не обернулась.",
    ]);
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
  });
});

describe("survivingFragments", () => {
  it("находит тронутые фрагменты в результате правки", () => {
    const revised = "Порт молчал третью неделю. Она обернулась.";
    expect(survivingFragments(revised, ["Она не обернулась."])).toEqual({
      kept: [],
      lost: ["Она не обернулась."],
    });
  });

  it("нетронутые не считает потерянными", () => {
    const revised = "Совсем другой текст. Она не обернулась. И ещё.";
    expect(survivingFragments(revised, ["Она не обернулась."])).toEqual({
      kept: ["Она не обернулась."],
      lost: [],
    });
  });

  it("правка, изменившая пробелы, фрагмент не теряет", () => {
    const revised = "Она  не\nобернулась.";
    expect(survivingFragments(revised, ["Она не обернулась."]).kept).toHaveLength(1);
  });
});

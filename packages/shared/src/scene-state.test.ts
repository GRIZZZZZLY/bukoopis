import { describe, expect, it } from "vitest";
import {
  isEmptySceneState,
  renderSceneStatePrompt,
  sceneStateSchema,
  sceneStateToolSchema,
} from "./scene-state.js";

const empty = sceneStateSchema.parse({});

describe("sceneStateSchema (чтение)", () => {
  it("принимает пустой объект — у старых строк полей нет", () => {
    expect(empty.place).toBeNull();
    expect(empty.carried).toEqual([]);
  });

  it("негодное поле не роняет разбор, а становится умолчанием (AC-8)", () => {
    const parsed = sceneStateSchema.parse({
      place: "причал",
      carried: "мешок",
      condition: [{ name: "Нина", value: "рука на перевязи" }],
    });
    expect(parsed.place).toBe("причал");
    expect(parsed.carried).toEqual([]);
    expect(parsed.condition).toHaveLength(1);
  });

  it("не режет длинные строки — предел живёт только в схеме ответа", () => {
    const long = "а".repeat(2000);
    expect(sceneStateSchema.parse({ place: long }).place).toBe(long);
    expect(sceneStateToolSchema.safeParse({ ...blank, place: long }).success).toBe(false);
  });
});

const blank = {
  place: null,
  timeMarker: null,
  present: [],
  appearance: [],
  carried: [],
  condition: [],
  surroundings: [],
  loose: [],
  changes: [],
};

describe("sceneStateToolSchema (ответ модели)", () => {
  it("лишнее поле отвергается", () => {
    expect(sceneStateToolSchema.safeParse({ ...blank, chapterId: 4 }).success).toBe(false);
  });

  it("пустая анкета — валидный ответ: бывает сцена, где нечего сказать", () => {
    expect(sceneStateToolSchema.safeParse(blank).success).toBe(true);
  });
});

describe("renderSceneStatePrompt", () => {
  it("пустая анкета не печатается вовсе", () => {
    expect(isEmptySceneState(empty)).toBe(true);
    expect(renderSceneStatePrompt(empty, "глава 4")).toBeNull();
  });

  it("называет главу и печатает только непустые группы", () => {
    const state = sceneStateSchema.parse({
      place: "причал",
      present: ["Нина — у воды", "  "],
      carried: [
        { name: "Нина", value: "ключ от склада" },
        { name: " ", value: "пусто" },
      ],
      loose: [],
    });
    const out = renderSceneStatePrompt(state, "глава 4 «Отлив»");
    expect(out).toContain("глава 4 «Отлив»");
    expect(out).toContain("Место: причал");
    expect(out).toContain("— Нина: ключ от склада");
    expect(out).not.toContain("Осталось незакрытым");
    // пустая строка списка выброшена, а не напечатана прочерком
    expect(out?.match(/^— /gm)).toHaveLength(2);
  });
});

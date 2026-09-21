import { describe, it, expect } from "vitest";
import {
  buildSceneStatePrompt,
  SCENE_STATE_SYSTEM,
} from "../scene-state-extractor.js";

/** Промпт извлекателя анкеты: состав книги и прошлая анкета обязаны доехать —
 *  без первого модель придумывает имена, без второго поле «изменилось» пусто
 *  по построению. */

const BASE = {
  chapterTitle: "Отлив",
  chapterPosition: 4,
  chapterText: "Нина заперла склад и осталась на причале.",
  castNames: ["Нина Соловьёва", "Ворт Соловьёв"],
  previousState: null,
};

describe("buildSceneStatePrompt", () => {
  it("печатает номер главы позицией, состав и текст", () => {
    const p = buildSceneStatePrompt(BASE);
    expect(p).toContain('Глава 4: "Отлив"');
    expect(p).toContain("Нина Соловьёва, Ворт Соловьёв");
    expect(p).toContain("осталась на причале");
  });

  it("анкета прошлой главы попадает в промпт, когда она есть", () => {
    const p = buildSceneStatePrompt({
      ...BASE,
      previousState: "Место: склад",
    });
    expect(p).toContain("Анкета предыдущей главы");
    expect(p).toContain("Место: склад");
  });

  it("без прошлой анкеты блока нет вовсе — пустой заголовок читается как «ничего не было»", () => {
    expect(buildSceneStatePrompt(BASE)).not.toContain("Анкета предыдущей главы");
  });

  it("системный промпт запрещает додумывать и толковать", () => {
    expect(SCENE_STATE_SYSTEM).toContain("Не достраивай");
    expect(SCENE_STATE_SYSTEM).toContain("толкование");
    expect(SCENE_STATE_SYSTEM).toContain("КОНЕЦ ГЛАВЫ");
  });
});

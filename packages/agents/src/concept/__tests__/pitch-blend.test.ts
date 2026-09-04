import { describe, it, expect } from "vitest";
import { buildPitchBlenderPrompt } from "../pitch-blend.js";
import type { Pitch } from "@book-forge/shared";

const A: Pitch = {
  id: "a",
  workingTitle: "Соляной архив",
  logline: "Инженер читает в кристалле регистр выбраковки.",
  protagonist: "Джасра, метролог.",
  conflict: "Регистр называет её саму.",
  stakes: "Фабрика имплантов станет орудием выбраковки.",
  hook: "В списке — её имя.",
  genre: "научная фантастика",
  tone: "инженерный",
  audience: "adult",
  strength: "Сильный крючок.",
  risk: "Тяжёлый вход.",
};
const B: Pitch = { ...A, id: "b", workingTitle: "Маршрут, который врёт", protagonist: "Нейла, проводница.", conflict: "Карта рода расходится с морем." };

describe("buildPitchBlenderPrompt", () => {
  it("labels sources A, B… and states which field comes from where", () => {
    const p = buildPitchBlenderPrompt({
      idea: "Шестеро героев из двух миров.",
      sources: [A, B],
      picks: { protagonist: "b", conflict: "a" },
    });
    expect(p).toContain("ПИТЧ A «Соляной архив»");
    expect(p).toContain("ПИТЧ B «Маршрут, который врёт»");
    expect(p).toContain("Кто главный и чего хочет — из питча B");
    expect(p).toContain("Что ему мешает — из питча A");
    expect(p).not.toContain("Крючок — из питча");
  });

  it("includes the author's note when given", () => {
    const p = buildPitchBlenderPrompt({
      idea: "Шестеро героев.",
      sources: [A],
      picks: { logline: "a" },
      note: "сделай камернее",
    });
    expect(p).toContain("сделай камернее");
  });
});

import { describe, it, expect } from "vitest";
import {
  measureStructuralTells,
  renderStructuralTells,
  splitScenesForCadence,
} from "../tells.js";

// Structural LLM tells are counted, not judged: the prompt bans for
// «не X, а Y» and the rule of three are ignored by the writer 10–25× per
// chapter, while single-token bans hold. Anything a regex can find belongs
// here so a critic gets evidence and a prompt change gets a regression metric.

describe("measureStructuralTells — negative parallelism", () => {
  it("counts «не X, а Y» contrasts", () => {
    const r = measureStructuralTells(
      "Он не траву собирал, а вынимал младенца. Она молчала.",
    );
    expect(r.counts.negativeParallelism).toBe(1);
  });

  it("counts «не только X, но и Y»", () => {
    const r = measureStructuralTells("Не только руки, но и голос дрожал.");
    expect(r.counts.negativeParallelism).toBe(1);
  });

  it("counts the two-sentence form «Это был не X. Это был Y.»", () => {
    const r = measureStructuralTells(
      "Это был не взгляд отца. Это был взгляд хозяина на корову.",
    );
    expect(r.counts.negativeParallelism).toBe(1);
  });

  it("counts the dash form «не X — а Y»", () => {
    const r = measureStructuralTells("В нём дрожала не дрожь — а готовность дрожать.");
    expect(r.counts.negativeParallelism).toBe(1);
  });

  it("counts a negated list «не X, не Y, а Z» once", () => {
    const r = measureStructuralTells(
      "Что-то в нём — не голова, не сердце, а что-то ниже — повернулось.",
    );
    expect(r.counts.negativeParallelism).toBe(1);
  });

  it("does not count temporal «, а когда» / «, а потом» as a contrast", () => {
    const r = measureStructuralTells(
      "Он не заметил поначалу, а когда заметил, у него ослабли колени.",
    );
    expect(r.counts.negativeParallelism).toBe(0);
  });
});

describe("measureStructuralTells — rule of three", () => {
  it("counts a comma triad of short items", () => {
    const r = measureStructuralTells("Он был тих, бледен и упрям.");
    expect(r.counts.triad).toBe(1);
  });

  it("counts three consecutive short sentences opening with the same word", () => {
    const r = measureStructuralTells("Ты камень. Ты пенёк. Ты доска.");
    expect(r.counts.triad).toBe(1);
  });

  it("does not count a four-item list", () => {
    const r = measureStructuralTells("Хлеб, лук, соль и квас стояли на столе.");
    expect(r.counts.triad).toBe(0);
  });
});

describe("measureStructuralTells — similes, filter verbs, tails, clichés", () => {
  it("counts explicit simile markers but not the ambiguous «как»", () => {
    const r = measureStructuralTells(
      "Голос был тихий, словно из-под воды. Он смотрел, как она уходит. Будто дерево трещит.",
    );
    expect(r.counts.simile).toBe(2);
  });

  it("counts filter verbs of perception", () => {
    const r = measureStructuralTells(
      "Он понял, что опоздал. Она почувствовала холод. Дверь закрылась.",
    );
    expect(r.counts.filterVerb).toBe(2);
  });

  it("counts a trailing деепричастный оборот closing the sentence", () => {
    const r = measureStructuralTells(
      "Он шёл вдоль стены, прижимаясь к камню. Ратибор лежал.",
    );
    expect(r.counts.participialClause).toBe(1);
  });

  it("counts a leading деепричастный оборот as well", () => {
    const r = measureStructuralTells("Прижимаясь к камню, он шёл вдоль стены.");
    expect(r.counts.participialClause).toBe(1);
  });

  it("counts an imperfective -ивая/-ывая and a -яя gerund", () => {
    const r = measureStructuralTells(
      "— Хороша каша, — сказал Всеслав, отправляя ложку в рот. Он сидел, размешивая мёд.",
    );
    expect(r.counts.participialClause).toBe(2);
  });

  it("does not count adjective-led clauses or names ending in -ав as gerunds", () => {
    const r = measureStructuralTells(
      "Изба была старая, рубленая ещё дедом. Тень лежала отдельно, короткая, под ногами. Куртка была синяя, поздняя. Сказал Всеслав, и все замолчали.",
    );
    expect(r.counts.participialClause).toBe(0);
  });

  it("counts a body noun next to an affect verb as embodied emotion, in either order", () => {
    const r = measureStructuralTells(
      "Сердце упало в живот. По спине пробежал холодок. У него ослабли колени. Он ел кашу.",
    );
    expect(r.counts.embodiedEmotion).toBe(3);
  });

  it("counts «мурашки» on its own", () => {
    const r = measureStructuralTells("Мурашки. Он стоял.");
    expect(r.counts.embodiedEmotion).toBe(1);
  });

  it("counts «Это был…» sentence openers", () => {
    const r = measureStructuralTells(
      "Это был Всеслав. Он молчал. Это была решимость.",
    );
    expect(r.counts.etoBylOpener).toBe(2);
  });
});

describe("measureStructuralTells — rhythm", () => {
  it("reports the share of sentences with three words or fewer", () => {
    const r = measureStructuralTells(
      "Бежать. Дверь закрылась. Он долго стоял у окна и смотрел на двор.",
    );
    expect(r.sentenceCount).toBe(3);
    expect(r.shortSentenceShare).toBeCloseTo(2 / 3, 2);
  });

  it("reports the share of punch-line paragraphs of six words or fewer", () => {
    const r = measureStructuralTells(
      "Он долго стоял у окна и смотрел на двор, где никого не было.\n\nОна шла к нему.\n\nДверь закрылась.",
    );
    expect(r.punchParagraphShare).toBeCloseTo(2 / 3, 2);
  });

  it("measures cadence spread across scenes, zero when every scene keeps one cadence", () => {
    const flat = ["Он ушёл. Она осталась.", "Он сел. Она встала."];
    const r = measureStructuralTells(flat.join("\n\n"), { scenes: flat });
    expect(r.sceneCadence.sceneCount).toBe(2);
    expect(r.sceneCadence.spread).toBe(0);
  });

  it("cadence spread grows when scenes differ in mean sentence length", () => {
    const varied = [
      "Он ушёл. Она осталась.",
      "Он долго стоял у окна и смотрел на двор, где никого не было, и думал о том, что случилось.",
    ];
    const r = measureStructuralTells(varied.join("\n\n"), { scenes: varied });
    expect(r.sceneCadence.spread).toBeGreaterThan(0.5);
  });
});

describe("splitScenesForCadence", () => {
  it("splits on separator lines when present", () => {
    const scenes = splitScenesForCadence("Один абзац.\n\n***\n\nДругой абзац.");
    expect(scenes).toEqual(["Один абзац.", "Другой абзац."]);
  });

  it("falls back to equal paragraph chunks when there are no separators", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Абзац номер ${i}.`);
    const scenes = splitScenesForCadence(paragraphs.join("\n\n"), 5);
    expect(scenes).toHaveLength(5);
    expect(scenes[0]).toContain("Абзац номер 0.");
    expect(scenes[0]).toContain("Абзац номер 1.");
  });
});

describe("measureStructuralTells — normalisation and evidence", () => {
  it("normalises counts per thousand words", () => {
    const filler = Array.from({ length: 497 }, (_, i) => `с${i}`).join(" ");
    const r = measureStructuralTells(`Он не спал, а ждал. ${filler}.`);
    expect(r.totalWords).toBe(502);
    expect(r.perThousandWords.negativeParallelism).toBeCloseTo(2, 1);
  });

  it("keeps up to three quoted examples per tell", () => {
    const text = Array.from(
      { length: 5 },
      (_, i) => `Он не спал${i}, а ждал.`,
    ).join(" ");
    const r = measureStructuralTells(text);
    expect(r.counts.negativeParallelism).toBe(5);
    expect(r.examples.negativeParallelism).toHaveLength(3);
    expect(r.examples.negativeParallelism[0]).toContain("не спал0, а ждал");
  });

  it("returns zeros for empty text rather than NaN", () => {
    const r = measureStructuralTells("");
    expect(r.totalWords).toBe(0);
    expect(r.shortSentenceShare).toBe(0);
    expect(r.perThousandWords.triad).toBe(0);
    expect(r.sceneCadence.spread).toBe(0);
  });
});

describe("renderStructuralTells", () => {
  it("renders a Russian block with per-1000 counts and one example per tell", () => {
    const r = measureStructuralTells(
      "Он не спал, а ждал. Сердце упало в живот. Он был тих, бледен и упрям.",
    );
    const block = renderStructuralTells(r);
    expect(block).toContain("на 1000 слов");
    expect(block).toContain("не X, а Y");
    expect(block).toContain("не спал, а ждал");
    expect(block).toContain("телесн");
    expect(block).not.toContain("NaN");
  });
});

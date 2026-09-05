import { describe, it, expect } from "vitest";
import {
  docToBlocks,
  blocksToDoc,
  diffProseBlocks,
  applyProseChanges,
  applyProseChangesToNodes,
  docToNodes,
  nodesToBlocks,
  nodesToDoc,
  MAX_DIFF_BLOCKS,
} from "./prose-diff.js";

const doc = (...paragraphs: string[]): unknown => ({
  type: "doc",
  content: paragraphs.map((p) =>
    p === ""
      ? { type: "paragraph" }
      : { type: "paragraph", content: [{ type: "text", text: p }] },
  ),
});

describe("docToBlocks", () => {
  it("вынимает текст каждого абзаца", () => {
    expect(docToBlocks(doc("Раз.", "Два."))).toEqual(["Раз.", "Два."]);
  });

  it("склеивает несколько текстовых узлов одного абзаца", () => {
    const withMarks = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Он сказал " },
            { type: "text", text: "тихо", marks: [{ type: "italic" }] },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    expect(docToBlocks(withMarks)).toEqual(["Он сказал тихо."]);
  });

  it("не падает на пустом и битом документе", () => {
    expect(docToBlocks(doc())).toEqual([]);
    expect(docToBlocks(null)).toEqual([]);
    expect(docToBlocks({ type: "doc" })).toEqual([]);
    expect(docToBlocks("не документ")).toEqual([]);
  });

  it("пустой абзац остаётся пустой строкой", () => {
    expect(docToBlocks(doc("Раз.", "", "Два."))).toEqual(["Раз.", "", "Два."]);
  });
});

describe("blocksToDoc", () => {
  it("делает документ, который docToBlocks читает обратно", () => {
    const blocks = ["Раз.", "", "Два."];
    expect(docToBlocks(blocksToDoc(blocks))).toEqual(blocks);
  });

  it("пустой список даёт документ с одним пустым абзацем", () => {
    expect(blocksToDoc([])).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("diffProseBlocks", () => {
  it("одинаковый текст не даёт ни одной правки", () => {
    expect(diffProseBlocks(["Раз.", "Два."], ["Раз.", "Два."])).toEqual([]);
  });

  it("заменённый абзац — одна правка replace", () => {
    const changes = diffProseBlocks(
      ["Раз.", "Два.", "Три."],
      ["Раз.", "Второй.", "Три."],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "replace",
      baseFrom: 1,
      baseTo: 2,
      baseText: ["Два."],
      candidateText: ["Второй."],
    });
  });

  it("вставка в середину — insert с пустым baseText", () => {
    const changes = diffProseBlocks(["Раз.", "Три."], ["Раз.", "Два.", "Три."]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "insert",
      baseFrom: 1,
      baseTo: 1,
      baseText: [],
      candidateText: ["Два."],
    });
  });

  it("удаление — delete с пустым candidateText", () => {
    const changes = diffProseBlocks(["Раз.", "Два.", "Три."], ["Раз.", "Три."]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "delete",
      baseFrom: 1,
      baseTo: 2,
      candidateText: [],
    });
  });

  it("идентификаторы правок уникальны и идут по порядку", () => {
    const changes = diffProseBlocks(
      ["A", "B", "C", "D"],
      ["A", "B2", "C", "D2"],
    );
    expect(changes.map((ch) => ch.id)).toEqual(["c0", "c1"]);
  });

  it("правки не пересекаются: конец предыдущей не заходит за начало следующей", () => {
    const changes = diffProseBlocks(
      ["A", "B", "C", "D", "E"],
      ["A", "B2", "C", "D2", "E"],
    );
    for (let i = 1; i < changes.length; i++) {
      expect(changes[i]!.baseFrom).toBeGreaterThanOrEqual(changes[i - 1]!.baseTo);
    }
  });

  it("на слишком длинном документе отдаёт одну правку «заменить всё»", () => {
    const base = Array.from({ length: MAX_DIFF_BLOCKS + 1 }, (_, i) => `b${i}`);
    const cand = Array.from({ length: 3 }, (_, i) => `c${i}`);
    const changes = diffProseBlocks(base, cand);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "replace",
      baseFrom: 0,
      baseTo: base.length,
      candidateText: cand,
    });
  });
});

describe("applyProseChanges", () => {
  const base = ["Раз.", "Два.", "Три."];
  const candidate = ["Раз.", "Второй.", "Три.", "Четыре."];
  const changes = diffProseBlocks(base, candidate);

  it("без выбранных правок возвращает базу как есть", () => {
    expect(applyProseChanges(base, changes, [])).toEqual(base);
  });

  it("со всеми правками возвращает кандидата целиком", () => {
    expect(
      applyProseChanges(base, changes, changes.map((ch) => ch.id)),
    ).toEqual(candidate);
  });

  it("применяет только выбранную правку", () => {
    const replace = changes.find((ch) => ch.kind === "replace");
    expect(replace).toBeDefined();
    expect(applyProseChanges(base, changes, [replace!.id])).toEqual([
      "Раз.",
      "Второй.",
      "Три.",
    ]);
  });

  it("порядок выбранных идентификаторов не влияет на результат", () => {
    const ids = changes.map((ch) => ch.id);
    expect(applyProseChanges(base, changes, ids)).toEqual(
      applyProseChanges(base, changes, [...ids].reverse()),
    );
  });

  it("неизвестный идентификатор правки — ошибка, а не тихий пропуск", () => {
    expect(() => applyProseChanges(base, changes, ["нет-такой"])).toThrow(
      /unknown change/,
    );
  });
});

/** Документ автора: жирный прогон, заголовок и пункт списка — то, чего
 *  сравнение по строкам не видит и что частичное принятие обязано сохранить. */
const RICH_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Глава вторая" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Он сказал " },
        { type: "text", marks: [{ type: "bold" }], text: "нет" },
        { type: "text", text: "." },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "Старый второй абзац." }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Пункт списка." }] },
          ],
        },
      ],
    },
  ],
};

// Писатель отдаёт сплошные абзацы — ровно так кандидат и выглядит.
const PLAIN_CANDIDATE = doc(
  "Глава вторая",
  "Он сказал нет.",
  "Новый второй абзац.",
  "Пункт списка.",
);

describe("частичное принятие по узлам", () => {
  const baseNodes = docToNodes(RICH_DOC);
  const candidateNodes = docToNodes(PLAIN_CANDIDATE);
  const changes = diffProseBlocks(
    nodesToBlocks(baseNodes),
    nodesToBlocks(candidateNodes),
  );

  it("сравнение по строкам видит одну правку — второй абзац", () => {
    expect(changes).toHaveLength(1);
    expect(changes[0]?.candidateText).toEqual(["Новый второй абзац."]);
  });

  it("непринятые блоки переносятся исходными узлами: жирное, заголовок и список живы", () => {
    const merged = applyProseChangesToNodes(
      baseNodes,
      candidateNodes,
      changes,
      [changes[0]!.id],
    );
    expect(merged).toHaveLength(4);
    // Заголовок остался заголовком, а не превратился в абзац.
    expect(merged[0]).toEqual(RICH_DOC.content[0]);
    // Жирный прогон уцелел целиком, со своими marks.
    expect(merged[1]).toEqual(RICH_DOC.content[1]);
    // Пункт списка остался пунктом списка.
    expect(merged[3]).toEqual(RICH_DOC.content[3]);
    // А принятая правка взяла узел кандидата.
    expect(merged[2]).toEqual(candidateNodes[2]);
  });

  it("ничего не выбрано — документ автора не изменился вовсе", () => {
    const merged = applyProseChangesToNodes(baseNodes, candidateNodes, changes, []);
    expect(nodesToDoc(merged)).toEqual(RICH_DOC);
  });

  it("выбраны все правки — получается кандидат целиком", () => {
    const merged = applyProseChangesToNodes(
      baseNodes,
      candidateNodes,
      changes,
      changes.map((ch) => ch.id),
    );
    expect(nodesToBlocks(merged)).toEqual(nodesToBlocks(candidateNodes));
  });

  it("несколько правок подряд берут свои, а не чужие абзацы кандидата", () => {
    const base = doc("A", "B", "C", "D", "E");
    const cand = doc("A", "B2", "C", "D2", "E");
    const bn = docToNodes(base);
    const cn = docToNodes(cand);
    const chs = diffProseBlocks(nodesToBlocks(bn), nodesToBlocks(cn));
    expect(chs).toHaveLength(2);
    // Вторая правка обязана взять «D2», а не «B2»: индекс в кандидате
    // восстанавливается по всему списку правок, а не по выбранной.
    const merged = applyProseChangesToNodes(bn, cn, chs, [chs[1]!.id]);
    expect(nodesToBlocks(merged)).toEqual(["A", "B", "C", "D2", "E"]);
  });

  it("вставка и удаление не сбивают счёт индексов кандидата", () => {
    const base = doc("A", "B", "C");
    const cand = doc("A", "A2", "C", "C2");
    const bn = docToNodes(base);
    const cn = docToNodes(cand);
    const chs = diffProseBlocks(nodesToBlocks(bn), nodesToBlocks(cn));
    const all = applyProseChangesToNodes(bn, cn, chs, chs.map((ch) => ch.id));
    expect(nodesToBlocks(all)).toEqual(["A", "A2", "C", "C2"]);
    for (const ch of chs) {
      const one = applyProseChangesToNodes(bn, cn, chs, [ch.id]);
      // Каждая правка по отдельности даёт ровно свой кусок кандидата.
      expect(nodesToBlocks(one)).toContain("A");
    }
  });

  it("пустой результат — документ с одним пустым абзацем, а не пустой content", () => {
    expect(nodesToDoc([])).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("неизвестный идентификатор правки — ошибка, а не тихий пропуск", () => {
    expect(() =>
      applyProseChangesToNodes(baseNodes, candidateNodes, changes, ["нет-такой"]),
    ).toThrow(/unknown change/);
  });
});

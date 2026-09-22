import { describe, expect, it } from "vitest";
import type { AspectVariant, StageAspect, StageState } from "@book-forge/shared";
import {
  approveAllSections,
  currentVariant,
  mergeDocumentSections,
  normalizeSectionName,
  sectionText,
} from "../documentSections.js";

const meta = {
  contextRef: { hash: "h", summary: "s", includedAspectIds: [], includedEntityIds: [] },
  modelId: "sonnet",
};

function variant(over: Partial<AspectVariant> = {}): AspectVariant {
  return {
    id: over.id ?? "v1",
    label: "документ",
    payloadKind: "markdown",
    payload: "текст",
    status: "generated",
    editSource: "llm",
    generatedAt: "2026-09-22T00:00:00.000Z",
    ...over,
  } as AspectVariant;
}

function aspect(over: Partial<StageAspect> = {}): StageAspect {
  return {
    id: "a1",
    name: "география",
    status: "pending",
    order: 0,
    required: false,
    source: "llm",
    payloadKind: "markdown",
    variants: [],
    ...over,
  } as StageAspect;
}

function stage(aspects: StageAspect[], over: Partial<StageState> = {}): StageState {
  return { status: "not_started", playbookGenerated: false, aspects, ...over };
}

describe("normalizeSectionName", () => {
  it("сравнивает имена без учёта регистра и краёв", () => {
    expect(normalizeSectionName("  География ")).toBe(normalizeSectionName("география"));
  });
});

describe("sectionText", () => {
  it("принятый раздел отдаёт свой финальный текст", () => {
    const a = aspect({ status: "accepted", finalPayload: "принято" });
    expect(sectionText(a)).toBe("принято");
  });

  it("черновик отдаёт текст выбранного варианта", () => {
    const a = aspect({
      status: "reviewing",
      variants: [variant({ id: "v1", payload: "первый" }), variant({ id: "v2", payload: "второй" })],
      selectedVariantId: "v1",
    });
    expect(sectionText(a)).toBe("первый");
  });

  it("без выбора берёт последний живой вариант", () => {
    const a = aspect({
      status: "reviewing",
      variants: [
        variant({ id: "v1", payload: "старый", status: "superseded" }),
        variant({ id: "v2", payload: "новый" }),
      ],
    });
    expect(sectionText(a)).toBe("новый");
  });

  it("пустой раздел отдаёт null", () => {
    expect(sectionText(aspect())).toBeNull();
    expect(sectionText(aspect({ variants: [variant({ payload: "   " })] }))).toBeNull();
  });

  it("выбор, указывающий на вытесненный вариант, не считается текстом раздела", () => {
    // Прежний экран при уточнении помечал вариант superseded, не снимая
    // selectedVariantId: у старых разделов мира и лора выбор указывает на
    // мёртвый вариант.
    const a = aspect({
      status: "reviewing",
      variants: [
        variant({ id: "v1", payload: "старый", status: "superseded" }),
        variant({ id: "v2", payload: "новый" }),
      ],
      selectedVariantId: "v1",
    });
    expect(sectionText(a)).toBe("новый");
  });

  it("выбор, указывающий на отвергнутый вариант, тоже не в счёт", () => {
    const a = aspect({
      status: "reviewing",
      variants: [
        variant({ id: "v1", payload: "отвергнут", status: "rejected" }),
        variant({ id: "v2", payload: "живой" }),
      ],
      selectedVariantId: "v1",
    });
    expect(sectionText(a)).toBe("живой");
  });
});

describe("mergeDocumentSections", () => {
  it("наполняет пустой раздел с тем же именем, а не заводит второй", () => {
    const next = mergeDocumentSections(
      stage([aspect({ id: "a1", name: "география" })]),
      [{ name: "География", description: "рельеф", markdown: "Длинный текст." }],
      meta,
    );
    expect(next.aspects).toHaveLength(1);
    expect(next.aspects[0]?.status).toBe("reviewing");
    expect(sectionText(next.aspects[0]!)).toBe("Длинный текст.");
  });

  it("не трогает раздел, у которого уже есть текст", () => {
    const before = stage([
      aspect({ id: "a1", name: "география", status: "accepted", finalPayload: "авторский текст" }),
    ]);
    const next = mergeDocumentSections(
      before,
      [{ name: "география", description: "рельеф", markdown: "версия модели" }],
      meta,
    );
    expect(next.aspects[0]).toEqual(before.aspects[0]);
  });

  it("добавляет новый раздел следующим по порядку", () => {
    const next = mergeDocumentSections(
      stage([aspect({ id: "a1", name: "география", order: 3, status: "accepted", finalPayload: "есть" })]),
      [{ name: "вера", description: "во что верят", markdown: "Текст о вере." }],
      meta,
    );
    expect(next.aspects).toHaveLength(2);
    expect(next.aspects[1]?.name).toBe("вера");
    expect(next.aspects[1]?.order).toBe(4);
    expect(next.aspects[1]?.required).toBe(false);
  });

  it("этап трогается со старта, но статус не подделывается", () => {
    const next = mergeDocumentSections(
      stage([]),
      [{ name: "вера", description: "о вере", markdown: "Текст." }],
      meta,
    );
    expect(next.status).toBe("in_progress");
    expect(next.aspects[0]?.status).toBe("reviewing");
  });

  it("пропущенный автором раздел модель не воскрешает", () => {
    const before = stage([aspect({ id: "a1", name: "магия", status: "skipped" })]);
    const next = mergeDocumentSections(
      before,
      [{ name: "магия", description: "как устроена", markdown: "Текст о магии." }],
      meta,
    );
    expect(next.aspects).toHaveLength(1);
    expect(next.aspects[0]?.status).toBe("skipped");
  });

  it("повторённое моделью имя раздела не заводит второй раздел", () => {
    const next = mergeDocumentSections(
      stage([]),
      [
        { name: "вера", description: "во что верят", markdown: "Первый текст." },
        { name: "Вера", description: "дубль", markdown: "Второй текст." },
      ],
      meta,
    );
    expect(next.aspects).toHaveLength(1);
    expect(sectionText(next.aspects[0]!)).toBe("Первый текст.");
  });
});

describe("approveAllSections", () => {
  it("принимает каждый раздел с текстом одним изменением", () => {
    const next = approveAllSections(
      stage([
        aspect({ id: "a1", name: "география", status: "reviewing", variants: [variant({ id: "v1", payload: "текст 1" })] }),
        aspect({ id: "a2", name: "вера", order: 1, status: "reviewing", variants: [variant({ id: "v2", payload: "текст 2" })] }),
      ]),
    );
    expect(next).not.toBeNull();
    expect(next!.aspects.every((a) => a.status === "accepted")).toBe(true);
    expect(next!.aspects[0]?.finalPayload).toBe("текст 1");
    expect(next!.aspects[0]?.selectedVariantId).toBe("v1");
    expect(next!.aspects[0]?.variants[0]?.status).toBe("accepted");
  });

  it("пустой раздел остаётся пустым, а не принимается вслепую", () => {
    const next = approveAllSections(
      stage([
        aspect({ id: "a1", status: "reviewing", variants: [variant({ id: "v1", payload: "есть" })] }),
        aspect({ id: "a2", name: "пусто", order: 1 }),
      ]),
    );
    expect(next!.aspects[1]?.status).toBe("pending");
  });

  it("пропущенный раздел не принимается", () => {
    const next = approveAllSections(
      stage([
        aspect({ id: "a1", status: "reviewing", variants: [variant({ id: "v1", payload: "есть" })] }),
        aspect({ id: "a2", order: 1, status: "skipped", variants: [variant({ id: "v2", payload: "было" })] }),
      ]),
    );
    expect(next!.aspects[1]?.status).toBe("skipped");
  });

  it("возвращает null, когда принимать нечего", () => {
    expect(approveAllSections(stage([aspect()]))).toBeNull();
    expect(
      approveAllSections(
        stage([aspect({ status: "accepted", finalPayload: "уже", variants: [variant({ id: "v1", status: "accepted" })] })]),
      ),
    ).toBeNull();
  });
});

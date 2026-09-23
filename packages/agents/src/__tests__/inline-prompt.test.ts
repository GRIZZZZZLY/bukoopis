import { describe, it, expect } from "vitest";
import {
  buildInlineStableSystem,
  buildInlineVolatilePrompt,
  describeInstruction,
  INLINE_COMMAND_INSTRUCTIONS,
  type RunInlineInput,
} from "../inline.js";

const base: RunInlineInput = {
  command: "rewrite",
  selectionText: "Ему было страшно.",
  beforeText: "До.",
  afterText: "После.",
  bookContext: "Контекст книги",
  characterContext: null,
  loreContext: null,
};

// Inline is a hand tool the author reaches for repeatedly, so a command that
// pushes a measured tell concentrates it. The 2026-09-04 review found embodied
// emotion dominant (40–50% of beats; human corpora ~38%, AI ~81%) — and the
// intensify command was instructing exactly that, body first.

describe("INLINE_COMMAND_INSTRUCTIONS — intensify", () => {
  const intensify = INLINE_COMMAND_INSTRUCTIONS.intensify;

  it("leads with behaviour and speech, not bodily sensation", () => {
    expect(intensify).toMatch(/поступ|действ|поведени/i);
  });

  it("limits embodied sensation to a peak instead of prescribing it", () => {
    expect(intensify).toMatch(/тел/i);
    expect(intensify).toMatch(/пик|не больше одного|один раз/i);
  });

  it("no longer offers «руки дрожали» as the model answer", () => {
    expect(intensify).not.toContain("руки дрожали");
  });
});

describe("INLINE_COMMAND_INSTRUCTIONS — lengthen", () => {
  const lengthen = INLINE_COMMAND_INSTRUCTIONS.lengthen;

  it("does not make piling on sensory detail the default lever", () => {
    expect(lengthen).toMatch(/конкрет|деталь/i);
    expect(lengthen).toMatch(/не нагромождай|не более двух|одно чувство/i);
  });
});

describe("buildInlineVolatilePrompt", () => {
  it("carries the instruction of the requested command", () => {
    const prompt = buildInlineVolatilePrompt({ ...base, command: "shorten" });
    expect(prompt).toContain(INLINE_COMMAND_INSTRUCTIONS.shorten);
    expect(prompt).toContain("Выделенный фрагмент:");
  });

  it("marks continuation mode when there is no selection", () => {
    const prompt = buildInlineVolatilePrompt({
      ...base,
      command: "continue",
      selectionText: null,
    });
    expect(prompt).toContain("Selection пустой");
    expect(prompt).not.toContain("Выделенный фрагмент:");
  });
});

describe("buildInlineStableSystem", () => {
  it("keeps the shared cliché and dialogue rules", () => {
    const system = buildInlineStableSystem(base);
    expect(system).toContain("LLM-клише");
    expect(system).toContain("Контекст книги");
  });
});

describe("describe — одна деталь по каналу", () => {
  it("инструкция называет канал и требует одну деталь без переписывания", () => {
    const smell = describeInstruction("smell");
    expect(smell).toMatch(/обоняни|запах/i);
    expect(smell).toMatch(/одн(у|а) детал/i);
    expect(smell).toMatch(/не переписывай|оставь .* как есть/i);
    expect(smell).toMatch(/не добавляй .*событи/i);
  });

  it("метафора — одно бытовое сравнение, без книжной приподнятости", () => {
    const m = describeInstruction("metaphor");
    expect(m).toMatch(/сравнени|метафор/i);
    expect(m).toMatch(/бытов|предметн/i);
    expect(m).toMatch(/не больше одн/i);
  });

  it("в промпте «Описать» нет текста ПОСЛЕ фрагмента", () => {
    const prompt = buildInlineVolatilePrompt({
      ...base,
      command: "describe",
      sense: "sound",
      afterText: "ХВОСТ-КОТОРОГО-НЕ-ДОЛЖНО-БЫТЬ",
    });
    expect(prompt).not.toContain("Текст ПОСЛЕ");
    expect(prompt).not.toContain("ХВОСТ-КОТОРОГО-НЕ-ДОЛЖНО-БЫТЬ");
    expect(prompt).toContain("Выделенный фрагмент:");
    expect(prompt).toContain(describeInstruction("sound"));
  });

  it("describe без канала — ошибка, а не молчаливый канал по умолчанию", () => {
    expect(() =>
      buildInlineVolatilePrompt({ ...base, command: "describe" }),
    ).toThrow(/sense/);
  });
});

describe("узкие команды inline — второй разбор прозы 2026-09-23", () => {
  it("«Переписать» больше не требует «улучшить прозу» и запрещает делать образнее", () => {
    expect(INLINE_COMMAND_INSTRUCTIONS.rewrite).not.toMatch(/улучши прозу/);
    expect(INLINE_COMMAND_INSTRUCTIONS.rewrite).toMatch(/не образнее оригинала/);
  });

  it("у каждой узкой операции есть предел изменения", () => {
    expect(INLINE_COMMAND_INSTRUCTIONS.clarify).toMatch(/120%/);
    expect(INLINE_COMMAND_INSTRUCTIONS.dedupe).toMatch(/не больше оригинала/);
    expect(INLINE_COMMAND_INSTRUCTIONS.natural_dialogue).toMatch(/близко к оригиналу/);
  });
});

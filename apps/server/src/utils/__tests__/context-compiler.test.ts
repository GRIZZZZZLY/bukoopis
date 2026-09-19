import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  compileContext,
  describeCompiledContext,
  type ContextSection,
} from "../context-compiler.js";

const S = (id: string, priority: number, len: number, required = false): ContextSection => ({
  id,
  text: "x".repeat(len),
  priority,
  required,
});

describe("estimateTokens", () => {
  it("scales with length and is zero for empty", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("x".repeat(300))).toBe(100);
  });
});

describe("compileContext", () => {
  it("keeps everything when under budget, preserving input order", () => {
    const c = compileContext(
      [S("a", 3, 30), S("b", 1, 30), S("c", 2, 30)],
      { maxTokens: 1000 },
    );
    expect(c.includedIds).toEqual(["a", "b", "c"]); // input order, not priority
    expect(c.dropped).toHaveLength(0);
    expect(c.totalTokens).toBe(30);
  });

  it("drops lowest-priority sections first when over budget", () => {
    // Each section ~100 tokens (300 chars). Budget fits ~2.
    const c = compileContext(
      [S("keep1", 1, 300), S("keep2", 2, 300), S("drop", 9, 300)],
      { maxTokens: 200 },
    );
    expect(c.includedIds).toEqual(["keep1", "keep2"]);
    expect(c.dropped.map((d) => d.id)).toEqual(["drop"]);
  });

  it("always keeps required sections even past budget, drops optional", () => {
    const c = compileContext(
      [
        { id: "beats", text: "x".repeat(900), priority: 1, required: true },
        S("opt", 2, 300),
      ],
      { maxTokens: 100 },
    );
    expect(c.includedIds).toContain("beats");
    expect(c.includedIds).not.toContain("opt");
    expect(c.totalTokens).toBe(300); // required counted even though over budget
  });

  it("ignores null / empty / whitespace sections", () => {
    const c = compileContext(
      [
        { id: "empty", text: "", priority: 1 },
        { id: "space", text: "   \n ", priority: 1 },
        { id: "null", text: null, priority: 1 },
        S("real", 2, 30),
      ],
      { maxTokens: 1000 },
    );
    expect(c.includedIds).toEqual(["real"]);
  });

  it("breaks priority ties by input order", () => {
    const c = compileContext(
      [S("first", 5, 300), S("second", 5, 300)],
      { maxTokens: 100 },
    );
    expect(c.includedIds).toEqual(["first"]);
    expect(c.dropped.map((d) => d.id)).toEqual(["second"]);
  });
});

describe("describeCompiledContext", () => {
  it("summarizes included + dropped for logs", () => {
    const c = compileContext(
      [S("keep", 1, 300), S("drop", 9, 300)],
      { maxTokens: 100 },
    );
    const line = describeCompiledContext(c, "writer ch#5");
    expect(line).toContain("writer ch#5");
    expect(line).toContain("included keep");
    expect(line).toContain("dropped drop");
  });
});

describe("переполнение обязательного слоя (AC-14)", () => {
  it("сообщает, что обязательный слой не влез, а не молчит", () => {
    // Раньше `required` умел только «всегда включить»: totalTokens тихо
    // превышал бюджет, и вызывающий генерировал с потерянными ограничениями,
    // ничего об этом не зная.
    const compiled = compileContext(
      [
        { id: "must", text: "я".repeat(3000), priority: 1, required: true },
        { id: "extra", text: "б".repeat(300), priority: 2 },
      ],
      { maxTokens: 100 },
    );
    expect(compiled.includedIds).toContain("must");
    expect(compiled.requiredOverflow).toBe(true);
    expect(compiled.requiredTokens).toBeGreaterThan(100);
    // Необязательное при переполнении не добавляется: места нет уже под
    // обязательное, и любой довесок только углубляет яму.
    expect(compiled.includedIds).not.toContain("extra");
    expect(compiled.dropped.map((d) => d.id)).toContain("extra");
  });

  it("при нормальном бюджете флаг опущен, а счёт обязательного точен", () => {
    const compiled = compileContext(
      [
        { id: "must", text: "коротко", priority: 1, required: true },
        { id: "extra", text: "ещё", priority: 2 },
      ],
      { maxTokens: 1000 },
    );
    expect(compiled.requiredOverflow).toBe(false);
    expect(compiled.requiredTokens).toBe(estimateTokens("коротко"));
    expect(compiled.includedIds).toEqual(["must", "extra"]);
  });

  it("без обязательных секций переполнения не бывает", () => {
    const compiled = compileContext([S("a", 1, 30000)], { maxTokens: 10 });
    expect(compiled.requiredOverflow).toBe(false);
    expect(compiled.requiredTokens).toBe(0);
    expect(compiled.includedIds).toEqual([]);
  });

  it("инспектор ставит переполнение первым словом", () => {
    const compiled = compileContext(
      [{ id: "must", text: "я".repeat(3000), priority: 1, required: true }],
      { maxTokens: 100 },
    );
    const line = describeCompiledContext(compiled, "writer ch#5");
    expect(line.startsWith("[context] REQUIRED OVERFLOW")).toBe(true);
    expect(line).toContain("writer ch#5");
  });
});

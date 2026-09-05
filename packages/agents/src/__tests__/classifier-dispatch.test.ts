import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@book-forge/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@book-forge/llm")>();
  return { ...actual, dispatchStructured: vi.fn() };
});

import { dispatchStructured } from "@book-forge/llm";
import { runMaterialClassifier } from "../intake/classifier.js";

beforeEach(() => vi.mocked(dispatchStructured).mockReset());

describe("runMaterialClassifier", () => {
  it("asks for a timeout of its own, well past the shared 120s default", async () => {
    // Классификатор переносит текст автора дословно: на большом куске он пишет
    // минутами, и общий предел рубил вызов посреди работы — SDK сообщал это как
    // «Claude Code process aborted by user», и самая большая часть документа не
    // разбиралась никогда.
    vi.mocked(dispatchStructured).mockResolvedValue({
      raw: { fragments: [] },
      diagnostics: {},
    } as never);

    await runMaterialClassifier({ filename: "а.md", content: "текст" });

    const call = vi.mocked(dispatchStructured).mock.calls[0]![0] as {
      timeoutMs?: number;
      maxTokens?: number;
    };
    expect(call.timeoutMs).toBeGreaterThan(120_000);
    // Предел всё-таки есть: без него зависший бэкенд держал бы разбор вечно.
    expect(call.timeoutMs).toBeLessThanOrEqual(900_000);
    expect(call.maxTokens).toBe(32000);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestApp, sendJson, type TestApp } from "../../routes/__tests__/_helpers.js";
import { loadBookContext } from "../book-context.js";

let t: TestApp;
beforeEach(() => {
  t = makeTestApp();
});
afterEach(() => t.cleanup());

describe("loadBookContext", () => {
  it("выбранный вариант плана уходит в промпт без generatedBy, source остаётся", async () => {
    const b = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "Т" });
    const outline = {
      selectedIndex: 0,
      variants: [{ label: "A", source: "ai", generatedBy: "ollama:qwen:9b", logline: "L" }],
    };
    t.sqlite.prepare("UPDATE books SET outline_json = ? WHERE id = ?").run(JSON.stringify(outline), b.id);
    const ctx = loadBookContext(t.sqlite, b.id);
    const sel = JSON.parse(ctx!.outlineSelected!) as Record<string, unknown>;
    expect(sel).not.toHaveProperty("generatedBy");
    expect(sel).toMatchObject({ label: "A", source: "ai", logline: "L" });
  });
});

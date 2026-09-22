import { describe, it, expect } from "vitest";
import { extractText, prosePlainTextToProseMirror } from "../prosemirror.js";

/** F10 ревью 2026-09-22: `extractText` склеивал всё через пробел, и глава в
 *  `content_text` становилась одной строкой. */

const p = (...inline: unknown[]) => ({ type: "paragraph", content: inline });
const txt = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

describe("extractText", () => {
  it("абзацы разделяются пустой строкой", () => {
    const doc = { type: "doc", content: [p(txt("Первый.")), p(txt("— Реплика, — сказал он."))] };
    expect(extractText(doc)).toBe("Первый.\n\n— Реплика, — сказал он.");
  });

  it("слово с жирной серединой не разрывается пробелом", () => {
    const doc = { type: "doc", content: [p(txt("не"), txt("ве", [{ type: "bold" }]), txt("роятно"))] };
    expect(extractText(doc)).toBe("невероятно");
  });

  it("мягкий перенос — перевод строки, вложенные списки — отдельные блоки", () => {
    const doc = {
      type: "doc",
      content: [
        p(txt("Строка"), { type: "hardBreak" }, txt("вторая")),
        { type: "bulletList", content: [{ type: "listItem", content: [p(txt("пункт"))] }] },
        { type: "paragraph" },
      ],
    };
    expect(extractText(doc)).toBe("Строка\nвторая\n\nпункт");
  });

  it("обратим с prosePlainTextToProseMirror", () => {
    const text = "Раз.\n\nДва.\n\nТри.";
    expect(extractText(prosePlainTextToProseMirror(text))).toBe(text);
  });
});

describe("recomputeContentText", () => {
  it("восстанавливает абзацы уже записанных версий и идемпотентен", async () => {
    const { makeTestApp, sendJson, send } = await import("../../routes/__tests__/_helpers.js");
    const { recomputeContentText } = await import("../../scripts/recompute-content-text.js");
    const t = makeTestApp();
    try {
      const book = await sendJson<{ id: number }>(t.app, "/api/books", "POST", { title: "К" });
      const ch = await sendJson<{ id: number }>(t.app, `/api/books/${book.id}/chapters`, "POST", { title: "Г" });
      await send(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
        contentJson: { type: "doc", content: [p(txt("Раз.")), p(txt("Два."))] },
      });
      // Так строку записывал прежний extractText.
      t.sqlite.prepare("UPDATE chapter_versions SET content_text = 'Раз. Два.'").run();

      expect(recomputeContentText(t.sqlite).versions).toBe(1);
      const row = t.sqlite.prepare("SELECT content_text FROM chapter_versions").get() as { content_text: string };
      expect(row.content_text).toBe("Раз.\n\nДва.");
      expect(recomputeContentText(t.sqlite).versions).toBe(0);
    } finally {
      t.cleanup();
    }
  });
});

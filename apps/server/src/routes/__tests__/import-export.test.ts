import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestApp, send, sendJson, type TestApp } from "./_helpers.js";
import { parseChapters } from "../import-export.js";

interface BookJson {
  id: number;
}
interface ChapterJson {
  id: number;
  title: string;
  orderIndex: number;
  currentVersionId: number | null;
}

let t: TestApp;
let bookId: number;

beforeEach(async () => {
  t = makeTestApp();
  const b = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Импорт-тест",
  });
  bookId = b.id;
});
afterEach(() => {
  t.cleanup();
});

async function createBook(): Promise<number> {
  const r = await sendJson<BookJson>(t.app, "/api/books", "POST", {
    title: "Test",
  });
  return r.id;
}

describe("parseChapters", () => {
  it("splits markdown by H1", () => {
    const md = `# Глава первая\n\nТекст первой главы.\n\n# Глава вторая\n\nТекст второй главы.`;
    const result = parseChapters(md, "fallback");
    expect(result.length).toBe(2);
    expect(result[0]!.title).toBe("Глава первая");
    expect(result[0]!.body).toContain("Текст первой главы.");
    expect(result[1]!.title).toBe("Глава вторая");
  });

  it("falls back to single chapter when no headings", () => {
    const txt = `Просто текст без заголовков.\n\nВторой абзац.`;
    const result = parseChapters(txt, "Без названия");
    expect(result.length).toBe(1);
    expect(result[0]!.title).toBe("Без названия");
  });

  it("uses 'Глава N' pattern when no markdown headings", () => {
    const txt = `Глава 1: пещера\nТекст.\n\nГлава 2: лес\nЕщё текст.`;
    const result = parseChapters(txt, "fallback");
    expect(result.length).toBe(2);
    expect(result[0]!.title).toBe("Глава 1: пещера");
  });
});

describe("import endpoint", () => {
  it("imports markdown file as chapters", async () => {
    const md = `# Первая\n\nАбзац первой главы.\n\n# Вторая\n\nАбзац второй главы.`;
    const res = await send(t.app, `/api/books/${bookId}/import`, "POST", {
      filename: "novel.md",
      content: md,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: { chapterId: number; title: string; words: number }[];
    };
    expect(body.created.length).toBe(2);
    expect(body.created[0]!.title).toBe("Первая");
  });

  it("rejects non-md/non-txt files", async () => {
    const res = await send(t.app, `/api/books/${bookId}/import`, "POST", {
      filename: "novel.docx",
      content: "anything",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing book", async () => {
    const res = await send(t.app, `/api/books/9999/import`, "POST", {
      filename: "x.md",
      content: "# X\n\ntext",
    });
    expect(res.status).toBe(404);
  });

  it("importing twice appends chapters instead of renumbering from scratch", async () => {
    const id = await createBook();
    await sendJson(t.app, `/api/books/${id}/import`, "POST", {
      filename: "часть1.md",
      content: "# Глава A\nтекст A\n\n# Глава B\nтекст B",
    });
    const second = await sendJson<{ created: Array<{ title: string }> }>(
      t.app, `/api/books/${id}/import`, "POST",
      { filename: "часть2.md", content: "# Глава C\nтекст C" },
    );
    expect(second.created.map((c) => c.title)).toEqual(["Глава C"]);
    const chapters = await sendJson<Array<{ title: string; orderIndex: number }>>(
      t.app, `/api/books/${id}/chapters`, "GET",
    );
    expect(chapters.map((c) => c.title)).toEqual(["Глава A", "Глава B", "Глава C"]);
    expect(chapters.map((c) => c.orderIndex)).toEqual([10, 20, 30]);
  });
});

describe("export endpoints", () => {
  beforeEach(async () => {
    await send(t.app, `/api/books/${bookId}`, "PATCH", {
      premise: "Тестовая премиса",
    });
    const ch = await sendJson<ChapterJson>(
      t.app,
      `/api/books/${bookId}/chapters`,
      "POST",
      { title: "Глава 1" },
    );
    await send(t.app, `/api/chapters/${ch.id}/versions`, "POST", {
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Содержимое главы." }],
          },
        ],
      },
    });
  });

  it("exports as .md with frontmatter and chapter content", async () => {
    const res = await send(t.app, `/api/books/${bookId}/export.md`, "GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("title:");
    expect(text).toContain("# Импорт-тест");
    expect(text).toContain("## Глава 1");
    expect(text).toContain("Содержимое главы.");
  });

  it("exports as .epub (valid zip with mimetype)", async () => {
    const res = await send(t.app, `/api/books/${bookId}/export.epub`, "GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    const buf = new Uint8Array(await res.arrayBuffer());
    // First 2 bytes should be PK (zip signature)
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});

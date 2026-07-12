import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import JSZip from "jszip";
import { z } from "zod";
import { indexChapterVersion } from "@book-forge/retrieval";
import {
  toBook,
  type BookRow,
  type ChapterRow,
} from "../db/rows.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";

interface ParsedChapter {
  title: string;
  body: string;
}

// Split markdown/plaintext into chapters.
// Rules:
//   1) If file has any line matching ^#\s+ (markdown H1) or ^Глава\s+\d+ — split there.
//   2) Else: if any line ^##\s+ — split there.
//   3) Else: whole file is one chapter; title = filename stem or first non-empty line.
export function parseChapters(
  raw: string,
  fallbackTitle: string,
): ParsedChapter[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const h1Re = /^#\s+(.+?)\s*$/;
  const h2Re = /^##\s+(.+?)\s*$/;
  const chapterRe = /^(Глава|Chapter)\s+([0-9IVX]+)([:.]\s*(.+))?$/i;

  const splits: { idx: number; title: string }[] = [];
  let useH1 = false;
  let useH2 = false;
  let useChapterRe = false;

  for (let i = 0; i < lines.length; i++) {
    if (h1Re.test(lines[i]!)) {
      useH1 = true;
      break;
    }
  }
  if (!useH1) {
    for (let i = 0; i < lines.length; i++) {
      if (chapterRe.test(lines[i]!)) {
        useChapterRe = true;
        break;
      }
    }
  }
  if (!useH1 && !useChapterRe) {
    for (let i = 0; i < lines.length; i++) {
      if (h2Re.test(lines[i]!)) {
        useH2 = true;
        break;
      }
    }
  }

  if (useH1) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(h1Re);
      if (m) splits.push({ idx: i, title: m[1]! });
    }
  } else if (useChapterRe) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(chapterRe);
      if (m)
        splits.push({
          idx: i,
          title: m[4] ? `${m[1]} ${m[2]}: ${m[4]}` : `${m[1]} ${m[2]}`,
        });
    }
  } else if (useH2) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(h2Re);
      if (m) splits.push({ idx: i, title: m[1]! });
    }
  }

  if (splits.length === 0) {
    return [{ title: fallbackTitle, body: raw.trim() }];
  }

  const out: ParsedChapter[] = [];
  for (let s = 0; s < splits.length; s++) {
    const start = splits[s]!.idx + 1;
    const end = s + 1 < splits.length ? splits[s + 1]!.idx : lines.length;
    out.push({
      title: splits[s]!.title.trim(),
      body: lines.slice(start, end).join("\n").trim(),
    });
  }
  return out.filter((c) => c.body.length > 0 || c.title.length > 0);
}

function plainTextToProseMirror(text: string): unknown {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    })),
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const importInputSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
});

export function createImportExportRoute(
  sqlite: DatabaseType,
  hasVec: boolean,
): Hono {
  const r = new Hono();

  // ─────── Import ───────

  r.post("/books/:id/import", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = importInputSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const book = sqlite
      .prepare("SELECT id FROM books WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!book) return notFound(c, "book");

    const ext = parsed.data.filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "md" && ext !== "txt" && ext !== "markdown") {
      return badRequest(c, "only .md / .txt / .markdown supported");
    }

    const stem =
      parsed.data.filename.replace(/\.[^.]+$/, "") || "Импортированная глава";
    const chapters = parseChapters(parsed.data.content, stem);
    if (chapters.length === 0) return badRequest(c, "no chapters detected");

    const max = sqlite
      .prepare("SELECT MAX(order_index) as m FROM chapters WHERE book_id = ?")
      .get(id) as { m: number | null };
    let nextOrder = (max.m ?? 0) + 10;

    const now = new Date().toISOString();
    const insertChapter = sqlite.prepare(
      `INSERT INTO chapters (book_id, order_index, title, status, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?)`,
    );
    const insertVersion = sqlite.prepare(
      `INSERT INTO chapter_versions
       (chapter_id, parent_version_id, content_json, content_text, word_count, source, created_at)
       VALUES (?, NULL, ?, ?, ?, 'manual', ?)`,
    );
    const updateChapter = sqlite.prepare(
      "UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?",
    );
    const bumpBook = sqlite.prepare(
      "UPDATE books SET updated_at = ? WHERE id = ?",
    );

    const created: {
      chapterId: number;
      title: string;
      words: number;
      versionId: number;
      orderIndex: number;
      body: string;
    }[] = [];

    const tx = sqlite.transaction(() => {
      for (const ch of chapters) {
        const info = insertChapter.run(id, nextOrder, ch.title, now, now);
        const chapterId = Number(info.lastInsertRowid);
        const wordCount = countWords(ch.body);
        const contentJson = JSON.stringify(plainTextToProseMirror(ch.body));
        const vinfo = insertVersion.run(
          chapterId,
          contentJson,
          ch.body,
          wordCount,
          now,
        );
        const versionId = Number(vinfo.lastInsertRowid);
        updateChapter.run(versionId, now, chapterId);
        created.push({
          chapterId,
          title: ch.title,
          words: wordCount,
          versionId,
          orderIndex: nextOrder,
          body: ch.body,
        });
        nextOrder += 10;
      }
      bumpBook.run(now, id);
    });
    tx();

    // Index chunks outside transaction (async + best-effort). Import keeps
    // the cheap synchronous path (no LLM extractors for bulk import); once a
    // chapter's chunks land we point memory_version_id at the imported
    // version so retrieval (which reads by memory_version_id, ADR 0002 I2)
    // sees it immediately.
    for (const item of created) {
      try {
        await indexChapterVersion(sqlite, hasVec, {
          bookId: id,
          chapterId: item.chapterId,
          chapterOrder: item.orderIndex,
          versionId: item.versionId,
          language: "ru",
          text: item.body,
        });
        sqlite
          .prepare("UPDATE chapters SET memory_version_id = ? WHERE id = ?")
          .run(item.versionId, item.chapterId);
      } catch (e) {
        console.warn("[import] indexing failed for chapter", item.chapterId, e);
      }
    }

    return c.json({
      created: created.map(({ chapterId, title, words }) => ({
        chapterId,
        title,
        words,
      })),
    });
  });

  // ─────── Export .md ───────

  r.get("/books/:id/export.md", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    const chapters = sqlite
      .prepare(
        `SELECT c.*, v.content_text AS content_text
         FROM chapters c
         LEFT JOIN chapter_versions v ON v.id = c.current_version_id
         WHERE c.book_id = ?
         ORDER BY c.order_index ASC`,
      )
      .all(id) as Array<ChapterRow & { content_text: string | null }>;

    const lines: string[] = [];
    lines.push("---");
    lines.push(`title: ${JSON.stringify(book.title)}`);
    lines.push(`language: ${book.language}`);
    if (book.premise) lines.push(`premise: ${JSON.stringify(book.premise)}`);
    lines.push(`status: ${book.status}`);
    lines.push(`exported_at: ${new Date().toISOString()}`);
    lines.push("---");
    lines.push("");
    lines.push(`# ${book.title}`);
    lines.push("");
    if (book.premise) {
      lines.push(book.premise);
      lines.push("");
    }
    for (const ch of chapters) {
      lines.push(`## ${ch.title}`);
      lines.push("");
      lines.push(ch.content_text ?? "");
      lines.push("");
    }

    const md = lines.join("\n");
    return new Response(md, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="book-${book.id}.md"`,
      },
    });
  });

  // ─────── Export .epub ───────

  r.get("/books/:id/export.epub", async (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    const chapters = sqlite
      .prepare(
        `SELECT c.*, v.content_text AS content_text
         FROM chapters c
         LEFT JOIN chapter_versions v ON v.id = c.current_version_id
         WHERE c.book_id = ?
         ORDER BY c.order_index ASC`,
      )
      .all(id) as Array<ChapterRow & { content_text: string | null }>;

    const epub = await buildEpub(toBook(book), chapters);
    return new Response(epub, {
      status: 200,
      headers: {
        "Content-Type": "application/epub+zip",
        "Content-Disposition": `attachment; filename="book-${book.id}.epub"`,
      },
    });
  });

  return r;
}

interface BookExportInput {
  id: number;
  title: string;
  language: string;
  premise: string | null;
}

async function buildEpub(
  book: BookExportInput,
  chapters: Array<ChapterRow & { content_text: string | null }>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const uuid = `urn:book-forge:${book.id}:${Date.now()}`;

  // mimetype must be the first file, stored uncompressed
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")!.file(
    "container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const oebps = zip.folder("OEBPS")!;

  // Stylesheet
  oebps.file(
    "style.css",
    `body { font-family: Georgia, serif; line-height: 1.5; }
h1 { page-break-before: always; }
p { text-indent: 1.5em; margin: 0; }`,
  );

  // Chapter XHTML files
  const manifestItems: string[] = [];
  const spineItems: string[] = [];

  manifestItems.push(
    `<item id="css" href="style.css" media-type="text/css"/>`,
  );
  manifestItems.push(
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
  );

  const navItems: string[] = [];

  chapters.forEach((ch, i) => {
    const fileName = `chapter-${String(i + 1).padStart(3, "0")}.xhtml`;
    const itemId = `ch${i + 1}`;
    const paragraphs = (ch.content_text ?? "")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeXml(p)}</p>`)
      .join("\n");
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${book.language}" lang="${book.language}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(ch.title)}</h1>
  ${paragraphs}
</body>
</html>`;
    oebps.file(fileName, xhtml);
    manifestItems.push(
      `<item id="${itemId}" href="${fileName}" media-type="application/xhtml+xml"/>`,
    );
    spineItems.push(`<itemref idref="${itemId}"/>`);
    navItems.push(
      `<li><a href="${fileName}">${escapeXml(ch.title)}</a></li>`,
    );
  });

  // Nav
  oebps.file(
    "nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${book.language}">
<head><title>Содержание</title></head>
<body>
  <nav epub:type="toc">
    <h1>Содержание</h1>
    <ol>${navItems.join("")}</ol>
  </nav>
</body>
</html>`,
  );

  // OPF
  oebps.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${book.language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">${uuid}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>${book.language}</dc:language>
    <dc:creator>Book Forge</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine>
    <itemref idref="nav" linear="no"/>
    ${spineItems.join("\n    ")}
  </spine>
</package>`,
  );

  return zip.generateAsync({ type: "uint8array" });
}

import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import JSZip from "jszip";
import { z } from "zod";
import { indexChapterVersion } from "@book-forge/retrieval";
import { enqueueMemoryJobs, ENQUEUE_JOB_KINDS } from "../utils/memory-queue.js";
import {
  toBook,
  toChapter,
  parseJsonOrNull,
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
/** Пометка, которой экспорт отмечает главу, выгруженную из черновика: при
 *  обратном импорте её место не в тексте главы. */
const DRAFT_MARKER = "*(черновик: не сохранён версией)*";
const DRAFT_MARKER_RE = /^\*\(черновик: не сохранён версией\)\*\n*/;

export function parseChapters(
  raw: string,
  fallbackTitle: string,
): ParsedChapter[] {
  // Собственный экспорт начинается с YAML-шапки; в тело главы она попадать
  // не должна (F19 ревью 2026-09-22).
  const normalized = raw.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = normalized.split("\n");
  const h1Re = /^#\s+(.+?)\s*$/;
  const h2Re = /^##\s+(.+?)\s*$/;
  // Числами, римскими цифрами и словами: «Глава первая» — обычная запись в
  // авторском файле, и без неё такой файл ложился одной главой (С11).
  const chapterRe =
    /^(Глава|Chapter)\s+([0-9IVX]+|перв(?:ая|ой)|втор(?:ая|ой)|треть(?:я|ей)|четв[её]рт(?:ая|ой)|пят(?:ая|ой)|шест(?:ая|ой)|седьм(?:ая|ой)|восьм(?:ая|ой)|девят(?:ая|ой)|десят(?:ая|ой)|одиннадцат(?:ая|ой)|двенадцат(?:ая|ой))(?:[:.]\s*(.+))?$/i;

  const splits: { idx: number; title: string }[] = [];
  let useH1 = false;
  let useH2 = false;
  let useChapterRe = false;

  const h1Count = lines.filter((l) => h1Re.test(l)).length;
  const hasH2 = lines.some((l) => h2Re.test(l));
  // Один H1 и под ним H2 — это название книги и главы: так пишет наш же
  // экспорт. Прежде любой H1 делал H2 невидимыми, и выгруженная книга
  // возвращалась одной главой с именем книги (F19).
  const h1IsBookTitle = h1Count === 1 && hasH2;
  useH1 = h1Count > 0 && !h1IsBookTitle;
  if (h1IsBookTitle) {
    useH2 = true;
  } else if (!useH1) {
    for (let i = 0; i < lines.length; i++) {
      if (chapterRe.test(lines[i]!)) {
        useChapterRe = true;
        break;
      }
    }
  }
  if (!useH1 && !useChapterRe && !useH2) {
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
          title: m[3] ? `${m[1]} ${m[2]}: ${m[3]}` : `${m[1]} ${m[2]}`,
        });
    }
  } else if (useH2) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(h2Re);
      if (m) splits.push({ idx: i, title: m[1]! });
    }
  }

  if (splits.length === 0) {
    return [{ title: fallbackTitle, body: normalized.trim() }];
  }

  const out: ParsedChapter[] = [];
  // Текст до первого разделителя молча пропадал. Под названием книги это её
  // аннотация (экспорт кладёт туда премису, она же есть в шапке) —
  // пропускаем; в остальных случаях это текст автора — отдельной главой.
  if (!h1IsBookTitle) {
    const preamble = lines.slice(0, splits[0]!.idx).join("\n").trim();
    if (preamble.length > 0) out.push({ title: fallbackTitle, body: preamble });
  }
  for (let s = 0; s < splits.length; s++) {
    const start = splits[s]!.idx + 1;
    const end = s + 1 < splits.length ? splits[s + 1]!.idx : lines.length;
    out.push({
      title: splits[s]!.title.trim(),
      body: lines.slice(start, end).join("\n").trim().replace(DRAFT_MARKER_RE, "").trim(),
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

export interface InsertedChapter {
  chapterId: number;
  title: string;
  words: number;
}

/** Вставка разобранных глав в конец книги. Транзакция охватывает только записи
 *  в БД; индексация чанков идёт после неё и намеренно best-effort — сбой
 *  поиска не должен отменять уже сохранённый текст автора. */
export interface InsertChaptersResult {
  created: InsertedChapter[];
  /** Главы, уже лежащие в книге под тем же названием (С11 ревью
   *  2026-09-19). Прежде повторный импорт того же файла просто дописывал их
   *  в конец, и книга удваивалась молча. */
  skipped: Array<{ title: string; reason: string }>;
}

export async function insertChapters(
  sqlite: DatabaseType,
  hasVec: boolean,
  bookId: number,
  chapters: ParsedChapter[],
  /** `asDraft` — главу кладут черновиком (`chapter_drafts`), без версии,
   *  поиска и заданий памяти (F03 ревью 2026-09-22). Так приходит текст,
   *  который переписала модель при разборе материалов: до того как автор
   *  его сохранит, он не должен становиться текущей версией и участвовать
   *  в генерации. Прямой импорт своего файла автором идёт как раньше. */
  opts: { asDraft?: boolean } = {},
): Promise<InsertChaptersResult> {
  // Сопоставление по названию: текст автор правит, название держится. Точное
  // совпадение после нормализации пробелов и регистра.
  const existingTitles = new Set(
    (
      sqlite
        .prepare("SELECT title FROM chapters WHERE book_id = ?")
        .all(bookId) as Array<{ title: string }>
    ).map((r) => r.title.trim().toLowerCase()),
  );
  const skipped: Array<{ title: string; reason: string }> = [];
  const fresh: ParsedChapter[] = [];
  for (const ch of chapters) {
    if (existingTitles.has(ch.title.trim().toLowerCase())) {
      skipped.push({ title: ch.title, reason: "в книге уже есть глава с таким названием" });
      continue;
    }
    existingTitles.add(ch.title.trim().toLowerCase());
    fresh.push(ch);
  }
  chapters = fresh;
  if (chapters.length === 0) return { created: [], skipped };
  const max = sqlite
    .prepare("SELECT MAX(order_index) as m FROM chapters WHERE book_id = ?")
    .get(bookId) as { m: number | null };
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
  const insertDraft = sqlite.prepare(
    `INSERT INTO chapter_drafts
       (chapter_id, content_json, content_text, word_count, base_version_id, revision, updated_at)
     VALUES (?, ?, ?, ?, NULL, 1, ?)`,
  );
  const drafted: InsertedChapter[] = [];

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
      const info = insertChapter.run(bookId, nextOrder, ch.title, now, now);
      const chapterId = Number(info.lastInsertRowid);
      const wordCount = countWords(ch.body);
      const contentJson = JSON.stringify(plainTextToProseMirror(ch.body));
      if (opts.asDraft) {
        insertDraft.run(chapterId, contentJson, ch.body, wordCount, now);
        drafted.push({ chapterId, title: ch.title, words: wordCount });
        nextOrder += 10;
        continue;
      }
      const vinfo = insertVersion.run(
        chapterId,
        contentJson,
        ch.body,
        wordCount,
        now,
      );
      const versionId = Number(vinfo.lastInsertRowid);
      updateChapter.run(versionId, now, chapterId);
      // Принесённая глава разбирается тем же конвейером, что написанная:
      // иначе у книги нет ни сводок, ни фактов, ни заметок, ни событий, а
      // экран уверяет, что память актуальна (В1).
      // Всё, кроме `index`: чанки маршрут кладёт сам, сразу после
      // транзакции, чтобы поиск видел принесённые главы немедленно. Задание
      // `index` вдобавок к этому означало бы вторую индексацию той же
      // версии, а `indexChapterVersion` перед вставкой чистит прежние чанки:
      // совпади они по времени, часть чанков осталась бы удвоенной.
      enqueueMemoryJobs(sqlite, {
        bookId,
        chapterId,
        chapterVersionId: versionId,
        kinds: ENQUEUE_JOB_KINDS.filter((k) => k !== "index"),
      });
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
    bumpBook.run(now, bookId);
  });
  tx();

  // Index chunks outside transaction (async + best-effort): поиск должен
  // видеть принесённые главы сразу, а индексация модели не требует.
  //
  // Раньше здесь же ставился `memory_version_id`, и это была ложь: он значит
  // «производная память этой версии активирована», а её не собирали вовсе.
  // Экран главы показывал «память актуальна» у книги, где нет ни сводки, ни
  // фактов, ни заметок, ни событий, и автор никогда не узнавал, что Писателю
  // одиннадцатой главы подают первые 1200 символов каждой предыдущей вместо
  // пересказов (В1 ревью 2026-09-19). Теперь ставится `indexed_version_id` —
  // ровно то, что правда, — а разбор идёт обычной очередью.
  for (const item of created) {
    try {
      await indexChapterVersion(sqlite, hasVec, {
        bookId,
        chapterId: item.chapterId,
        chapterOrder: item.orderIndex,
        versionId: item.versionId,
        language: "ru",
        text: item.body,
      });
      sqlite
        .prepare("UPDATE chapters SET indexed_version_id = ? WHERE id = ?")
        .run(item.versionId, item.chapterId);
    } catch (e) {
      console.warn("[import] indexing failed for chapter", item.chapterId, e);
      // Синхронная индексация не удалась — отдаём главу очереди, иначе она
      // не найдётся поиском никогда.
      enqueueMemoryJobs(sqlite, {
        bookId,
        chapterId: item.chapterId,
        chapterVersionId: item.versionId,
        kinds: ["index"],
      });
    }
  }

  return {
    created: [
      ...drafted,
      ...created.map(({ chapterId, title, words }) => ({
        chapterId,
        title,
        words,
      })),
    ],
    skipped,
  };
}

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

    const { created, skipped } = await insertChapters(sqlite, hasVec, id, chapters);
    return c.json({ created, skipped });
  });

  // ─────── Export .json (полная выгрузка) ───────

  /**
   * В8 ревью 2026-09-19: `.md` и `.epub` несли только название, премису и
   * текст принятых версий. Всё остальное — черновики (то есть незакоммиченная
   * работа), состояние Мастерской, замысел, герои с профилями V2, отношения,
   * события, факты, заметки, образцы речи, история версий — наружу не
   * выходило вовсе. Для локального инструмента без облака это значило, что
   * единственная страховка — сам файл базы.
   *
   * Здесь выгружается всё, что привязано к книге, включая полную историю
   * версий: выгрузка нужна именно тогда, когда база потеряна.
   */
  r.get("/books/:id/export.json", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    const all = <T>(sql: string, ...params: unknown[]): T[] =>
      sqlite.prepare(sql).all(...params) as T[];

    const chapterRows = all<ChapterRow>(
      "SELECT * FROM chapters WHERE book_id = ? ORDER BY order_index ASC, id ASC",
      id,
    );
    const chapters = chapterRows.map((ch) => ({
      ...toChapter(ch),
      versions: all(
        "SELECT * FROM chapter_versions WHERE chapter_id = ? ORDER BY id ASC",
        ch.id,
      ),
      draft:
        sqlite
          .prepare("SELECT * FROM chapter_drafts WHERE chapter_id = ?")
          .get(ch.id) ?? null,
      plan: parseJsonOrNull(ch.plan_json),
    }));

    const characters = all<{ id: number; canonical_name: string; profile_json: string }>(
      "SELECT * FROM characters WHERE book_id = ? ORDER BY id ASC",
      id,
    ).map((row) => ({
      ...row,
      canonicalName: row.canonical_name,
      profile: parseJsonOrNull(row.profile_json),
    }));

    return c.json({
      exportedAt: new Date().toISOString(),
      schema: "book-forge/full-export@1",
      book: toBook(book),
      concept: parseJsonOrNull(book.concept),
      studioState: parseJsonOrNull(book.studio_state),
      outline: parseJsonOrNull(book.outline_json),
      chapters,
      characters,
      relationships: all("SELECT * FROM relationships WHERE book_id = ? ORDER BY id", id),
      characterEvents: all(
        "SELECT * FROM character_events WHERE book_id = ? ORDER BY id",
        id,
      ),
      voiceSamples: all(
        "SELECT * FROM character_voice_samples WHERE book_id = ? ORDER BY id",
        id,
      ),
      locations: all("SELECT * FROM locations WHERE book_id = ? ORDER BY id", id),
      items: all("SELECT * FROM items WHERE book_id = ? ORDER BY id", id),
      hooks: all("SELECT * FROM hooks WHERE book_id = ? ORDER BY id", id),
      entityAliases: all("SELECT * FROM entity_aliases WHERE book_id = ? ORDER BY id", id),
      facts: all("SELECT * FROM book_facts WHERE book_id = ? ORDER BY id", id),
      notes: all(
        `SELECT id, book_id, kind, chapter_order_introduced, chapter_order_resolved,
                title, body, tags, related_note_ids, source_version_id, origin, created_at
         FROM book_notes WHERE book_id = ? ORDER BY id`,
        id,
      ),
      metaSummaries: all(
        "SELECT * FROM book_meta_summaries WHERE book_id = ? ORDER BY covers_to_order",
        id,
      ),
      profileVersions: all(
        "SELECT * FROM entity_profile_versions WHERE book_id = ? ORDER BY id",
        id,
      ),
      styleProfile:
        book.style_profile_id === null
          ? null
          : (sqlite
              .prepare("SELECT * FROM style_profiles WHERE id = ?")
              .get(book.style_profile_id) ?? null),
      studioEvents: all(
        "SELECT * FROM studio_events WHERE book_id = ? ORDER BY id",
        id,
      ),
    });
  });

  // ─────── Export .md ───────

  r.get("/books/:id/export.md", (c) => {
    const id = Number(c.req.param("id"));
    const book = sqlite
      .prepare("SELECT * FROM books WHERE id = ?")
      .get(id) as BookRow | undefined;
    if (!book) return notFound(c, "book");

    // Черновик новее принятой версии — это последняя работа автора, и в
    // выгрузке должна быть именно она (В8). Прежде `.md` отдавал версию, и
    // всё несохранённое в файл не попадало.
    const chapters = sqlite
      .prepare(
        `SELECT c.*, v.content_text AS content_text,
                d.content_text AS draft_text
         FROM chapters c
         LEFT JOIN chapter_versions v ON v.id = c.current_version_id
         LEFT JOIN chapter_drafts d ON d.chapter_id = c.id
         WHERE c.book_id = ?
         ORDER BY c.order_index ASC`,
      )
      .all(id) as Array<
      ChapterRow & { content_text: string | null; draft_text: string | null }
    >;

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
      const version = ch.content_text ?? "";
      const draft = ch.draft_text ?? "";
      // «Новее» считается по содержимому, а не по времени: автосейв и
      // принятие версии ложатся в одну секунду, и сравнение отметок времени
      // врало бы ровно в этом случае.
      const useDraft = draft.trim().length > 0 && draft !== version;
      lines.push(`## ${ch.title}`);
      lines.push("");
      if (useDraft) {
        lines.push(DRAFT_MARKER);
        lines.push("");
      }
      lines.push(useDraft ? draft : version);
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

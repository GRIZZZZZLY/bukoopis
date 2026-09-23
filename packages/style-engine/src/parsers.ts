import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type { ReferenceFormat } from "@book-forge/shared";

export interface ParsedReference {
  format: ReferenceFormat;
  text: string;
  scenes: string[];
}

export function detectFormat(filename: string): ReferenceFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  if (lower.endsWith(".fb2")) return "fb2";
  if (lower.endsWith(".epub")) return "epub";
  return null;
}

// ─────────── Text → scenes splitter ───────────
//
// Heuristic: split on chapter markers ("Глава N", "Chapter N", "Часть N") OR
// on >= 2 consecutive blank lines (scene break). Each scene must be at least
// 200 chars to filter out noise like ToC entries.
const CHAPTER_RE = /^(?:Глава|Часть|Chapter|Part)\s+[0-9IVX]+\b/im;

/** Верхняя граница «сцены» корпуса. Длиннее — режется по абзацам на куски
 *  примерно одинаковой длины, не больше этой. */
export const MAX_SCENE_CHARS = 5000;

/** Режет текст на куски не длиннее `max`, только по границам абзацев и на
 *  примерно равные части. Абзац длиннее `max` остаётся целым: резать
 *  посреди фразы хуже, чем дать длинный образец. */
export function capByParagraphs(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = Math.ceil(text.length / max);
  const target = text.length / pieces;
  const out: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
    if (size > 0 && (size + p.length > max || size >= target)) {
      out.push(current.join("\n\n"));
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.length + 2;
  }
  if (current.length > 0) out.push(current.join("\n\n"));
  return out.filter((s) => s.length >= 200);
}

export function splitIntoScenes(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/ /g, " ");
  // First pass — split by chapters
  const chapterPositions: number[] = [];
  const lines = normalized.split("\n");
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_RE.test(lines[i]!)) {
      chapterPositions.push(pos);
    }
    pos += lines[i]!.length + 1;
  }

  let units: string[];
  if (chapterPositions.length >= 2) {
    units = [];
    for (let i = 0; i < chapterPositions.length; i++) {
      const start = chapterPositions[i]!;
      const end =
        i + 1 < chapterPositions.length
          ? chapterPositions[i + 1]!
          : normalized.length;
      units.push(normalized.slice(start, end));
    }
  } else {
    units = [normalized];
  }

  // Second pass — within each chapter, split by blank-line gaps or explicit
  // scene markers («* * *»), then cap each piece at scene size on paragraph
  // boundaries. fb2 joins paragraphs with a single blank line, so without the
  // cap a whole 40 000-char chapter became one «scene» and the Writer saw only
  // its opening (шаг 2 правки прозы, 2026-09-23).
  const scenes: string[] = [];
  for (const unit of units) {
    const parts = unit
      .split(/\n\s*\n\s*\n+|\n\s*(?:\*\s*){3,}\s*\n/) // 2+ blank lines or «* * *»
      .map((p) => p.trim())
      .filter((p) => p.length >= 200);
    for (const part of parts) scenes.push(...capByParagraphs(part, MAX_SCENE_CHARS));
  }

  // Fallback: if too few scenes, just chunk by 2000-char windows
  if (scenes.length < 3) {
    const fallback: string[] = [];
    const window = 2000;
    for (let i = 0; i < normalized.length; i += window) {
      const slice = normalized.slice(i, i + window).trim();
      if (slice.length >= 200) fallback.push(slice);
    }
    return fallback.length >= 3 ? fallback : scenes;
  }
  return scenes;
}

// ─────────── TXT / MD ───────────

export function parseTxt(raw: string): ParsedReference {
  const text = raw.replace(/\r\n/g, "\n").trim();
  return { format: "txt", text, scenes: splitIntoScenes(text) };
}

export function parseMd(raw: string): ParsedReference {
  // Strip basic markdown markers; preserve text
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s+/gm, "")
    .trim();
  return { format: "md", text, scenes: splitIntoScenes(text) };
}

// ─────────── FB2 ───────────

const fb2Parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: false,
  textNodeName: "_text",
});

function extractFb2Paragraphs(node: unknown): string[] {
  const out: string[] = [];
  function walk(n: unknown): void {
    if (n === null || n === undefined) return;
    if (typeof n === "string") {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (typeof n === "object") {
      const obj = n as Record<string, unknown>;
      // FB2 paragraphs: <p>text</p>; <emphasis>, <strong> are inline.
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith("@_")) continue;
        if (k === "_text") {
          if (typeof v === "string") out.push(v);
          continue;
        }
        if (k === "image" || k === "title-info" || k === "binary") continue;
        walk(v);
      }
    }
  }
  walk(node);
  return out;
}

export function parseFb2(raw: string): ParsedReference {
  const xml = fb2Parser.parse(raw) as Record<string, unknown>;
  const fictionBook =
    (xml["FictionBook"] as Record<string, unknown> | undefined) ??
    (xml["fictionbook"] as Record<string, unknown> | undefined);
  if (!fictionBook) {
    return { format: "fb2", text: "", scenes: [] };
  }
  const body = fictionBook["body"];
  const paragraphs = extractFb2Paragraphs(body)
    .map((p) => p.trim())
    .filter(Boolean);
  const text = paragraphs.join("\n\n");
  return { format: "fb2", text, scenes: splitIntoScenes(text) };
}

// ─────────── EPUB ───────────

const xhtmlParser = new XMLParser({
  ignoreAttributes: true,
  preserveOrder: false,
  textNodeName: "_text",
});

// OPF нужен со своими атрибутами: `id`, `href` и `idref` и задают порядок
// spine. Общий xhtmlParser их выбрасывает — spine оставался пустым, и корпус
// читался в алфавитном порядке имён файлов, со служебными страницами вместе.
const opfParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: false,
  textNodeName: "_text",
});

function stripXhtmlText(node: unknown): string {
  const parts: string[] = [];
  function walk(n: unknown): void {
    if (n === null || n === undefined) return;
    if (typeof n === "string") {
      parts.push(n);
      return;
    }
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (typeof n === "object") {
      const obj = n as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith("@_")) continue;
        if (k === "_text") {
          if (typeof v === "string") parts.push(v);
          continue;
        }
        // Treat block-level elements as paragraph breaks
        if (
          k === "p" ||
          k === "div" ||
          k === "h1" ||
          k === "h2" ||
          k === "h3" ||
          k === "h4" ||
          k === "br"
        ) {
          parts.push("\n");
          walk(v);
          parts.push("\n");
          continue;
        }
        walk(v);
      }
    }
  }
  walk(node);
  return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

export async function parseEpub(buffer: Buffer): Promise<ParsedReference> {
  const zip = await JSZip.loadAsync(buffer);
  const opfFile = Object.keys(zip.files).find((p) => p.endsWith(".opf"));
  let spineFiles: string[] = [];
  if (opfFile) {
    const opfRaw = await zip.files[opfFile]!.async("string");
    const opf = opfParser.parse(opfRaw) as {
      package?: {
        manifest?: { item?: Array<{ "@_id"?: string; "@_href"?: string }> };
        spine?: { itemref?: Array<{ "@_idref"?: string }> };
      };
    };
    const manifest = opf.package?.manifest?.item ?? [];
    const spine = opf.package?.spine?.itemref ?? [];
    const idToHref = new Map<string, string>();
    const items = Array.isArray(manifest) ? manifest : [manifest];
    for (const item of items) {
      if (item && item["@_id"] && item["@_href"]) {
        idToHref.set(item["@_id"], item["@_href"]);
      }
    }
    const refs = Array.isArray(spine) ? spine : [spine];
    const opfDir = opfFile.includes("/")
      ? opfFile.slice(0, opfFile.lastIndexOf("/") + 1)
      : "";
    for (const ref of refs) {
      if (ref && ref["@_idref"]) {
        const href = idToHref.get(ref["@_idref"]);
        if (href) spineFiles.push(opfDir + decodeURIComponent(href));
      }
    }
  }
  if (spineFiles.length === 0) {
    spineFiles = Object.keys(zip.files).filter(
      (p) => p.endsWith(".xhtml") || p.endsWith(".html"),
    );
    spineFiles.sort();
  }

  const parts: string[] = [];
  for (const fp of spineFiles) {
    const file = zip.files[fp];
    if (!file) continue;
    const xhtmlRaw = await file.async("string");
    let parsed: unknown;
    try {
      parsed = xhtmlParser.parse(xhtmlRaw);
    } catch {
      continue;
    }
    const text = stripXhtmlText(parsed).trim();
    if (text.length > 0) parts.push(text);
  }
  const text = parts.join("\n\n").trim();
  return { format: "epub", text, scenes: splitIntoScenes(text) };
}

// ─────────── Dispatch ───────────

export async function parseReference(
  filename: string,
  raw: string | Buffer,
): Promise<ParsedReference> {
  const fmt = detectFormat(filename);
  if (!fmt) throw new Error(`unsupported format for "${filename}"`);
  if (fmt === "txt") return parseTxt(typeof raw === "string" ? raw : raw.toString("utf8"));
  if (fmt === "md") return parseMd(typeof raw === "string" ? raw : raw.toString("utf8"));
  if (fmt === "fb2")
    return parseFb2(typeof raw === "string" ? raw : raw.toString("utf8"));
  if (fmt === "epub") {
    const buf = typeof raw === "string" ? Buffer.from(raw, "base64") : raw;
    return parseEpub(buf);
  }
  throw new Error("unreachable");
}

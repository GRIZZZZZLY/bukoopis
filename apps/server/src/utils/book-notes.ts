import type { Database as DatabaseType } from "better-sqlite3";
import {
  extractEpisodicNotes,
  type EpisodicNoteExtractorInput,
} from "@book-forge/agents";
import { getEmbeddingProvider } from "@book-forge/retrieval";
import type { EpisodicNoteExtraction, NoteKind } from "@book-forge/shared";
import { logUsage } from "./usageLogger.js";

/**
 * Phase 4 — episodic memory repository.
 *
 * Notes are embedded on write. Relevant open notes are retrieved by vector
 * similarity (sqlite-vec `book_notes_vec` when available, JS cosine fallback
 * otherwise) so Plot/Reader see threads & foreshadowing worth paying off.
 */

const KIND_LABEL: Record<NoteKind, string> = {
  thread: "линия",
  foreshadow: "предзнаменование",
  arc_delta: "арка",
  theme: "тема",
  mystery: "загадка",
};

interface NoteRow {
  id: number;
  kind: NoteKind;
  chapter_order_introduced: number;
  title: string;
  body: string;
  embedding: Buffer | null;
}

function floatToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
function blobToFloat32(b: Buffer): Float32Array {
  const f = new Float32Array(b.byteLength / 4);
  for (let i = 0; i < f.length; i++) f[i] = b.readFloatLE(i * 4);
  return f;
}
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function vecAvailable(sqlite: DatabaseType): boolean {
  try {
    sqlite.prepare("SELECT 1 FROM book_notes_vec LIMIT 1").get();
    return true;
  } catch {
    return false;
  }
}

export interface OpenNote {
  id: number;
  kind: NoteKind;
  introduced: number;
  title: string;
  body: string;
}

/** Notes open at `atChapterOrder`: introduced ≤ cursor, not yet resolved (or
 *  resolved at/after the cursor). */
export function loadOpenNotes(
  sqlite: DatabaseType,
  bookId: number,
  atChapterOrder: number,
): OpenNote[] {
  const rows = sqlite
    .prepare(
      `SELECT id, kind, chapter_order_introduced, title, body
       FROM book_notes
       WHERE book_id = ?
         AND chapter_order_introduced <= ?
         AND (chapter_order_resolved IS NULL OR chapter_order_resolved >= ?)
       ORDER BY chapter_order_introduced ASC`,
    )
    .all(bookId, atChapterOrder, atChapterOrder) as Array<
    Omit<NoteRow, "embedding">
  >;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    introduced: r.chapter_order_introduced,
    title: r.title,
    body: r.body,
  }));
}

export function renderOpenNotesPrompt(
  notes: OpenNote[],
  heading: string,
  atChapterOrder: number,
): string | null {
  if (notes.length === 0) return null;
  const lines = notes.map(
    (n) =>
      `- [${KIND_LABEL[n.kind]}] ${n.title}: ${n.body} (с гл. #${n.introduced})`,
  );
  return `## ${heading} (актуально на главу #${atChapterOrder})\n${lines.join("\n")}`;
}

/**
 * Retrieve the top-k open notes most relevant to `queryText` (vector
 * similarity). Falls back to JS cosine when sqlite-vec is unavailable.
 */
export async function gatherRelevantNotes(
  sqlite: DatabaseType,
  bookId: number,
  queryText: string,
  atChapterOrder: number,
  k = 5,
): Promise<OpenNote[]> {
  const q = queryText.trim();
  if (!q) return [];
  const open = loadOpenNotes(sqlite, bookId, atChapterOrder);
  if (open.length === 0) return [];
  if (open.length <= k) return open;

  let qVec: Float32Array;
  try {
    qVec = await getEmbeddingProvider().embed(q);
  } catch {
    return open.slice(0, k);
  }

  if (vecAvailable(sqlite)) {
    try {
      const openIds = new Set(open.map((n) => n.id));
      const rows = sqlite
        .prepare(
          `SELECT v.rowid AS id, v.distance AS distance
           FROM book_notes_vec v
           WHERE v.embedding MATCH ? AND v.k = ?
           ORDER BY v.distance ASC`,
        )
        .all(floatToBlob(qVec), k * 4) as Array<{
        id: number;
        distance: number;
      }>;
      const byId = new Map(open.map((n) => [n.id, n]));
      const picked: OpenNote[] = [];
      for (const r of rows) {
        if (!openIds.has(r.id)) continue;
        const note = byId.get(r.id);
        if (note) picked.push(note);
        if (picked.length >= k) break;
      }
      if (picked.length > 0) return picked;
    } catch {
      /* fall through to JS cosine */
    }
  }

  // JS cosine fallback over stored embeddings.
  const withEmb = sqlite
    .prepare(
      `SELECT id, embedding FROM book_notes
       WHERE book_id = ? AND embedding IS NOT NULL`,
    )
    .all(bookId) as Array<{ id: number; embedding: Buffer }>;
  const score = new Map<number, number>();
  for (const e of withEmb) {
    score.set(e.id, cosine(qVec, blobToFloat32(e.embedding)));
  }
  return [...open]
    .sort((a, b) => (score.get(b.id) ?? -1) - (score.get(a.id) ?? -1))
    .slice(0, k);
}

/**
 * Persist a chapter's extracted notes: resolve named open notes, embed +
 * insert new ones (idempotent by (book_id, title) — re-running a chapter
 * replaces its same-title note).
 */
export async function persistEpisodicNotes(
  sqlite: DatabaseType,
  bookId: number,
  chapterOrder: number,
  sourceVersionId: number | null,
  extraction: EpisodicNoteExtraction,
): Promise<void> {
  const hasVec = vecAvailable(sqlite);
  const now = new Date().toISOString();

  for (const title of extraction.resolvedTitles) {
    sqlite
      .prepare(
        `UPDATE book_notes SET chapter_order_resolved = ?
         WHERE book_id = ? AND title = ? AND chapter_order_resolved IS NULL`,
      )
      .run(chapterOrder, bookId, title);
  }

  for (const n of extraction.newNotes) {
    let embBlob: Buffer | null = null;
    try {
      const v = await getEmbeddingProvider().embed(`${n.title}\n${n.body}`);
      embBlob = floatToBlob(v);
    } catch {
      embBlob = null;
    }

    const tx = sqlite.transaction(() => {
      // Replace a same-title note from this chapter (re-extraction).
      const prior = sqlite
        .prepare(
          `SELECT id FROM book_notes
           WHERE book_id = ? AND title = ?
             AND chapter_order_introduced = ?`,
        )
        .get(bookId, n.title, chapterOrder) as { id: number } | undefined;
      if (prior) {
        sqlite.prepare("DELETE FROM book_notes WHERE id = ?").run(prior.id);
        if (hasVec) {
          try {
            sqlite
              .prepare("DELETE FROM book_notes_vec WHERE rowid = ?")
              .run(prior.id);
          } catch {
            /* ignore */
          }
        }
      }

      const info = sqlite
        .prepare(
          `INSERT INTO book_notes
             (book_id, kind, chapter_order_introduced, chapter_order_resolved,
              title, body, embedding, tags, related_note_ids,
              source_version_id, created_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, '[]', ?, ?)`,
        )
        .run(
          bookId,
          n.kind,
          chapterOrder,
          n.title,
          n.body,
          embBlob,
          JSON.stringify(n.tags ?? []),
          sourceVersionId,
          now,
        );
      const id = Number(info.lastInsertRowid);
      if (hasVec && embBlob) {
        try {
          sqlite
            .prepare(
              "INSERT OR REPLACE INTO book_notes_vec(rowid, embedding) VALUES (?, ?)",
            )
            .run(id, embBlob);
        } catch {
          /* vec optional */
        }
      }
    });
    tx();
  }
}

/**
 * Fire-and-forget: extract episodic notes from a freshly written chapter and
 * persist them. Never throws into the caller's save flow.
 */
export async function triggerEpisodicNotes(
  sqlite: DatabaseType,
  versionId: number,
): Promise<void> {
  try {
    const v = sqlite
      .prepare(
        `SELECT id, chapter_id, content_text, word_count
         FROM chapter_versions WHERE id = ?`,
      )
      .get(versionId) as
      | {
          id: number;
          chapter_id: number;
          content_text: string;
          word_count: number;
        }
      | undefined;
    if (!v) return;
    if (v.word_count < 80) return;

    const ch = sqlite
      .prepare(
        "SELECT id, book_id, title, order_index FROM chapters WHERE id = ?",
      )
      .get(v.chapter_id) as
      | { id: number; book_id: number; title: string; order_index: number }
      | undefined;
    if (!ch) return;

    const bk = sqlite
      .prepare("SELECT title, critic_model FROM books WHERE id = ?")
      .get(ch.book_id) as
      | { title: string; critic_model: "sonnet" | "opus" }
      | undefined;
    if (!bk) return;

    const open = loadOpenNotes(
      sqlite,
      ch.book_id,
      Math.max(0, ch.order_index - 1),
    );
    const openRendered = renderOpenNotesPrompt(
      open,
      "Открытые заметки",
      Math.max(0, ch.order_index - 1),
    );

    const payload: EpisodicNoteExtractorInput = {
      bookTitle: bk.title,
      chapterTitle: ch.title,
      chapterOrder: ch.order_index,
      chapterText: v.content_text,
      openNotes: openRendered,
      model: bk.critic_model ?? "sonnet",
      onUsage: (u) =>
        logUsage(sqlite, {
          route: "episodic.notes",
          model: u.modelId,
          usage: {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            cacheCreationInputTokens: u.cacheCreationInputTokens,
            cacheReadInputTokens: u.cacheReadInputTokens,
          },
          bookId: ch.book_id,
          chapterId: ch.id,
          versionId,
        }),
    };

    const result = await extractEpisodicNotes(payload);
    if (result.newNotes.length > 0 || result.resolvedTitles.length > 0) {
      await persistEpisodicNotes(
        sqlite,
        ch.book_id,
        ch.order_index,
        versionId,
        result,
      );
    }
  } catch (e) {
    console.warn(
      "[episodic-notes] extraction failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

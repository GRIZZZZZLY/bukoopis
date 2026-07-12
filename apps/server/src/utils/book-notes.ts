import type { Database as DatabaseType } from "better-sqlite3";
import {
  extractEpisodicNotes,
  type EpisodicNoteExtractorInput,
} from "@book-forge/agents";
import { getEmbeddingProvider } from "@book-forge/retrieval";
import type { EpisodicNoteExtraction, NoteKind } from "@book-forge/shared";
import { logUsage } from "./usageLogger.js";
import { rerankByRelevance, rerankEnabled } from "./rerank.js";

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
  opts?: { withIds?: boolean },
): string | null {
  if (notes.length === 0) return null;
  // withIds prefixes each note with its stable id (note_<id>) so the
  // extractor can resolve notes by id instead of fragile exact-title match.
  // Contexts for Plot/critics stay id-free to avoid prompt noise.
  const lines = notes.map(
    (n) =>
      `- ${opts?.withIds ? `[note_${n.id}] ` : ""}[${KIND_LABEL[n.kind]}] ${n.title}: ${n.body} (с гл. #${n.introduced})`,
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

  // Larger pool when the reranker is on, then narrow to k.
  const poolK = rerankEnabled() ? Math.min(open.length, k * 4) : k;
  const noteText = (n: OpenNote): string => `${n.title}\n${n.body}`;

  let qVec: Float32Array;
  try {
    qVec = await getEmbeddingProvider().embed(q);
  } catch {
    return rerankByRelevance(open.slice(0, poolK), q, noteText, k);
  }

  if (vecAvailable(sqlite)) {
    try {
      const openIds = new Set(open.map((n) => n.id));
      const rows = sqlite
        .prepare(
          // ADR 0003 slice 4: book_id filter inside the KNN MATCH — previously
          // notes KNN was unscoped across books and relied on the openIds set
          // to discard cross-book hits after the fact (candidate loss).
          `SELECT v.rowid AS id, v.distance AS distance
           FROM book_notes_vec v
           WHERE v.embedding MATCH ? AND v.k = ? AND v.book_id = ?
           ORDER BY v.distance ASC`,
        )
        .all(floatToBlob(qVec), poolK * 4, BigInt(bookId)) as Array<{
        id: number;
        distance: number;
      }>;
      const byId = new Map(open.map((n) => [n.id, n]));
      const picked: OpenNote[] = [];
      for (const r of rows) {
        if (!openIds.has(r.id)) continue;
        const note = byId.get(r.id);
        if (note) picked.push(note);
        if (picked.length >= poolK) break;
      }
      if (picked.length > 0) {
        return rerankByRelevance(picked, q, noteText, k);
      }
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
  const cosinePool = [...open]
    .sort((a, b) => (score.get(b.id) ?? -1) - (score.get(a.id) ?? -1))
    .slice(0, poolK);
  return rerankByRelevance(cosinePool, q, noteText, k);
}

/**
 * Synchronous materialization of extracted notes with PRECOMPUTED embeddings
 * (ADR 0002, I4): safe to call inside the atomic activation transaction —
 * no async work here. `embeddings[i]` pairs with `extraction.newNotes[i]`;
 * null means "no embedding" (provider was unavailable — cosine/vec skip it).
 */
export function materializeEpisodicNotes(
  sqlite: DatabaseType,
  bookId: number,
  chapterOrder: number,
  sourceVersionId: number | null,
  extraction: EpisodicNoteExtraction,
  embeddings: ReadonlyArray<Buffer | null>,
): void {
  const hasVec = vecAvailable(sqlite);
  const now = new Date().toISOString();

  // Resolve by stable id. The WHERE clause enforces book scope and open
  // state; the Set dedupes repeated ids from the model. Unknown/foreign/
  // already-resolved ids affect 0 rows and are logged, never applied.
  const resolvedIds = new Set<number>();
  for (const ref of extraction.resolvedNoteIds) {
    const id = Number(ref.slice("note_".length));
    if (Number.isInteger(id) && id > 0) resolvedIds.add(id);
  }
  for (const id of resolvedIds) {
    const res = sqlite
      .prepare(
        `UPDATE book_notes SET chapter_order_resolved = ?
         WHERE id = ? AND book_id = ? AND chapter_order_resolved IS NULL`,
      )
      .run(chapterOrder, id, bookId);
    if (res.changes === 0) {
      console.warn(
        `[episodic-notes] resolvedNoteId note_${id} skipped (missing, other book, or already resolved)`,
      );
    }
  }

  for (let i = 0; i < extraction.newNotes.length; i++) {
    const n = extraction.newNotes[i]!;
    const embBlob = embeddings[i] ?? null;

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
              "INSERT OR REPLACE INTO book_notes_vec(rowid, embedding, book_id) VALUES (?, ?, ?)",
            )
            .run(id, embBlob, BigInt(bookId));
        } catch {
          /* vec optional */
        }
      }
    });
    tx();
  }
}

/** Best-effort embeddings for extracted notes (null per note on failure). */
export async function embedExtractedNotes(
  extraction: EpisodicNoteExtraction,
): Promise<Array<Buffer | null>> {
  const out: Array<Buffer | null> = [];
  for (const n of extraction.newNotes) {
    try {
      const v = await getEmbeddingProvider().embed(`${n.title}\n${n.body}`);
      out.push(floatToBlob(v));
    } catch {
      out.push(null);
    }
  }
  return out;
}

/**
 * Persist a chapter's extracted notes: embed (best-effort) + materialize.
 * Legacy direct-persist path; the memory worker stages the extraction and
 * the activation step calls `materializeEpisodicNotes` instead (ADR 0002).
 */
export async function persistEpisodicNotes(
  sqlite: DatabaseType,
  bookId: number,
  chapterOrder: number,
  sourceVersionId: number | null,
  extraction: EpisodicNoteExtraction,
): Promise<void> {
  const embeddings = await embedExtractedNotes(extraction);
  materializeEpisodicNotes(
    sqlite,
    bookId,
    chapterOrder,
    sourceVersionId,
    extraction,
    embeddings,
  );
}

export interface NotesExtractionResult {
  newCount: number;
  resolvedCount: number;
  /** Row missing / too short — nothing to do, treated as success. */
  skipped?: "missing" | "short";
  /** shouldPersist() said the version is no longer current — nothing was
   *  written to the active tables (ADR 0002, I3). */
  stale?: boolean;
}

export interface NotesPayload {
  extraction: EpisodicNoteExtraction;
  bookId: number;
  chapterId: number;
  chapterOrder: number;
  skipped?: "missing" | "short";
}

const EMPTY_EXTRACTION: EpisodicNoteExtraction = {
  newNotes: [],
  resolvedNoteIds: [],
  notes: null,
};

/**
 * Throwing payload core: run the LLM extraction WITHOUT touching active
 * tables (ADR 0002, I4 — the worker stages this payload in result_json and
 * the atomic activation step materializes it via `materializeEpisodicNotes`).
 */
export async function extractNotesPayload(
  sqlite: DatabaseType,
  versionId: number,
): Promise<NotesPayload> {
  const missing: NotesPayload = {
    extraction: EMPTY_EXTRACTION,
    bookId: 0,
    chapterId: 0,
    chapterOrder: 0,
    skipped: "missing",
  };
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
  if (!v) return missing;

  const ch = sqlite
    .prepare(
      "SELECT id, book_id, title, order_index FROM chapters WHERE id = ?",
    )
    .get(v.chapter_id) as
    | { id: number; book_id: number; title: string; order_index: number }
    | undefined;
  if (!ch) return missing;
  const base = {
    bookId: ch.book_id,
    chapterId: ch.id,
    chapterOrder: ch.order_index,
  };
  if (v.word_count < 80) {
    return { ...base, extraction: EMPTY_EXTRACTION, skipped: "short" };
  }

  const bk = sqlite
    .prepare("SELECT title, critic_model FROM books WHERE id = ?")
    .get(ch.book_id) as
    | { title: string; critic_model: "sonnet" | "opus" }
    | undefined;
  if (!bk) return missing;

  const open = loadOpenNotes(
    sqlite,
    ch.book_id,
    Math.max(0, ch.order_index - 1),
  );
  const openRendered = renderOpenNotesPrompt(
    open,
    "Открытые заметки",
    Math.max(0, ch.order_index - 1),
    { withIds: true },
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
  return { ...base, extraction: result };
}

/**
 * Throwing core: payload extraction + direct persist (legacy path used by
 * the fire-and-forget wrapper and its tests). The worker stages the payload
 * instead and materializes it at activation. `opts.shouldPersist` is checked
 * after the LLM call, right before touching active tables.
 */
export async function extractNotesForVersion(
  sqlite: DatabaseType,
  versionId: number,
  opts?: { shouldPersist?: () => boolean },
): Promise<NotesExtractionResult> {
  const p = await extractNotesPayload(sqlite, versionId);
  if (p.skipped) return { newCount: 0, resolvedCount: 0, skipped: p.skipped };
  const counts = {
    newCount: p.extraction.newNotes.length,
    resolvedCount: p.extraction.resolvedNoteIds.length,
  };
  if (opts?.shouldPersist && !opts.shouldPersist()) {
    return { ...counts, stale: true };
  }
  if (counts.newCount > 0 || counts.resolvedCount > 0) {
    await persistEpisodicNotes(
      sqlite,
      p.bookId,
      p.chapterOrder,
      versionId,
      p.extraction,
    );
  }
  return counts;
}

/**
 * Fire-and-forget wrapper around `extractNotesForVersion` — never throws into
 * the caller's save flow. Legacy path; the durable memory worker calls the
 * core directly (ADR 0002).
 */
export async function triggerEpisodicNotes(
  sqlite: DatabaseType,
  versionId: number,
): Promise<void> {
  try {
    await extractNotesForVersion(sqlite, versionId);
  } catch (e) {
    console.warn(
      "[episodic-notes] extraction failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

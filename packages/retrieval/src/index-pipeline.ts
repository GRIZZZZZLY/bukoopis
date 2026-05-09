import type { Database as DatabaseType } from "better-sqlite3";
import { chunkText } from "./chunker.js";
import { getEmbeddingProvider } from "./embeddings.js";

export interface IndexChapterVersionInput {
  bookId: number;
  chapterId: number;
  chapterOrder: number;
  versionId: number;
  language: string;
  text: string;
}

function floatToBlob(v: Float32Array): Buffer {
  // sqlite-vec accepts the raw little-endian float32 buffer.
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export async function indexChapterVersion(
  sqlite: DatabaseType,
  hasVec: boolean,
  input: IndexChapterVersionInput,
): Promise<{ chunkCount: number }> {
  // Remove any existing chunks for this version (re-index path).
  sqlite
    .prepare(
      "DELETE FROM chunks WHERE source_type = 'chapter_version' AND source_id = ?",
    )
    .run(input.versionId);
  if (hasVec) {
    // chunk_vec rows are referenced by chunk rowid; cascade is manual since
    // it's a virtual table without FK support.
    // Find dangling vec rows and delete; cheaper to leave them since chunk_vec
    // is decoupled and we'll only query by joined ids. But cleanup keeps it tidy.
  }

  const chunks = chunkText(input.text, { targetTokens: 600, overlapTokens: 100 });
  if (chunks.length === 0) return { chunkCount: 0 };

  const provider = getEmbeddingProvider();
  const embeddings = await provider.embedBatch(chunks.map((c) => c.text));
  const now = new Date().toISOString();

  const insertChunk = sqlite.prepare(
    `INSERT INTO chunks
     (book_id, source_type, source_id, chapter_id, chapter_order, language,
      text, start_offset, end_offset, token_count, is_reference, created_at)
     VALUES (?, 'chapter_version', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const insertVec = hasVec
    ? sqlite.prepare(
        "INSERT OR REPLACE INTO chunk_vec(rowid, embedding) VALUES (?, ?)",
      )
    : null;

  const tx = sqlite.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const info = insertChunk.run(
        input.bookId,
        input.versionId,
        input.chapterId,
        input.chapterOrder,
        input.language,
        c.text,
        c.startOffset,
        c.endOffset,
        c.tokenCount,
        now,
      );
      if (insertVec) {
        const rowid =
          typeof info.lastInsertRowid === "bigint"
            ? info.lastInsertRowid
            : BigInt(info.lastInsertRowid);
        insertVec.run(rowid, floatToBlob(embeddings[i]!));
      }
    }
  });
  tx();

  return { chunkCount: chunks.length };
}

/**
 * Re-embed all stored content with the currently configured provider.
 *
 * The old FNV-1a stub vectors are NOT comparable with real ONNX vectors, so
 * after switching providers (or changing EMBEDDING_MODEL) existing rows in
 * `chunk_vec` / `book_notes` embeddings are stale and must be recomputed:
 *
 *   pnpm --filter @book-forge/server reindex
 *
 * Honors EMBEDDING_PROVIDER / EMBEDDING_MODEL like the server boot does.
 * No-op-safe to re-run.
 */
import "dotenv/config";
import type { Database as DatabaseType } from "better-sqlite3";
import { getEmbeddingProvider } from "@book-forge/retrieval";
import { createDb, resolveDbPath } from "../db/client.js";
import { bootstrapVirtualTables } from "../db/virtual.js";
import { configureEmbeddingProvider } from "../utils/embedding-setup.js";

const BATCH = 32;

function floatToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

async function reindexChunks(
  sqlite: DatabaseType,
  hasVec: boolean,
): Promise<number> {
  if (!hasVec) {
    console.log("↷ chunk_vec: sqlite-vec unavailable — skipping vector reindex");
    return 0;
  }
  const rows = sqlite
    .prepare("SELECT id, text, book_id FROM chunks ORDER BY id")
    .all() as Array<{ id: number; text: string; book_id: number }>;
  // book_id metadata column (ADR 0003 slice 4) — required for the in-MATCH
  // book filter; a NULL here would make the row invisible to search.
  const insertVec = sqlite.prepare(
    "INSERT OR REPLACE INTO chunk_vec(rowid, embedding, book_id) VALUES (?, ?, ?)",
  );
  const provider = getEmbeddingProvider();
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vecs = await provider.embedBatch(batch.map((r) => r.text));
    const tx = sqlite.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        insertVec.run(
          batch[j]!.id,
          floatToBlob(vecs[j]!),
          BigInt(batch[j]!.book_id),
        );
      }
    });
    tx();
    done += batch.length;
    console.log(`  chunks: ${done}/${rows.length}`);
  }
  return done;
}

async function reindexNotes(
  sqlite: DatabaseType,
  hasVec: boolean,
): Promise<number> {
  const rows = sqlite
    .prepare("SELECT id, title, body, book_id FROM book_notes ORDER BY id")
    .all() as Array<{ id: number; title: string; body: string; book_id: number }>;
  const updateNote = sqlite.prepare(
    "UPDATE book_notes SET embedding = ? WHERE id = ?",
  );
  const insertVec = hasVec
    ? sqlite.prepare(
        "INSERT OR REPLACE INTO book_notes_vec(rowid, embedding, book_id) VALUES (?, ?, ?)",
      )
    : null;
  const provider = getEmbeddingProvider();
  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // Must match persistEpisodicNotes: embed `${title}\n${body}`.
    const vecs = await provider.embedBatch(
      batch.map((r) => `${r.title}\n${r.body}`),
    );
    const tx = sqlite.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const blob = floatToBlob(vecs[j]!);
        updateNote.run(blob, batch[j]!.id);
        insertVec?.run(batch[j]!.id, blob, BigInt(batch[j]!.book_id));
      }
    });
    tx();
    done += batch.length;
    console.log(`  notes: ${done}/${rows.length}`);
  }
  return done;
}

async function main(): Promise<void> {
  const providerName = configureEmbeddingProvider();
  console.log(`🧬 reindexing with: ${providerName}`);
  const { sqlite, hasVec } = createDb(resolveDbPath());
  bootstrapVirtualTables(sqlite, hasVec);

  const chunks = await reindexChunks(sqlite, hasVec);
  const notes = await reindexNotes(sqlite, hasVec);

  sqlite.close();
  console.log(`✅ reindexed ${chunks} chunks, ${notes} notes`);
}

main().catch((e) => {
  console.error("reindex failed:", e);
  process.exit(1);
});

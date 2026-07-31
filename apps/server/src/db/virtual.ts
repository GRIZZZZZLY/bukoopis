import type { Database as DatabaseType } from "better-sqlite3";

export const EMBEDDING_DIM = 384;

const VIRTUAL_TABLES_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
  text,
  content='chunks',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunk_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO chunk_fts(rowid, text) VALUES (new.id, new.text);
END;
`;

// ADR 0003 slice 4 — book_id is a vec0 metadata column so the book filter runs
// INSIDE the KNN MATCH (equality). Previously book_id was filtered by a JOIN
// AFTER a global top-k, which could exhaust the k slots on other books' vectors
// and starve the current book of candidates.
const VEC_TABLE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}],
  book_id integer
);
`;

// Phase 4 — episodic notes vector index. rowid = book_notes.id.
const NOTES_VEC_TABLE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS book_notes_vec USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}],
  book_id integer
);
`;

/**
 * If a vec table predates the book_id metadata column (ADR 0003 slice 4),
 * drop it so it can be recreated with the new schema. Vectors are lost and
 * must be rebuilt (`pnpm --filter @book-forge/server reindex`); until then
 * search degrades to FTS. The source chunks/notes are untouched.
 */
function dropStaleVecTable(sqlite: DatabaseType, table: string): void {
  let exists = false;
  try {
    sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    exists = true;
  } catch {
    return; // table not present yet — will be created fresh
  }
  if (!exists) return;
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === "book_id")) {
    console.warn(
      `[db] ${table} predates book_id metadata — recreating (vectors dropped; run \`pnpm --filter @book-forge/server reindex\`).`,
    );
    sqlite.exec(`DROP TABLE ${table};`);
  }
}

export function bootstrapVirtualTables(
  sqlite: DatabaseType,
  hasVec: boolean,
): void {
  sqlite.exec(VIRTUAL_TABLES_SQL);
  if (hasVec) {
    dropStaleVecTable(sqlite, "chunk_vec");
    dropStaleVecTable(sqlite, "book_notes_vec");
    sqlite.exec(VEC_TABLE_SQL);
    sqlite.exec(NOTES_VEC_TABLE_SQL);
  }
}

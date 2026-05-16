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

const VEC_TABLE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}]
);
`;

// Phase 4 — episodic notes vector index. rowid = book_notes.id.
const NOTES_VEC_TABLE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS book_notes_vec USING vec0(
  rowid INTEGER PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}]
);
`;

export function bootstrapVirtualTables(
  sqlite: DatabaseType,
  hasVec: boolean,
): void {
  sqlite.exec(VIRTUAL_TABLES_SQL);
  if (hasVec) {
    sqlite.exec(VEC_TABLE_SQL);
    sqlite.exec(NOTES_VEC_TABLE_SQL);
  }
}

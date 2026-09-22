/**
 * Пересчёт `content_text` из `content_json` (F10 ревью 2026-09-22).
 *
 * До правки `extractText` склеивал главу в одну строку, и такие строки уже
 * лежат в `chapter_versions` и `chapter_drafts`. Структура цела в
 * `content_json`, поэтому текст восстанавливается без потерь:
 *
 *   pnpm --filter @book-forge/server recompute-text
 *
 * Перед записью делает копию базы. Повторный запуск ничего не меняет.
 * Память глав не пересобирает: слова те же, изменились только разделители
 * абзацев. Кому нужны новые чанки поиска — «Перестроить память с главы N».
 */
import type { Database as DatabaseType } from "better-sqlite3";
import { createDb, resolveDbPath } from "../db/client.js";
import { backupDatabase } from "../db/backup.js";
import { extractText } from "../utils/prosemirror.js";

export function recomputeContentText(sqlite: DatabaseType): { versions: number; drafts: number } {
  const redo = (table: "chapter_versions" | "chapter_drafts"): number => {
    const rows = sqlite
      .prepare(`SELECT rowid AS rid, content_json, content_text FROM ${table}`)
      .all() as Array<{ rid: number; content_json: string; content_text: string }>;
    const update = sqlite.prepare(`UPDATE ${table} SET content_text = ? WHERE rowid = ?`);
    let changed = 0;
    for (const r of rows) {
      let doc: unknown;
      try {
        doc = JSON.parse(r.content_json);
      } catch {
        continue; // нечитаемый JSON — оставляем прежний текст, он лучше пустого
      }
      const text = extractText(doc);
      if (text !== r.content_text) {
        update.run(text, r.rid);
        changed++;
      }
    }
    return changed;
  };
  return sqlite.transaction(() => ({
    versions: redo("chapter_versions"),
    drafts: redo("chapter_drafts"),
  }))();
}

const runAsScript =
  process.argv[1] !== undefined && /recompute-content-text\.(ts|js)$/.test(process.argv[1]);
if (runAsScript) {
  const dbPath = resolveDbPath();
  const backup = backupDatabase(dbPath);
  if (backup) console.log(`🛟 backup: ${backup}`);
  const { sqlite } = createDb(dbPath);
  const r = recomputeContentText(sqlite);
  sqlite.close();
  console.log(`✅ content_text пересчитан: версий ${r.versions}, черновиков ${r.drafts}`);
}

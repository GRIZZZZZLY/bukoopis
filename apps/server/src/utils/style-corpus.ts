import type { Database as DatabaseType } from "better-sqlite3";

export interface ParsedCorpusLike {
  format: string;
  text: string;
  scenes: string[];
}

/** Один способ положить корпус в профиль — им пользуются и загрузка файла,
 *  и добор последних глав книги. Одна транзакция: корпус, сцены, отметка
 *  профиля. Возвращает id корпуса. */
export function insertReferenceCorpus(
  sqlite: DatabaseType,
  profile: { id: number; language: string },
  filename: string,
  parsed: ParsedCorpusLike,
): number {
  const now = new Date().toISOString();
  const tx = sqlite.transaction(() => {
    const info = sqlite
      .prepare(
        `INSERT INTO reference_corpora
         (profile_id, filename, format, language, raw_text, char_count, scene_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.id,
        filename,
        parsed.format,
        profile.language,
        parsed.text,
        parsed.text.length,
        parsed.scenes.length,
        now,
      );
    const corpusId = Number(info.lastInsertRowid);
    const insertScene = sqlite.prepare(
      `INSERT INTO reference_scenes (corpus_id, order_index, text, char_count, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < parsed.scenes.length; i++) {
      const scene = parsed.scenes[i]!;
      insertScene.run(corpusId, i, scene, scene.length, now);
    }
    sqlite
      .prepare("UPDATE style_profiles SET updated_at = ? WHERE id = ?")
      .run(now, profile.id);
    return corpusId;
  });
  return tx();
}

import type { Database as DatabaseType } from "better-sqlite3";
import {
  CONTEXT_PROMPT_VERSION,
  contextManifestSchema,
  snapshotFingerprint,
  type ContextManifest,
  type ContextPurpose,
} from "@book-forge/shared";
import type { AssembledContext } from "./generation-context.js";

/**
 * Манифесты контекста (этап 4, раздел 8.1): что вошло в сборку и отпечаток
 * набора источников. Записываются при каждой сборке; манифест Writer'а
 * привязывается к версии главы при принятии кандидата, и критика потом
 * сверяет с ним свой отпечаток. Расхождение — сигнал автору, не блокировка.
 */

export interface RecordManifestArgs {
  bookId: number;
  chapterId: number;
  /** У Writer — null до принятия; критике и правке версия известна сразу. */
  chapterVersionId: number | null;
  purpose: ContextPurpose;
  assembled: AssembledContext;
}

export function manifestOf(
  purpose: ContextPurpose,
  assembled: AssembledContext,
): ContextManifest {
  return contextManifestSchema.parse({
    purpose,
    sources: assembled.sourceRefs,
    includedSections: assembled.compiled.includedIds,
    droppedSections: assembled.compiled.dropped,
    budgetTokens: assembled.compiled.budgetTokens,
    usedTokens: assembled.compiled.totalTokens,
    promptVersion: CONTEXT_PROMPT_VERSION,
  });
}

export function recordContextManifest(
  sqlite: DatabaseType,
  args: RecordManifestArgs,
): { id: number; fingerprint: string; manifest: ContextManifest } {
  const manifest = manifestOf(args.purpose, args.assembled);
  const fingerprint = snapshotFingerprint(manifest.sources);
  const info = sqlite
    .prepare(
      `INSERT INTO context_manifests
         (book_id, chapter_id, chapter_version_id, purpose, fingerprint, manifest_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.bookId,
      args.chapterId,
      args.chapterVersionId,
      args.purpose,
      fingerprint,
      JSON.stringify(manifest),
      new Date().toISOString(),
    );
  return { id: Number(info.lastInsertRowid), fingerprint, manifest };
}

/** Принятие кандидата создало версию — манифест Writer'а теперь её. */
export function attachManifestToVersion(
  sqlite: DatabaseType,
  manifestId: number,
  versionId: number,
): void {
  sqlite
    .prepare("UPDATE context_manifests SET chapter_version_id = ? WHERE id = ?")
    .run(versionId, manifestId);
}

/** Отпечаток базы, на которой версия была НАПИСАНА. null — версия не из
 *  Writer'а (импорт, ручная правка, написана до этапа 4): сравнивать нечем. */
export function writerFingerprintForVersion(
  sqlite: DatabaseType,
  versionId: number,
): string | null {
  const row = sqlite
    .prepare(
      `SELECT fingerprint FROM context_manifests
       WHERE chapter_version_id = ? AND purpose = 'writer'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(versionId) as { fingerprint: string } | undefined;
  return row?.fingerprint ?? null;
}

/** true — база уехала с момента написания; false — та же; null — сравнить
 *  нечем. Три ответа, а не два: «не знаем» и «не изменилась» — разные вещи,
 *  и схлопнуть их значило бы обещать совпадение, которого никто не проверял. */
export function compareWithWriterBase(
  sqlite: DatabaseType,
  versionId: number,
  fingerprint: string,
): boolean | null {
  const written = writerFingerprintForVersion(sqlite, versionId);
  if (written === null) return null;
  return written !== fingerprint;
}

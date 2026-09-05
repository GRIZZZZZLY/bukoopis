import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  proseProposalSchema,
  type ProposalKind,
  type ProseProposal,
  type ProseProposalStatus,
} from "@book-forge/shared";

export interface ProseProposalRow {
  id: number;
  book_id: number;
  chapter_id: number;
  kind: string;
  status: string;
  base_version_id: number | null;
  base_draft_revision: number | null;
  context_fingerprint: string;
  content_text: string;
  content_json: string;
  word_count: number;
  completion: string;
  stop_reason: string | null;
  model_id: string | null;
  backend: string | null;
  accepted_version_id: number | null;
  accept_request_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function toProposal(row: ProseProposalRow): ProseProposal {
  return proseProposalSchema.parse({
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    kind: row.kind,
    status: row.status,
    baseVersionId: row.base_version_id,
    baseDraftRevision: row.base_draft_revision,
    contextFingerprint: row.context_fingerprint,
    contentText: row.content_text,
    contentJson: row.content_json,
    wordCount: row.word_count,
    completion: row.completion,
    stopReason: row.stop_reason,
    modelId: row.model_id,
    backend: row.backend,
    acceptedVersionId: row.accepted_version_id,
    acceptRequestId: row.accept_request_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** Отпечаток того, от чего кандидат зависит и что могло уехать, пока модель
 *  писала: план главы, текущая версия и время последней правки книги (её
 *  двигают правки персонажей, лора и плана). Совпал — база та же; разошёлся —
 *  автор увидит предупреждение и решит сам, а не примет вслепую. */
export function contextFingerprint(sqlite: DatabaseType, chapterId: number): string {
  const row = sqlite
    .prepare(
      `SELECT c.plan_json, c.current_version_id, c.intent, b.updated_at AS book_updated_at
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`,
    )
    .get(chapterId) as
    | {
        plan_json: string | null;
        current_version_id: number | null;
        intent: string | null;
        book_updated_at: string;
      }
    | undefined;
  if (!row) return "";
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.plan_json,
        row.current_version_id,
        row.intent,
        row.book_updated_at,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

export interface CreateProposalInput {
  bookId: number;
  chapterId: number;
  kind: ProposalKind;
  baseVersionId: number | null;
}

const EMPTY_CONTENT_JSON = '{"type":"doc","content":[{"type":"paragraph"}]}';

/** Кандидат заводится ДО первого токена: тогда отмена, падение процесса и
 *  поздний ответ имеют, к чему прицепиться, а «висящий» прогон видно в базе. */
export function createProposal(
  sqlite: DatabaseType,
  input: CreateProposalInput,
): number {
  const draft = sqlite
    .prepare("SELECT revision FROM chapter_drafts WHERE chapter_id = ?")
    .get(input.chapterId) as { revision: number } | undefined;
  const now = new Date().toISOString();
  const info = sqlite
    .prepare(
      `INSERT INTO prose_proposals
         (book_id, chapter_id, kind, status, base_version_id, base_draft_revision,
          context_fingerprint, content_text, content_json, word_count,
          completion, created_at, updated_at)
       VALUES (?, ?, ?, 'streaming', ?, ?, ?, '', ?, 0, 'unconfirmed', ?, ?)`,
    )
    .run(
      input.bookId,
      input.chapterId,
      input.kind,
      input.baseVersionId,
      draft ? draft.revision : null,
      contextFingerprint(sqlite, input.chapterId),
      EMPTY_CONTENT_JSON,
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

export interface FinishProposalInput {
  status: Extract<ProseProposalStatus, "ready" | "incomplete" | "cancelled" | "failed">;
  contentText?: string;
  contentJson?: string;
  wordCount?: number;
  completion?: "confirmed" | "unconfirmed";
  stopReason?: string | null;
  modelId?: string | null;
  backend?: string | null;
  errorMessage?: string | null;
}

export function finishProposal(
  sqlite: DatabaseType,
  id: number,
  input: FinishProposalInput,
): void {
  sqlite
    .prepare(
      `UPDATE prose_proposals SET
         status = ?,
         content_text = COALESCE(?, content_text),
         content_json = COALESCE(?, content_json),
         word_count = COALESCE(?, word_count),
         completion = COALESCE(?, completion),
         stop_reason = ?,
         model_id = ?,
         backend = ?,
         error_message = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.status,
      input.contentText ?? null,
      input.contentJson ?? null,
      input.wordCount ?? null,
      input.completion ?? null,
      input.stopReason ?? null,
      input.modelId ?? null,
      input.backend ?? null,
      input.errorMessage ?? null,
      new Date().toISOString(),
      id,
    );
}

export function loadProposal(
  sqlite: DatabaseType,
  id: number,
): ProseProposal | undefined {
  const row = sqlite
    .prepare("SELECT * FROM prose_proposals WHERE id = ?")
    .get(id) as ProseProposalRow | undefined;
  return row ? toProposal(row) : undefined;
}

export function listProposals(
  sqlite: DatabaseType,
  chapterId: number,
  limit = 10,
): ProseProposal[] {
  const rows = sqlite
    .prepare(
      "SELECT * FROM prose_proposals WHERE chapter_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(chapterId, limit) as ProseProposalRow[];
  return rows.map(toProposal);
}

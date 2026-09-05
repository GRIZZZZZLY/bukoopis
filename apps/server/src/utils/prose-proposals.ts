import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  proseProposalSchema,
  type ProposalKind,
  type ProseProposal,
  type ProseProposalStatus,
  applyProseChangesToNodes,
  diffProseBlocks,
  docToNodes,
  nodesToBlocks,
  nodesToDoc,
  REPAIR_BRANCH_PREFIX,
  type AcceptProseProposalInput,
} from "@book-forge/shared";
import { enqueueMemoryJobs, COMMIT_JOB_KINDS } from "./memory-queue.js";
import { markMemoryStaleOnCommit } from "./memory-activation.js";
import { extractText, countWords } from "./prosemirror.js";

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

/** `unconfirmed` — модель не подтвердила, что дописала; `stale` — уехала база
 *  контекста. Два разных вопроса к автору, и потому две разных причины: с
 *  одной он не понимал, что именно ему предлагают переступить. */
export type ProposalConflictReason =
  | "version"
  | "draft"
  | "status"
  | "unconfirmed"
  | "stale";

export class ProposalConflictError extends Error {
  constructor(
    public readonly reason: ProposalConflictReason,
    message: string,
  ) {
    // Причина приписана тегом в конце: текст остаётся русским для автора, а
    // код (и тесты) может опознать причину по message, не заглядывая в reason.
    super(`${message} [${reason}]`);
    this.name = "ProposalConflictError";
  }
}

export interface AcceptOutcome {
  versionId: number;
  /** true — этот requestId уже принимали, версия та же самая. */
  replayed: boolean;
}

/** Сколько принятых repair-версий уже есть в предках. Считается по версиям, а
 *  не по предложениям: отклонённый кандидат итерацию не тратит. */
function countRepairAncestors(sqlite: DatabaseType, versionId: number | null): number {
  let count = 0;
  let cursor = versionId;
  const seen = new Set<number>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const row = sqlite
      .prepare("SELECT parent_version_id, branch_label FROM chapter_versions WHERE id = ?")
      .get(cursor) as
      | { parent_version_id: number | null; branch_label: string | null }
      | undefined;
    if (!row) break;
    if (row.branch_label?.startsWith(REPAIR_BRANCH_PREFIX)) count++;
    cursor = row.parent_version_id;
  }
  return count;
}

export function acceptProposal(
  sqlite: DatabaseType,
  proposalId: number,
  input: AcceptProseProposalInput,
): AcceptOutcome {
  const tx = sqlite.transaction((): AcceptOutcome => {
    const proposal = loadProposal(sqlite, proposalId);
    if (!proposal) throw new ProposalConflictError("status", "предложение не найдено");

    // Идемпотентность по requestId: повтор после сетевого сбоя возвращает уже
    // созданную версию и не порождает второго обновления памяти.
    if (proposal.status === "accepted") {
      if (proposal.acceptRequestId === input.requestId && proposal.acceptedVersionId) {
        return { versionId: proposal.acceptedVersionId, replayed: true };
      }
      throw new ProposalConflictError("status", "предложение уже принято");
    }
    if (proposal.status === "streaming") {
      throw new ProposalConflictError("status", "предложение ещё пишется");
    }
    if (proposal.status !== "ready" && proposal.status !== "incomplete") {
      throw new ProposalConflictError("status", `нельзя принять предложение в статусе ${proposal.status}`);
    }
    // Незавершённый текст можно посмотреть, но нельзя принять как готовую
    // главу молча: обрыв, лимит вывода и молчащий бэкенд — не «дописано».
    if (proposal.completion === "unconfirmed" && !input.acknowledgeUnconfirmed) {
      throw new ProposalConflictError(
        "unconfirmed",
        "завершение не подтверждено: примите осознанно или перезапустите",
      );
    }

    const ch = sqlite
      .prepare("SELECT id, book_id, order_index, current_version_id FROM chapters WHERE id = ?")
      .get(proposal.chapterId) as
      | { id: number; book_id: number; order_index: number; current_version_id: number | null }
      | undefined;
    if (!ch) throw new ProposalConflictError("status", "глава не найдена");
    // INV-11: предложение и глава обязаны принадлежать одной книге.
    if (ch.book_id !== proposal.bookId) {
      throw new ProposalConflictError("status", "предложение из другой книги");
    }

    // CAS по тому, что видел автор. Сравниваем с ожиданиями клиента, а не с
    // базой предложения: автор мог осознанно перечитать изменившуюся главу и
    // принять поверх неё.
    if ((ch.current_version_id ?? null) !== (input.expectedVersionId ?? null)) {
      throw new ProposalConflictError("version", "текущая версия главы изменилась");
    }
    const draft = sqlite
      .prepare("SELECT revision FROM chapter_drafts WHERE chapter_id = ?")
      .get(proposal.chapterId) as { revision: number } | undefined;
    const actualDraftRevision = draft ? draft.revision : null;
    if (actualDraftRevision !== (input.expectedDraftRevision ?? null)) {
      throw new ProposalConflictError("draft", "черновик изменился, пока шла генерация");
    }

    // Отдельная проверка и отдельное согласие: неподтверждённый кандидат
    // раньше проскакивал её молча, а подтверждённый с уехавшей базой было
    // не принять вообще — оба перекоса от одного флага на два вопроса.
    if (
      contextFingerprint(sqlite, proposal.chapterId) !== proposal.contextFingerprint &&
      !input.acknowledgeContextDrift
    ) {
      throw new ProposalConflictError("stale", "база контекста изменилась с начала генерации");
    }

    // Что именно становится текстом версии: весь кандидат или база с
    // выбранными правками. Слияние делает сервер — иначе принятая версия
    // зависела бы от состояния вкладки.
    let contentJson = proposal.contentJson;
    let contentText = proposal.contentText;
    if (input.selectedChangeIds !== undefined) {
      // Пустая глава — пустой список абзацев, а не один пустой абзац: иначе
      // сравнение показало бы автору фантомную правку «убрано ничего».
      const baseNodes = ch.current_version_id
        ? docToNodes(
            JSON.parse(
              (
                sqlite
                  .prepare("SELECT content_json FROM chapter_versions WHERE id = ?")
                  .get(ch.current_version_id) as { content_json: string }
              ).content_json,
            ),
          )
        : [];
      const candidateNodes = docToNodes(JSON.parse(proposal.contentJson));
      // Выбирают по тексту, сливают по узлам: иначе принятие одного абзаца
      // сносило бы жирное, заголовки и списки во всей остальной главе.
      const changes = diffProseBlocks(
        nodesToBlocks(baseNodes),
        nodesToBlocks(candidateNodes),
      );
      const mergedNodes = applyProseChangesToNodes(
        baseNodes,
        candidateNodes,
        changes,
        input.selectedChangeIds,
      );
      const mergedDoc = nodesToDoc(mergedNodes);
      contentJson = JSON.stringify(mergedDoc);
      contentText = extractText(mergedDoc);
    }

    const branchLabel =
      proposal.kind === "repair"
        ? `${REPAIR_BRANCH_PREFIX}${countRepairAncestors(sqlite, ch.current_version_id) + 1}`
        : null;
    const now = new Date().toISOString();
    const info = sqlite
      .prepare(
        `INSERT INTO chapter_versions
           (chapter_id, parent_version_id, content_json, content_text, word_count, source, branch_label, created_at)
         VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)`,
      )
      .run(
        ch.id,
        ch.current_version_id,
        contentJson,
        contentText,
        countWords(contentText),
        branchLabel,
        now,
      );
    const versionId = Number(info.lastInsertRowid);

    sqlite
      .prepare("UPDATE chapters SET current_version_id = ?, updated_at = ? WHERE id = ?")
      .run(versionId, now, ch.id);
    sqlite.prepare("UPDATE books SET updated_at = ? WHERE id = ?").run(now, ch.book_id);
    // ADR 0002: принятие — это и есть осознанный коммит, поэтому задания
    // памяти ставятся здесь и только на итоговый принятый текст.
    enqueueMemoryJobs(sqlite, {
      bookId: ch.book_id,
      chapterId: ch.id,
      chapterVersionId: versionId,
      kinds: COMMIT_JOB_KINDS,
    });
    markMemoryStaleOnCommit(sqlite, ch.book_id, ch.order_index);
    sqlite.prepare("DELETE FROM chapter_drafts WHERE chapter_id = ?").run(ch.id);

    sqlite
      .prepare(
        `UPDATE prose_proposals
         SET status = 'accepted', accepted_version_id = ?, accept_request_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(versionId, input.requestId, now, proposalId);
    // Остальные живые кандидаты этой главы посчитаны от базы, которой больше
    // нет: помечаем, а не оставляем автору выбор из устаревшего.
    sqlite
      .prepare(
        `UPDATE prose_proposals SET status = 'superseded', updated_at = ?
         WHERE chapter_id = ? AND id != ? AND status IN ('ready','incomplete')`,
      )
      .run(now, ch.id, proposalId);

    return { versionId, replayed: false };
  });
  return tx.immediate();
}

export function rejectProposal(sqlite: DatabaseType, proposalId: number): void {
  sqlite
    .prepare(
      `UPDATE prose_proposals SET status = 'rejected', updated_at = ?
       WHERE id = ? AND status IN ('ready','incomplete','cancelled','failed')`,
    )
    .run(new Date().toISOString(), proposalId);
}

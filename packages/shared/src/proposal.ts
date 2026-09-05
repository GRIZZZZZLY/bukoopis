import { z } from "zod";

/** Что предложил агент и что с этим стало.
 *
 *  streaming   — поток идёт, текста ещё нет целиком.
 *  ready       — текст дописан, модель подтвердила завершение.
 *  incomplete  — текст есть, но завершение не подтверждено: упёрлись в лимит
 *                вывода, оборвалось соединение или бэкенд вообще не сообщает
 *                причину остановки. Смотреть можно, считать готовой главой —
 *                нельзя.
 *  cancelled   — автор остановил; поздний ответ ничего не заменяет.
 *  failed      — вызов упал, причина в errorMessage.
 *  accepted    — из него сделана версия (acceptedVersionId).
 *  rejected    — автор отказался.
 *  superseded  — база уехала настолько, что предложение больше не применимо. */
export const PROSE_PROPOSAL_STATUSES = [
  "streaming",
  "ready",
  "incomplete",
  "cancelled",
  "failed",
  "accepted",
  "rejected",
  "superseded",
] as const;
export const proseProposalStatusSchema = z.enum(PROSE_PROPOSAL_STATUSES);
export type ProseProposalStatus = z.infer<typeof proseProposalStatusSchema>;

export const PROPOSAL_KINDS = ["write", "repair"] as const;
export const proposalKindSchema = z.enum(PROPOSAL_KINDS);
export type ProposalKind = z.infer<typeof proposalKindSchema>;

/** Подтверждено ли, что модель дописала до конца. Отделено от статуса
 *  намеренно: отменённый и упавший прогон тоже не подтверждены, но по другой
 *  причине, и в интерфейсе это разные сообщения. */
export const proposalCompletionSchema = z.enum(["confirmed", "unconfirmed"]);
export type ProposalCompletion = z.infer<typeof proposalCompletionSchema>;

export const proseProposalSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  kind: proposalKindSchema,
  status: proseProposalStatusSchema,
  /** Версия главы, от которой считался кандидат; null — глава была пуста. */
  baseVersionId: z.number().int().positive().nullable(),
  /** Ревизия черновика на старте; null — черновика не было вовсе. */
  baseDraftRevision: z.number().int().nonnegative().nullable(),
  /** Отпечаток значимых зависимостей контекста на старте. */
  contextFingerprint: z.string(),
  contentText: z.string(),
  contentJson: z.string(),
  wordCount: z.number().int().nonnegative(),
  completion: proposalCompletionSchema,
  /** Причина остановки от бэкенда; null, если бэкенд её не сообщает. */
  stopReason: z.string().nullable(),
  modelId: z.string().nullable(),
  backend: z.string().nullable(),
  acceptedVersionId: z.number().int().positive().nullable(),
  acceptRequestId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProseProposal = z.infer<typeof proseProposalSchema>;

export const acceptProseProposalInputSchema = z.object({
  /** Идемпотентность: повтор после сетевого сбоя возвращает ту же версию. */
  requestId: z.string().min(1).max(200),
  /** Что клиент считает текущей версией главы; null — глава пуста. */
  expectedVersionId: z.number().int().positive().nullable(),
  /** Что клиент считает ревизией черновика; null — черновика нет. */
  expectedDraftRevision: z.number().int().nonnegative().nullable(),
  /** Не задано — принять кандидата целиком. Задано — только эти правки. */
  selectedChangeIds: z.array(z.string().min(1)).min(1).optional(),
  /** Осознанное принятие текста, чьё завершение не подтверждено: упёрлись в
   *  лимит вывода, оборвалось соединение или бэкенд молчит о причине. */
  acknowledgeUnconfirmed: z.boolean().default(false),
  /** Осознанное принятие кандидата, у которого уехала база контекста: план,
   *  текущая версия или материалы книги изменились, пока модель писала.
   *
   *  Два флага, а не один: это два независимых вопроса, и одна галочка на них
   *  обоих означала, что неподтверждённый кандидат молча проскакивал проверку
   *  контекста, а подтверждённый с уехавшим контекстом было не принять вовсе. */
  acknowledgeContextDrift: z.boolean().default(false),
});
export type AcceptProseProposalInput = z.infer<typeof acceptProseProposalInputSchema>;

export const rejectProseProposalInputSchema = z.object({
  reason: z.string().max(500).optional(),
});

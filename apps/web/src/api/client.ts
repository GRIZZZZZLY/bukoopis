import type {
  AspectVariant,
  Book,
  BookConcept,
  BookNote,
  BookOutline,
  Chapter,
  ChapterDraft,
  ChapterPlan,
  ChapterVersion,
  ChapterWithCurrentVersion,
  Character,
  CharacterKnowledge,
  CharacterVoiceSample,
  CreateBookInput,
  CreateChapterInput,
  CreateCharacterInput,
  CreateCharacterKnowledgeInput,
  CreateHookInput,
  CreateItemInput,
  CreateLocationInput,
  CreateRelationshipInput,
  CreateVoiceSampleInput,
  EntityAlias,
  GenerationConfig,
  Hook,
  IntakeSummaryRow,
  IntakeTarget,
  Item,
  Location,
  PitchMixField,
  Relationship,
  StageId,
  StudioState,
  StudioWarning,
  UpdateBookInput,
  UpdateChapterInput,
  UpdateCharacterInput,
  UpdateHookInput,
  UpdateItemInput,
  UpdateLocationInput,
  UpdateRelationshipInput,
  UpdateVoiceSampleInput,
} from "@book-forge/shared";
import { consumeSse, SSE_BROKEN_MESSAGE } from "./sse";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

// ADR 0002 — computed per-chapter memory state returned by GET /api/chapters/:id.
/** Сколько событий героев легло при активации версии и сколько отброшено. */
export interface AppliedEventCounts {
  inserted: number;
  duplicates: number;
  rejectedEvidence: number;
  unresolved: number;
  /** Имена, не нашедшиеся в составе книги. Нет у версий, разобранных до
   *  выпуска этого поля. */
  unresolvedNames?: string[];
  /** Снято с прежнего разбора этой же версии. Не потеря: заменено новым. */
  superseded?: number;
}

export interface ChapterMemoryInfo {
  state: "fresh" | "updating" | "error" | "none";
  memoryVersionId: number | null;
  /** 1-based position in the book, not order_index — safe to display as-is. */
  bookStaleFromPosition: number | null;
  /** Positions of earlier chapters whose derived memory hasn't landed yet. */
  pendingEarlierChapters: number[];
  /** Версия конвейера, которой разобрана текущая версия главы. */
  pipelineVersion: number | null;
  /** Память числится свежей, но собрана прежней версией конвейера. */
  outdatedPipeline: boolean;
  /** `short` — глава короче 80 слов и не разбиралась вовсе. */
  skipped: string | null;
  events: AppliedEventCounts | null;
  /** Строк ответа модели, которые схема не приняла. */
  malformed: number;
  /** Сколько глав книги ещё разобрано прежней версией конвейера. */
  outdatedPipelineChapters: number;
}
export type ChapterWithMemory = ChapterWithCurrentVersion & {
  memory?: ChapterMemoryInfo;
  draft?: (ChapterDraft & { revision: number }) | null;
};

// ── Intake (Приём материала) ──
/** Файл уже прочитан в текст на стороне браузера (кроме .docx, который едет
 *  как base64 и распаковывается сервером). Общая форма для `intake` и
 *  `intakeStream`, чтобы сигнатуры не разъезжались. */
export interface IntakeFile {
  filename: string;
  content?: string;
  contentBase64?: string;
}

export interface IntakeResponse {
  summary: IntakeSummaryRow[];
  ideaSet: boolean;
  chapters: Array<{ chapterId: number; title: string; words: number }>;
  failures: Array<{ filename: string; message: string }>;
  revision: number;
}

/** Одно из двух событий `file` на файл: `started` перед вызовом классификатора,
 *  `done`/`failed` после. `targets` только на `done`, `message` только на
 *  `failed` — см. `apps/server/src/utils/intake-run.ts`. */
export interface IntakeFileEvent {
  index: number;
  total: number;
  filename: string;
  status: "started" | "done" | "failed";
  targets?: IntakeTarget[];
  message?: string;
}

/** Снимок идущего разбора: то же, что рисует прогресс, но взятое у сервера, а
 *  не накопленное этой вкладкой. */
export interface IntakeInflight {
  requestKey: string;
  total: number;
  /** ISO-время начала — экран показывает, сколько разбор уже идёт. */
  startedAt: string;
  rows: Array<{
    filename: string;
    status: "started" | "done" | "failed";
    targets?: IntakeTarget[];
    message?: string;
  }>;
}

export interface IntakeStreamHandlers {
  onBegin?: (e: { requestKey: string; total: number }) => void;
  onFile?: (e: IntakeFileEvent) => void;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** `details.reason` сервера, если он его назвал. 409 при принятии
     *  кандидата их различает: version, draft, status, unconfirmed, stale — и
     *  каждой полагается свой выход, а не общее «что-то изменилось». */
    public reason?: string,
  ) {
    super(message);
  }
}

/** Тело ошибки сервера — `{error, details:{message, reason}}`; в UI полезен
 *  текст, а не сырой JSON. Не-JSON тела отдаём как есть. */
function errorSummary(body: string): string {
  return parseError(body).summary;
}

function parseError(body: string): { summary: string; reason?: string } {
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      details?: { message?: string; reason?: string };
    };
    const detail = parsed.details?.message;
    const reason = parsed.details?.reason;
    const summary =
      parsed.error && detail
        ? `${parsed.error} — ${detail}`
        : (detail ?? parsed.error ?? body);
    return reason !== undefined ? { summary, reason } : { summary };
  } catch {
    return { summary: body };
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    const { summary, reason } = parseError(text);
    throw new ApiError(res.status, `HTTP ${res.status}: ${summary}`, reason);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listBooks: () => req<Book[]>("/api/books"),
  getBooksStats: () =>
    req<Record<string, { chapters: number; done: number; words: number }>>(
      "/api/books/stats",
    ),
  createBook: (body: CreateBookInput) =>
    req<Book>("/api/books", { method: "POST", body: JSON.stringify(body) }),
  getBook: (id: number) => req<Book>(`/api/books/${id}`),
  updateBook: (id: number, body: UpdateBookInput) =>
    req<Book>(`/api/books/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteBook: (id: number) =>
    req<void>(`/api/books/${id}`, { method: "DELETE" }),

  listChapters: (bookId: number) =>
    req<Chapter[]>(`/api/books/${bookId}/chapters`),
  listBookNotes: (bookId: number) => req<BookNote[]>(`/api/books/${bookId}/notes`),
  createChapter: (bookId: number, body: CreateChapterInput) =>
    req<Chapter>(`/api/books/${bookId}/chapters`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getChapter: (id: number) => req<ChapterWithMemory>(`/api/chapters/${id}`),
  updateChapter: (id: number, body: UpdateChapterInput) =>
    req<Chapter>(`/api/chapters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteChapter: (id: number) =>
    req<void>(`/api/chapters/${id}`, { method: "DELETE" }),
  /** Перестановка глав целиком, одним запросом: сервер переносит вместе с
   *  порядком и производную память — чанки поиска, факты, заметки, образцы
   *  речи (К1). По одной главе порядок больше не меняется. */
  reorderChapters: (bookId: number, chapterIds: number[]) =>
    req<{ moved: number; staleFrom: number | null; chapters: Chapter[] }>(
      `/api/books/${bookId}/chapters/reorder`,
      { method: "POST", body: JSON.stringify({ chapterIds }) },
    ),

  listVersions: (chapterId: number) =>
    req<ChapterVersion[]>(`/api/chapters/${chapterId}/versions`),
  // ADR 0002 (Step 6): createVersion is ALWAYS a deliberate commit (indexes +
  // memory extractors via the durable queue); autosaves go to saveDraft.
  createVersion: (chapterId: number, contentJson: unknown) =>
    req<ChapterVersion>(`/api/chapters/${chapterId}/versions`, {
      method: "POST",
      body: JSON.stringify({ contentJson }),
    }),
  /** `revision` — монотонный CAS-токен черновика. Его возвращает сервер на
   *  каждом автосохранении, и он же требуется при принятии кандидата: без
   *  него вкладка после первого же автосейва отвечала 409 на любое принятие. */
  saveDraft: (chapterId: number, contentJson: unknown) =>
    req<{
      chapterId: number;
      wordCount: number;
      revision: number;
      updatedAt: string;
    }>(
      `/api/chapters/${chapterId}/draft`,
      { method: "PUT", body: JSON.stringify({ contentJson }) },
    ),
  restoreVersion: (chapterId: number, versionId: number) =>
    req<Chapter>(`/api/chapters/${chapterId}/restore/${versionId}`, {
      method: "POST",
    }),

  // ── Memory pipeline (ADR 0002) ──
  retryChapterMemory: (chapterId: number) =>
    req<{ retried: number }>(`/api/chapters/${chapterId}/memory/retry`, {
      method: "POST",
    }),
  rebuildBookMemory: (bookId: number, fromOrder?: number) =>
    req<{ enqueuedChapters: number; fromOrder: number }>(
      `/api/books/${bookId}/memory/rebuild`,
      {
        method: "POST",
        body: JSON.stringify(fromOrder !== undefined ? { fromOrder } : {}),
      },
    ),

  // ── Plot / Writer ──
  generateBookOutline: (bookId: number, config?: GenerationConfig) =>
    req<BookOutline>(`/api/books/${bookId}/outline`, {
      method: "POST",
      body: JSON.stringify({ config }),
    }),
  selectBookOutline: (bookId: number, selectedIndex: number) =>
    req<Book>(`/api/books/${bookId}/outline/select`, {
      method: "POST",
      body: JSON.stringify({ selectedIndex }),
    }),
  approvePlan: (bookId: number) =>
    req<{ created: number; updated: number; chapters: Chapter[] }>(
      `/api/books/${bookId}/plan/approve`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  generateChapterPlan: (
    chapterId: number,
    intent: string,
    config?: GenerationConfig,
  ) =>
    req<ChapterPlan>(`/api/chapters/${chapterId}/plan`, {
      method: "POST",
      body: JSON.stringify({ intent, config }),
    }),
  selectChapterPlan: (chapterId: number, selectedIndex: number) =>
    req<Chapter>(`/api/chapters/${chapterId}/plan/select`, {
      method: "POST",
      body: JSON.stringify({ selectedIndex }),
    }),

  // ── Retrieval / Import / Export ──
  search: (
    bookId: number,
    q: string,
    opts?: { beforeChapter?: number; topK?: number },
  ) => {
    const qs = new URLSearchParams({ q });
    if (opts?.beforeChapter !== undefined)
      qs.set("beforeChapter", String(opts.beforeChapter));
    if (opts?.topK !== undefined) qs.set("topK", String(opts.topK));
    return req<{
      query: string;
      vecEnabled: boolean;
      hits: Array<{
        chunkId: number;
        chapterId: number | null;
        chapterOrder: number | null;
        text: string;
        score: number;
        vecRank: number | null;
        ftsRank: number | null;
        chapter: { id: number; order_index: number; title: string } | null;
      }>;
    }>(`/api/books/${bookId}/search?${qs.toString()}`);
  },
  importBook: (bookId: number, filename: string, content: string) =>
    req<{ created: { chapterId: number; title: string; words: number }[] }>(
      `/api/books/${bookId}/import`,
      {
        method: "POST",
        body: JSON.stringify({ filename, content }),
      },
    ),

  // ── Проверка различий состава (ТЗ 9.1) ──
  getSceneState: (chapterId: number) =>
    req<{
      chapterId: number;
      versionId: number | null;
      state: import("@book-forge/shared").SceneState | null;
      origin: "llm" | "manual" | null;
      updatedAt: string | null;
      /** Правка автора, оставшаяся на прежней версии главы. */
      carry: {
        state: import("@book-forge/shared").SceneState;
        versionId: number;
        updatedAt: string;
      } | null;
    }>(`/api/chapters/${chapterId}/scene-state`),
  saveSceneState: (
    chapterId: number,
    state: import("@book-forge/shared").SceneState,
  ) =>
    req<{ chapterId: number; state: import("@book-forge/shared").SceneState }>(
      `/api/chapters/${chapterId}/scene-state`,
      { method: "PATCH", body: JSON.stringify(state) },
    ),
  recomputeSceneState: (chapterId: number) =>
    req<{ chapterId: number; versionId: number; enqueued: boolean }>(
      `/api/chapters/${chapterId}/scene-state/recompute`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  getCastCheck: (bookId: number) =>
    req<{ report: import("@book-forge/shared").CastCheckReport | null; stale: boolean }>(
      `/api/books/${bookId}/cast-check`,
    ),
  runCastCheck: (bookId: number) =>
    req<{
      report: import("@book-forge/shared").CastCheckReport;
      stale: boolean;
      droppedPairs: number;
    }>(`/api/books/${bookId}/cast-check`, { method: "POST", body: JSON.stringify({}) }),

  // ── Characters ──
  listCharacters: (bookId: number) =>
    req<Character[]>(`/api/books/${bookId}/characters`),
  createCharacter: (bookId: number, body: CreateCharacterInput) =>
    req<Character>(`/api/books/${bookId}/characters`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCharacter: (id: number, body: UpdateCharacterInput) =>
    req<Character>(`/api/characters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  setCharacterPromptVisibility: (id: number, hidden: boolean) =>
    req<Character>(`/api/characters/${id}/prompt-visibility`, {
      method: "PATCH",
      body: JSON.stringify({ hidden }),
    }),
  /** Возвращает, что ушло вместе с героем: события, образцы речи,
   *  отношения, псевдонимы (С10). */
  deleteCharacter: (id: number) =>
    req<{
      deletedEvents: number;
      deletedVoiceSamples: number;
      deletedRelationships: number;
      deletedAliases: number;
    }>(`/api/characters/${id}`, { method: "DELETE" }),
  /** Другие имена героя (прозвища, титулы) — по ним резолвер сводит
   *  разные написания к одному id (ADR 0003). */
  listCharacterAliases: (bookId: number, characterId: number) =>
    req<EntityAlias[]>(
      `/api/books/${bookId}/entities/character/${characterId}/aliases`,
    ),
  addCharacterAlias: (bookId: number, characterId: number, alias: string) =>
    req<EntityAlias[]>(
      `/api/books/${bookId}/entities/character/${characterId}/aliases`,
      { method: "POST", body: JSON.stringify({ alias }) },
    ),
  deleteAlias: (bookId: number, aliasId: number) =>
    req<void>(`/api/books/${bookId}/aliases/${aliasId}`, { method: "DELETE" }),
  listCharacterKnowledge: (id: number) =>
    req<CharacterKnowledge[]>(`/api/characters/${id}/knowledge`),
  addCharacterKnowledge: (
    id: number,
    body: CreateCharacterKnowledgeInput,
  ) =>
    req<CharacterKnowledge>(`/api/characters/${id}/knowledge`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteCharacterKnowledge: (id: number) =>
    req<void>(`/api/character-knowledge/${id}`, { method: "DELETE" }),

  // ── Образцы речи ──
  listVoiceSamples: (characterId: number) =>
    req<CharacterVoiceSample[]>(`/api/characters/${characterId}/voice-samples`),
  createVoiceSample: (characterId: number, body: CreateVoiceSampleInput) =>
    req<CharacterVoiceSample>(`/api/characters/${characterId}/voice-samples`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateVoiceSample: (id: number, body: UpdateVoiceSampleInput) =>
    req<CharacterVoiceSample>(`/api/voice-samples/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteVoiceSample: (id: number) =>
    req<void>(`/api/voice-samples/${id}`, { method: "DELETE" }),

  // ── Locations ──
  listLocations: (bookId: number) =>
    req<Location[]>(`/api/books/${bookId}/locations`),
  createLocation: (bookId: number, body: CreateLocationInput) =>
    req<Location>(`/api/books/${bookId}/locations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateLocation: (id: number, body: UpdateLocationInput) =>
    req<Location>(`/api/locations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteLocation: (id: number) =>
    req<void>(`/api/locations/${id}`, { method: "DELETE" }),

  // ── Items ──
  listItems: (bookId: number) => req<Item[]>(`/api/books/${bookId}/items`),
  createItem: (bookId: number, body: CreateItemInput) =>
    req<Item>(`/api/books/${bookId}/items`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateItem: (id: number, body: UpdateItemInput) =>
    req<Item>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteItem: (id: number) =>
    req<void>(`/api/items/${id}`, { method: "DELETE" }),

  // ── Hooks ──
  listHooks: (bookId: number, status?: string) =>
    req<Hook[]>(
      `/api/books/${bookId}/hooks${status ? `?status=${status}` : ""}`,
    ),
  createHook: (bookId: number, body: CreateHookInput) =>
    req<Hook>(`/api/books/${bookId}/hooks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateHook: (id: number, body: UpdateHookInput) =>
    req<Hook>(`/api/hooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteHook: (id: number) =>
    req<void>(`/api/hooks/${id}`, { method: "DELETE" }),

  // ── Предложения прозы ──
  getProposal: (id: number) =>
    req<import("@book-forge/shared").ProseProposal>(`/api/prose-proposals/${id}`),
  getProposalChanges: (id: number) =>
    req<{
      baseVersionId: number | null;
      changes: import("@book-forge/shared").ProseChange[];
    }>(`/api/prose-proposals/${id}/changes`),
  acceptProposal: (
    id: number,
    body: import("@book-forge/shared").AcceptProseProposalInput,
  ) =>
    req<{ version: ChapterVersion; replayed: boolean }>(
      `/api/prose-proposals/${id}/accept`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  rejectProposal: (id: number) =>
    req<import("@book-forge/shared").ProseProposal>(
      `/api/prose-proposals/${id}/reject`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  cancelProposal: (id: number) =>
    req<{ stopping: boolean }>(`/api/prose-proposals/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  listProposals: (chapterId: number) =>
    req<import("@book-forge/shared").ProseProposal[]>(
      `/api/chapters/${chapterId}/proposals`,
    ),

  // ── Critique ──
  getCritique: (versionId: number) =>
    req<import("@book-forge/shared").CritiqueReport | null>(
      `/api/chapter-versions/${versionId}/critique`,
    ),
  runCritique: (
    versionId: number,
    critics?: import("@book-forge/shared").CriticType[],
  ) =>
    req<import("@book-forge/shared").CritiqueReport>(
      `/api/chapter-versions/${versionId}/critique`,
      {
        method: "POST",
        body: JSON.stringify(critics ? { critics } : {}),
      },
    ),
  deleteCritique: (versionId: number) =>
    req<void>(`/api/chapter-versions/${versionId}/critique`, {
      method: "DELETE",
    }),

  // ── Relationships ──
  listRelationships: (bookId: number) =>
    req<Relationship[]>(`/api/books/${bookId}/relationships`),
  createRelationship: (bookId: number, body: CreateRelationshipInput) =>
    req<Relationship>(`/api/books/${bookId}/relationships`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateRelationship: (id: number, body: UpdateRelationshipInput) =>
    req<Relationship>(`/api/relationships/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteRelationship: (id: number) =>
    req<void>(`/api/relationships/${id}`, { method: "DELETE" }),

  // ── Style profiles ──
  listStyleProfiles: () =>
    req<import("@book-forge/shared").StyleProfile[]>(`/api/style-profiles`),
  createStyleProfile: (
    body: import("@book-forge/shared").CreateStyleProfileInput,
  ) =>
    req<import("@book-forge/shared").StyleProfile>(`/api/style-profiles`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getStyleProfile: (id: number) =>
    req<import("@book-forge/shared").StyleProfile>(
      `/api/style-profiles/${id}`,
    ),
  updateStyleProfile: (
    id: number,
    body: import("@book-forge/shared").UpdateStyleProfileInput,
  ) =>
    req<import("@book-forge/shared").StyleProfile>(
      `/api/style-profiles/${id}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteStyleProfile: (id: number) =>
    req<void>(`/api/style-profiles/${id}`, { method: "DELETE" }),
  listCorpora: (profileId: number) =>
    req<import("@book-forge/shared").ReferenceCorpus[]>(
      `/api/style-profiles/${profileId}/corpora`,
    ),
  uploadCorpus: (
    profileId: number,
    body: import("@book-forge/shared").UploadReferenceCorpusInput,
  ) =>
    req<import("@book-forge/shared").ReferenceCorpus>(
      `/api/style-profiles/${profileId}/corpora`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  deleteCorpus: (profileId: number, corpusId: number) =>
    req<void>(`/api/style-profiles/${profileId}/corpora/${corpusId}`, {
      method: "DELETE",
    }),
  runStyleExtract: (
    profileId: number,
    body?: import("@book-forge/shared").RunExtractInput,
  ) =>
    req<import("@book-forge/shared").StyleProfile>(
      `/api/style-profiles/${profileId}/extract`,
      { method: "POST", body: JSON.stringify(body ?? {}) },
    ),
  createStyleBlend: (
    body: import("@book-forge/shared").CreateStyleBlendInput,
  ) =>
    req<import("@book-forge/shared").StyleProfile>(
      `/api/style-profiles/blend`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  // ── Usage / Health ──
  getUsage: (params?: { bookId?: number; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.bookId !== undefined)
      qs.set("bookId", String(params.bookId));
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return req<import("@book-forge/shared").UsageSummary>(
      `/api/usage${suffix}`,
    );
  },
  getHealth: () =>
    req<{
      status: string;
      timestamp: string;
      db: "ok" | "missing";
      vec: boolean;
      /** Бэкенд у каждого агента свой; подвалу нужны эти двое. */
      backends?: { writer: string; critics: string };
    }>("/api/health"),
  getWritingProgress: (date?: string) =>
    req<{ date: string; wordsAdded: number }>(
      `/api/writing-progress${date ? `?date=${date}` : ""}`,
    ),

  // ── Studio ──
  getConcept: (bookId: number) =>
    req<BookConcept>(`/api/books/${bookId}/concept`),
  patchConcept: (bookId: number, next: BookConcept) =>
    req<BookConcept>(`/api/books/${bookId}/concept`, {
      method: "PATCH",
      body: JSON.stringify(next),
    }),
  getStudioState: (bookId: number) =>
    req<StudioState>(`/api/books/${bookId}/studio-state`),
  patchStudioState: (
    bookId: number,
    expectedRevision: number,
    next: StudioState,
  ) =>
    req<StudioState>(`/api/books/${bookId}/studio-state`, {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision, next }),
    }),
  getStudioWarnings: (bookId: number) =>
    req<StudioWarning[]>(`/api/books/${bookId}/studio-warnings`),
  listRecommended: () =>
    req<Record<number, StageId>>("/api/books/recommended"),
  refineConceptField: (
    bookId: number,
    field: "protagonist" | "conflict" | "stakes" | "logline",
    draft?: string,
  ) =>
    req<{
      variants: Array<{ id: string; label: string; payload: string }>;
    }>(`/api/books/${bookId}/concept/refine`, {
      method: "POST",
      body: JSON.stringify({
        field,
        ...(draft !== undefined ? { draft } : {}),
      }),
    }),
  /** Задумка уже лежит на концепте; сервер дописывает новые питчи к старым. */
  generatePitches: (
    bookId: number,
    body: { direction?: string; count?: number } = {},
  ) =>
    req<{ concept: BookConcept; questions: string[]; newPitchIds: string[] }>(
      `/api/books/${bookId}/concept/pitches`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  blendPitch: (
    bookId: number,
    body: { picks: Partial<Record<PitchMixField, string>>; note?: string },
  ) =>
    req<{ concept: BookConcept; pitchId: string }>(
      `/api/books/${bookId}/concept/pitches/blend`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  /** Без pitchId утверждает текущую премису как есть (старые книги). */
  lockConcept: (bookId: number, pitchId?: string) =>
    req<BookConcept>(`/api/books/${bookId}/concept/lock`, {
      method: "POST",
      body: JSON.stringify(pitchId !== undefined ? { pitchId } : {}),
    }),
  unlockConcept: (bookId: number) =>
    req<BookConcept>(`/api/books/${bookId}/concept/unlock`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  generateStagePlaybook: (
    bookId: number,
    stageId: string,
    existingAspectNames: string[] = [],
  ) =>
    req<{
      aspects: Array<{
        name: string;
        description: string;
        required: boolean;
        /** Сервер отдаёт entity_set для стадий characters/items. */
        payloadKind: "markdown" | "entity_set";
      }>;
      contextRef: {
        hash: string;
        summary: string;
        includedAspectIds: string[];
        includedEntityIds: string[];
      };
    }>(`/api/books/${bookId}/stages/${stageId}/playbook`, {
      method: "POST",
      body: JSON.stringify({ existingAspectNames }),
    }),
  generateAspectVariants: (
    bookId: number,
    stageId: string,
    aspectId: string,
    body: {
      aspect: { id: string; name: string; description?: string };
      accumulated: Array<{ id: string; name: string; finalPayload: string }>;
      draft?: string;
    },
  ) =>
    req<{
      variants: Array<{
        id: string;
        label: string;
        payloadKind: "markdown";
        payload: string;
        status: "generated";
        editSource: "llm";
        generatedAt: string;
        modelId: string;
        contextRef: {
          hash: string;
          summary: string;
          includedAspectIds: string[];
          includedEntityIds: string[];
        };
      }>;
      contextRef: {
        hash: string;
        summary: string;
        includedAspectIds: string[];
        includedEntityIds: string[];
      };
    }>(
      `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/generate`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  refineAspectVariant: (
    bookId: number,
    stageId: string,
    aspectId: string,
    body: {
      aspect: { id: string; name: string; description?: string };
      parentVariant: { id: string; label: string; payload: string };
      instructions: string;
      accumulated: Array<{ name: string; finalPayload: string }>;
    },
  ) =>
    req<{
      variant: {
        id: string;
        label: string;
        payloadKind: "markdown";
        payload: string;
        status: "generated";
        editSource: "refine";
        parentVariantId: string;
        generatedAt: string;
        modelId: string;
        contextRef: {
          hash: string;
          summary: string;
          includedAspectIds: string[];
          includedEntityIds: string[];
        };
      };
      contextRef: {
        hash: string;
        summary: string;
        includedAspectIds: string[];
        includedEntityIds: string[];
      };
    }>(
      `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/refine`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  generateAspectEntityVariants: (
    bookId: number,
    stageId: "characters" | "items",
    aspectId: string,
    body: {
      aspect: { id: string; name: string; description?: string; payloadKind: "entity_set" };
      accumulated: Array<{ id: string; name: string; finalPayload: unknown }>;
    },
  ) =>
    req<{
      variants: Array<{
        id: string;
        label: string;
        payloadKind: "entity_set";
        payload: {
          candidates: Array<{
            tempId: string;
            kind: "character" | "location" | "item";
            profile: unknown;
            status: "proposed";
          }>;
        };
        status: "generated";
        editSource: "llm";
        generatedAt: string;
        modelId: string;
        contextRef: {
          hash: string;
          summary: string;
          includedAspectIds: string[];
          includedEntityIds: string[];
        };
      }>;
      contextRef: {
        hash: string;
        summary: string;
        includedAspectIds: string[];
        includedEntityIds: string[];
      };
    }>(
      `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/generate`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  materializeEntitySet: (
    bookId: number,
    aspectId: string,
    body: {
      stageId: "characters" | "items";
      aspectName: string;
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        profile: unknown;
        materializedEntityId?: number;
        expectedRevision?: number;
        mergedIntoId?: number;
      }>;
    },
  ) =>
    req<{
      aspectId: string;
      createdEntityIds: number[];
      candidates: Array<{
        tempId: string;
        decision: "accept" | "reject";
        materializedEntityId?: number;
        materializedRevision?: number;
        mergedIntoId?: number;
      }>;
    }>(`/api/books/${bookId}/aspects/${aspectId}/materialize`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Сервер решает, что куда положить. Блокирующий вариант — держится, пока
   *  не разберётся всё; `intakeStream` ниже показывает прогресс по файлам. */
  intake: (bookId: number, files: IntakeFile[]) =>
    req<IntakeResponse>(`/api/books/${bookId}/intake`, {
      method: "POST",
      body: JSON.stringify({ files }),
    }),

  /** Тот же приём материалов, но по SSE: `begin` один раз, затем пара
   *  `started`/`done` (или `started`/`failed`) на файл, и одно `done` с
   *  итогом. Собирается тем же способом, что и остальные SSE-потребители в
   *  этом файле (`res.body.getReader()` + `TextDecoder`, блоки по `\n\n`). */
  intakeStream: async (
    bookId: number,
    files: IntakeFile[],
    handlers: IntakeStreamHandlers,
  ): Promise<IntakeResponse & { cancelled: boolean }> => {
    const res = await fetch(`${API_BASE}/api/books/${bookId}/intake-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => res.statusText);
      throw new ApiError(res.status, `HTTP ${res.status}: ${errorSummary(text)}`);
    }
    let result: (IntakeResponse & { cancelled: boolean }) | undefined;
    let failure: ApiError | undefined;
    await consumeSse(
      res.body,
      ({ event, data }) => {
        if (event === "begin")
          handlers.onBegin?.(data as { requestKey: string; total: number });
        else if (event === "file") handlers.onFile?.(data as IntakeFileEvent);
        else if (event === "done") result = data as IntakeResponse & { cancelled: boolean };
        else if (event === "error") {
          failure = new ApiError(
            res.status,
            `HTTP ${res.status}: ${errorSummary(JSON.stringify(data))}`,
          );
        }
      },
      { terminalEvents: ["done", "error"] },
    );
    if (failure) throw failure;
    if (!result) {
      throw new ApiError(res.status, SSE_BROKEN_MESSAGE);
    }
    return result;
  },

  /** Что разбирается для книги прямо сейчас — или `null`, если ничего. SSE-поток
   *  виден только той вкладке, которая его открыла, а разбор живёт в процессе
   *  сервера и переживает обновление страницы; это единственный способ новой
   *  вкладке узнать, что работа идёт, и показать тот же прогресс. 404 —
   *  штатный ответ «ничего не идёт», а не сбой. */
  intakeInflight: async (bookId: number): Promise<IntakeInflight | null> => {
    try {
      return await req<IntakeInflight>(`/api/books/${bookId}/intake/inflight`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  /** Останавливает разбор перед следующим файлом; файл, который уже читается,
   *  дочитывается — сервер не умеет прерывать вызов LLM на середине. 404,
   *  если прогон с таким ключом уже не в реестре (успел закончиться сам). */
  cancelIntake: (bookId: number, requestKey: string) =>
    req<void>(`/api/books/${bookId}/intake/cancel`, {
      method: "POST",
      body: JSON.stringify({ requestKey }),
    }),

  /** Что собирается для книги прямо сейчас — или `null`. Как и у приёма
   *  материала: 404 значит «ничего не идёт». */
  getQuickStartInflight: async (bookId: number): Promise<QuickStartInflight | null> => {
    try {
      return await req<QuickStartInflight>(`/api/books/${bookId}/quick-start/inflight`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },

  /** Останавливает сбор перед следующим этапом; идущий вызов агента
   *  дочитывается — прервать его нечем. */
  cancelQuickStart: (bookId: number) =>
    req<{ stopping: boolean }>(`/api/books/${bookId}/quick-start/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
};

export interface QuickStartInflight {
  total: number;
  startedAt: string;
  rows: Array<{ stageId: string; status: string; message?: string }>;
}

export interface QuickStartStageEvent {
  index: number;
  total: number;
  stageId: string;
  status: "started" | "done" | "skipped" | "failed";
  message?: string;
}

export interface QuickStartStreamHandlers {
  onBegin: (payload: { total: number }) => void;
  onStage: (e: QuickStartStageEvent) => void;
  onDone: (payload: { stages: unknown[]; cancelled: boolean; revision: number }) => void;
  onError: (message: string) => void;
}

/** Разбор потока — как в streamRepair: читаем куски, режем по "\n\n", достаём
 *  event: и data:. Неизвестные события (в том числе `ping`) игнорируем. */
export async function streamQuickStart(
  bookId: number,
  handlers: QuickStartStreamHandlers,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/books/${bookId}/quick-start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    handlers.onError(`HTTP ${res.status}: ${text}`);
    return;
  }
  const { sawTerminal } = await consumeSse(
    res.body,
    ({ event, data }) => {
      if (event === "begin") handlers.onBegin(data as { total: number });
      else if (event === "stage") handlers.onStage(data as QuickStartStageEvent);
      else if (event === "done")
        handlers.onDone(data as { stages: unknown[]; cancelled: boolean; revision: number });
      else if (event === "error")
        handlers.onError(
          (data as { details?: { message?: string } }).details?.message ?? "сбор не удался",
        );
    },
    { terminalEvents: ["done", "error"] },
  );
  if (!sawTerminal) handlers.onError(SSE_BROKEN_MESSAGE);
}

export function exportBookUrl(bookId: number, format: "md" | "epub"): string {
  return `${API_BASE}/api/books/${bookId}/export.${format}`;
}

// ── SSE inline command streaming ──
export interface InlineStreamHandlers {
  onChunk: (text: string) => void;
  onDone: (payload: {
    text: string;
    tokens: { input: number; output: number };
  }) => void;
  onError: (message: string) => void;
}

export interface InlineCommandRequest {
  command: import("@book-forge/shared").InlineCommand;
  selectionText: string | null;
  beforeText: string;
  afterText: string;
  guidance?: string | null;
  sense?: import("@book-forge/shared").SenseChannel;
}

export async function streamInlineCommand(
  chapterId: number,
  req: InlineCommandRequest,
  handlers: InlineStreamHandlers,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/chapters/${chapterId}/inline`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
  );
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    handlers.onError(`HTTP ${res.status}: ${text}`);
    return;
  }
  const { sawTerminal } = await consumeSse(
    res.body,
    ({ event, data }) => {
      if (event === "chunk") handlers.onChunk((data as { text: string }).text);
      else if (event === "done")
        handlers.onDone(data as { text: string; tokens: { input: number; output: number } });
      else if (event === "error") handlers.onError((data as { message: string }).message);
    },
    { terminalEvents: ["done", "error"] },
  );
  if (!sawTerminal) handlers.onError(SSE_BROKEN_MESSAGE);
}

// ── SSE entity-variants streaming ──
/** Фазы приходят с сервера (utils/generation-progress.ts). `pct` внутри фазы
 *  ожидания — оценка по времени, не реальный прогресс токенов. */
export interface AspectGenerationProgress {
  phase:
    | "context"
    | "dispatch"
    | "model"
    | "writing"
    | "submitting"
    | "validating"
    | "done";
  pct: number;
  attempt: number;
  maxAttempts: number;
  /** Общее время с начала запроса, включая провалившиеся попытки. */
  elapsedMs: number;
  /** Время с начала текущей попытки — к нему привязан pct. */
  attemptElapsedMs: number;
  /** Бюджет одной попытки (LLM_TIMEOUT_MS); 0 — таймаут выключен. */
  attemptTimeoutMs: number;
  estimateMs: number;
}

export interface AspectStreamHandlers<TDone> {
  onProgress: (p: AspectGenerationProgress) => void;
  onDone: (payload: TDone) => void;
  onError: (message: string) => void;
}

/** POST → SSE со схемой `progress` / `done` / `error` (см.
 *  server utils/sse-progress.ts). Один парсер на все аспектные вызовы. */
async function postAspectStream<TDone>(
  path: string,
  body: unknown,
  handlers: AspectStreamHandlers<TDone>,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    handlers.onError(`HTTP ${res.status}: ${errorSummary(text)}`);
    return;
  }
  const { sawTerminal } = await consumeSse(
    res.body,
    ({ event, data }) => {
      if (event === "progress") handlers.onProgress(data as AspectGenerationProgress);
      else if (event === "done") handlers.onDone(data as TDone);
      else if (event === "error") handlers.onError((data as { message: string }).message);
    },
    { terminalEvents: ["done", "error"] },
  );
  if (!sawTerminal) handlers.onError(SSE_BROKEN_MESSAGE);
}

export function streamAspectEntityVariants(
  bookId: number,
  stageId: "characters" | "items",
  aspectId: string,
  body: {
    aspect: {
      id: string;
      name: string;
      description?: string;
      payloadKind: "entity_set";
    };
    accumulated: Array<{ id: string; name: string; finalPayload: unknown }>;
  },
  handlers: AspectStreamHandlers<{ variants: AspectVariant[] }>,
): Promise<void> {
  return postAspectStream(
    `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/generate-stream`,
    body,
    handlers,
  );
}

export function streamAspectVariants(
  bookId: number,
  stageId: string,
  aspectId: string,
  body: {
    aspect: { id: string; name: string; description?: string };
    accumulated: Array<{ id: string; name: string; finalPayload: string }>;
    draft?: string;
  },
  handlers: AspectStreamHandlers<{ variants: AspectVariant[] }>,
): Promise<void> {
  return postAspectStream(
    `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/generate-stream`,
    body,
    handlers,
  );
}

export function streamAspectRefine(
  bookId: number,
  stageId: string,
  aspectId: string,
  body: {
    aspect: { id: string; name: string; description?: string };
    parentVariant: { id: string; label: string; payload: string };
    instructions: string;
    accumulated: Array<{ name: string; finalPayload: string }>;
  },
  handlers: AspectStreamHandlers<{ variant: AspectVariant }>,
): Promise<void> {
  return postAspectStream(
    `/api/books/${bookId}/stages/${stageId}/aspects/${aspectId}/refine-stream`,
    body,
    handlers,
  );
}

export function streamStagePlaybook(
  bookId: number,
  stageId: string,
  existingAspectNames: string[],
  handlers: AspectStreamHandlers<{
    aspects: Array<{
      name: string;
      description: string;
      required: boolean;
      payloadKind: "markdown" | "entity_set";
    }>;
  }>,
): Promise<void> {
  return postAspectStream(
    `/api/books/${bookId}/stages/${stageId}/playbook-stream`,
    { existingAspectNames },
    handlers,
  );
}

// ── SSE repair streaming ──
export interface RepairStreamHandlers {
  onIteration?: (current: number, max: number) => void;
  onProposal?: (proposalId: number) => void;
  onChunk: (text: string) => void;
  onDone: (payload: {
    proposal: import("@book-forge/shared").ProseProposal;
    cancelled?: boolean;
    tokens?: { input: number; output: number };
    /** Защищённые фрагменты, которых правка не сберегла (сервер их находит
     *  в готовом тексте до отправки события). */
    protectedLost?: string[];
  }) => void;
  onError: (message: string) => void;
}

export interface RepairOptions {
  severities?: import("@book-forge/shared").IssueSeverity[];
  /** Только эти замечания (этап 5). Сильнее фильтра по серьёзности. */
  selectedIssueIds?: string[];
  /** Куски, которых правка не касается. Сервер проверит их до вызова модели. */
  protectedFragments?: string[];
}

export async function streamRepair(
  versionId: number,
  options: RepairOptions | undefined,
  handlers: RepairStreamHandlers,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (options?.severities) body.severities = options.severities;
  if (options?.selectedIssueIds?.length) body.selectedIssueIds = options.selectedIssueIds;
  if (options?.protectedFragments?.length) {
    body.protectedFragments = options.protectedFragments;
  }
  const res = await fetch(
    `${API_BASE}/api/chapter-versions/${versionId}/repair`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    handlers.onError(`HTTP ${res.status}: ${text}`);
    return;
  }
  const { sawTerminal } = await consumeSse(
    res.body,
    ({ event, data }) => {
      const d = data as Record<string, unknown>;
      if (event === "iteration")
        handlers.onIteration?.(d.current as number, d.max as number);
      else if (event === "proposal") handlers.onProposal?.(d.proposalId as number);
      else if (event === "chunk") handlers.onChunk(d.text as string);
      else if (event === "done")
        handlers.onDone(data as Parameters<RepairStreamHandlers["onDone"]>[0]);
      else if (event === "error") handlers.onError(d.message as string);
    },
    { terminalEvents: ["done", "error"] },
  );
  if (!sawTerminal) handlers.onError(SSE_BROKEN_MESSAGE);
}

// ── SSE writer streaming ──
export interface SceneIntentStatus {
  /** Замысел собран и ушёл в промпт. */
  prepared: boolean;
  /** Подготовка не удалась: Писатель работает по тому же снимку без неё. */
  degraded: boolean;
  /** Ссылок на события, которых нет в снимке (модель их выдумала). */
  droppedEventIds: number;
}

export interface WriterStreamHandlers {
  onProposal?: (proposalId: number) => void;
  /** Подготовка сцены (этап 5). Деградацию видно автору, а не только в логе. */
  onSceneIntent?: (status: SceneIntentStatus) => void;
  onChunk: (text: string) => void;
  onDone: (payload: {
    proposal: import("@book-forge/shared").ProseProposal;
    cancelled?: boolean;
    tokens?: { input: number; output: number };
  }) => void;
  onError: (message: string) => void;
  onAbort?: () => void;
}

export async function streamWriteChapter(
  chapterId: number,
  config: GenerationConfig | undefined,
  handlers: WriterStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chapters/${chapterId}/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      handlers.onAbort?.();
      return;
    }
    handlers.onError(err instanceof Error ? err.message : String(err));
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    handlers.onError(`HTTP ${res.status}: ${text}`);
    return;
  }
  try {
    const { sawTerminal } = await consumeSse(
      res.body,
      ({ event, data }) => {
        const d = data as Record<string, unknown>;
        if (event === "proposal") handlers.onProposal?.(d.proposalId as number);
        else if (event === "scene_intent")
          handlers.onSceneIntent?.(data as unknown as SceneIntentStatus);
        else if (event === "chunk") handlers.onChunk(d.text as string);
        else if (event === "done")
          handlers.onDone(data as Parameters<WriterStreamHandlers["onDone"]>[0]);
        else if (event === "error") handlers.onError(d.message as string);
      },
      { terminalEvents: ["done", "error"] },
    );
    // Обрыв без `done`/`error` — самый частый способ подвесить экран:
    // кнопка Писателя не отпускалась, и кандидат оставался «пишется»
    // навсегда (В9). Отмена автором сюда не попадает: она приходит
    // исключением по сигналу.
    if (!sawTerminal && !signal?.aborted) handlers.onError(SSE_BROKEN_MESSAGE);
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      handlers.onAbort?.();
      return;
    }
    handlers.onError(err instanceof Error ? err.message : String(err));
  }
}

// ── Canon extraction ──
export interface CanonCandidateBase {
  id: string;
  status: "new" | "existing" | "ambiguous";
  existingId: number | null;
  quote: string;
  mentionCount: number;
  decision: "pending" | "accepted" | "rejected" | "merged";
  decidedExistingId?: number | null;
}

export interface CanonCharacterCandidate extends CanonCandidateBase {
  name: string;
  profile: string | null;
}

export interface CanonLocationCandidate extends CanonCandidateBase {
  name: string;
  profile: string | null;
}

export interface CanonItemCandidate extends CanonCandidateBase {
  name: string;
  profile: string | null;
}

export interface CanonHookCandidate extends CanonCandidateBase {
  description: string;
  type: "opened" | "closed" | "continued";
}

export interface CanonRelationshipCandidate extends CanonCandidateBase {
  fromName: string;
  toName: string;
  type: string;
  tension: number;
}

export type CanonEntityKind =
  | "character"
  | "location"
  | "item"
  | "hook"
  | "relationship";

export interface CanonExtraction {
  id: number;
  chapterId: number;
  status: "pending" | "ready" | "error";
  errorMessage: string | null;
  costUsd: number;
  tokens: { input: number; output: number };
  createdAt: string;
  characters: CanonCharacterCandidate[];
  locations: CanonLocationCandidate[];
  items: CanonItemCandidate[];
  hooks: CanonHookCandidate[];
  relationships: CanonRelationshipCandidate[];
}

export interface ChapterCanonEntry {
  type: CanonEntityKind;
  entityId: number;
  name: string;
  mentionCount: number;
  quote: string | null;
}

export const canonApi = {
  extract: (chapterId: number) =>
    req<CanonExtraction>(
      `/api/chapters/${chapterId}/extract-canon`,
      { method: "POST" },
    ),
  get: (chapterId: number) =>
    req<CanonExtraction | null>(
      `/api/chapters/${chapterId}/canon-extractions`,
    ),
  accept: (
    chapterId: number,
    candidateId: string,
    body: { kind: CanonEntityKind },
  ) =>
    req<CanonExtraction>(
      `/api/chapters/${chapterId}/canon-extractions/${candidateId}/accept`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  reject: (
    chapterId: number,
    candidateId: string,
    body: { kind: CanonEntityKind },
  ) =>
    req<CanonExtraction>(
      `/api/chapters/${chapterId}/canon-extractions/${candidateId}/reject`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  merge: (
    chapterId: number,
    candidateId: string,
    body: { kind: CanonEntityKind; targetId: number },
  ) =>
    req<CanonExtraction>(
      `/api/chapters/${chapterId}/canon-extractions/${candidateId}/merge`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  acceptAll: (chapterId: number) =>
    req<CanonExtraction>(
      `/api/chapters/${chapterId}/canon-extractions/accept-all`,
      { method: "POST" },
    ),
  undo: (
    chapterId: number,
    candidateId: string,
    body: { kind: CanonEntityKind },
  ) =>
    req<CanonExtraction>(
      `/api/chapters/${chapterId}/canon-extractions/${candidateId}/undo`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  list: (chapterId: number) =>
    req<ChapterCanonEntry[]>(`/api/chapters/${chapterId}/canon`),
};

export { ApiError };

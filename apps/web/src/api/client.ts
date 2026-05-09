import type {
  Book,
  BookConcept,
  BookOutline,
  Chapter,
  ChapterPlan,
  ChapterVersion,
  ChapterWithCurrentVersion,
  Character,
  CharacterKnowledge,
  CreateBookInput,
  CreateChapterInput,
  CreateCharacterInput,
  CreateCharacterKnowledgeInput,
  CreateHookInput,
  CreateItemInput,
  CreateLocationInput,
  CreateRelationshipInput,
  GenerationConfig,
  Hook,
  Item,
  Location,
  Relationship,
  StudioState,
  StudioWarning,
  UpdateBookInput,
  UpdateChapterInput,
  UpdateCharacterInput,
  UpdateHookInput,
  UpdateItemInput,
  UpdateLocationInput,
  UpdateRelationshipInput,
} from "@book-forge/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
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
    throw new ApiError(res.status, `HTTP ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listBooks: () => req<Book[]>("/api/books"),
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
  createChapter: (bookId: number, body: CreateChapterInput) =>
    req<Chapter>(`/api/books/${bookId}/chapters`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getChapter: (id: number) =>
    req<ChapterWithCurrentVersion>(`/api/chapters/${id}`),
  updateChapter: (id: number, body: UpdateChapterInput) =>
    req<Chapter>(`/api/chapters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteChapter: (id: number) =>
    req<void>(`/api/chapters/${id}`, { method: "DELETE" }),

  listVersions: (chapterId: number) =>
    req<ChapterVersion[]>(`/api/chapters/${chapterId}/versions`),
  createVersion: (chapterId: number, contentJson: unknown) =>
    req<ChapterVersion>(`/api/chapters/${chapterId}/versions`, {
      method: "POST",
      body: JSON.stringify({ contentJson }),
    }),
  restoreVersion: (chapterId: number, versionId: number) =>
    req<Chapter>(`/api/chapters/${chapterId}/restore/${versionId}`, {
      method: "POST",
    }),

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
  deleteCharacter: (id: number) =>
    req<void>(`/api/characters/${id}`, { method: "DELETE" }),
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
    }>("/api/health"),

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
        payloadKind: "markdown";
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
        mergedIntoId?: number;
      }>;
    }>(`/api/books/${bookId}/aspects/${aspectId}/materialize`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

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
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const evMatch = raw.match(/^event: (.+)$/m);
      const dataMatch = raw.match(/^data: (.+)$/m);
      if (!dataMatch) continue;
      const ev = evMatch?.[1] ?? "message";
      try {
        const data = JSON.parse(dataMatch[1]!);
        if (ev === "chunk") handlers.onChunk(data.text as string);
        else if (ev === "done") handlers.onDone(data);
        else if (ev === "error") handlers.onError(data.message as string);
      } catch {
        /* ignore */
      }
    }
  }
}

// ── SSE repair streaming ──
export interface RepairStreamHandlers {
  onIteration?: (current: number, max: number) => void;
  onChunk: (text: string) => void;
  onDone: (payload: {
    version: ChapterVersion | null;
    iteration: number;
    tokens: { input: number; output: number };
  }) => void;
  onError: (message: string) => void;
}

export async function streamRepair(
  versionId: number,
  severities: import("@book-forge/shared").IssueSeverity[] | undefined,
  handlers: RepairStreamHandlers,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/chapter-versions/${versionId}/repair`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(severities ? { severities } : {}),
    },
  );
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    handlers.onError(`HTTP ${res.status}: ${text}`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx;
    while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const evMatch = raw.match(/^event: (.+)$/m);
      const dataMatch = raw.match(/^data: (.+)$/m);
      if (!dataMatch) continue;
      const ev = evMatch?.[1] ?? "message";
      try {
        const data = JSON.parse(dataMatch[1]!);
        if (ev === "iteration")
          handlers.onIteration?.(data.current as number, data.max as number);
        else if (ev === "chunk") handlers.onChunk(data.text as string);
        else if (ev === "done") handlers.onDone(data);
        else if (ev === "error") handlers.onError(data.message as string);
      } catch {
        /* ignore malformed event */
      }
    }
  }
}

// ── SSE writer streaming ──
export interface WriterStreamHandlers {
  onChunk: (text: string) => void;
  onDone: (payload: {
    version: ChapterVersion;
    tokens: { input: number; output: number };
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
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIdx;
      while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const evMatch = raw.match(/^event: (.+)$/m);
        const dataMatch = raw.match(/^data: (.+)$/m);
        if (!dataMatch) continue;
        const ev = evMatch?.[1] ?? "message";
        try {
          const data = JSON.parse(dataMatch[1]!);
          if (ev === "chunk") handlers.onChunk(data.text as string);
          else if (ev === "done") handlers.onDone(data);
          else if (ev === "error") handlers.onError(data.message as string);
        } catch {
          /* ignore malformed event */
        }
      }
    }
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

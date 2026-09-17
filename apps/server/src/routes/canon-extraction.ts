import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  extractCanon,
  type CanonExtractionResult,
  type CharacterCandidate,
  type LocationCandidate,
  type ItemCandidate,
  type HookCandidate,
  type RelationshipCandidate,
  type ExistingCanon,
} from "@book-forge/agents";
import { logUsage } from "../utils/usageLogger.js";
import { notFound, badRequest } from "../utils/errors.js";
import { recordProfileVersion } from "../utils/entity-revisions.js";

type EntityKind = "character" | "location" | "item" | "hook" | "relationship";

interface StoredCharacterCandidate extends CharacterCandidate {
  id: string;
  decision: Decision;
  decidedExistingId: number | null;
}
interface StoredLocationCandidate extends LocationCandidate {
  id: string;
  decision: Decision;
  decidedExistingId: number | null;
}
interface StoredItemCandidate extends ItemCandidate {
  id: string;
  decision: Decision;
  decidedExistingId: number | null;
}
interface StoredHookCandidate extends HookCandidate {
  id: string;
  decision: Decision;
  decidedExistingId: number | null;
}
interface StoredRelationshipCandidate extends RelationshipCandidate {
  id: string;
  decision: Decision;
  decidedExistingId: number | null;
}

type Decision = "pending" | "accepted" | "rejected" | "merged";

interface StoredPayload {
  characters: StoredCharacterCandidate[];
  locations: StoredLocationCandidate[];
  items: StoredItemCandidate[];
  hooks: StoredHookCandidate[];
  relationships: StoredRelationshipCandidate[];
  notes: string | null;
}

interface ExtractionRow {
  id: number;
  chapter_id: number;
  version_id: number | null;
  status: "pending" | "ready" | "error";
  payload_json: string;
  error_message: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  updated_at: string;
}

interface ExtractionResponse {
  id: number;
  chapterId: number;
  status: "pending" | "ready" | "error";
  errorMessage: string | null;
  costUsd: number;
  tokens: { input: number; output: number };
  createdAt: string;
  characters: StoredCharacterCandidate[];
  locations: StoredLocationCandidate[];
  items: StoredItemCandidate[];
  hooks: StoredHookCandidate[];
  relationships: StoredRelationshipCandidate[];
}

function emptyPayload(): StoredPayload {
  return {
    characters: [],
    locations: [],
    items: [],
    hooks: [],
    relationships: [],
    notes: null,
  };
}

function toStored(result: CanonExtractionResult): StoredPayload {
  const wrap = <T>(arr: T[], kind: EntityKind) =>
    arr.map((c, i) => ({
      ...c,
      id: `${kind}:${i}`,
      decision: "pending" as const,
      decidedExistingId: null,
    }));
  return {
    characters: wrap(result.characters, "character") as StoredCharacterCandidate[],
    locations: wrap(result.locations, "location") as StoredLocationCandidate[],
    items: wrap(result.items, "item") as StoredItemCandidate[],
    hooks: wrap(result.hooks, "hook") as StoredHookCandidate[],
    relationships: wrap(
      result.relationships,
      "relationship",
    ) as StoredRelationshipCandidate[],
    notes: result.notes ?? null,
  };
}

function rowToResponse(row: ExtractionRow): ExtractionResponse {
  let payload: StoredPayload;
  try {
    payload = JSON.parse(row.payload_json) as StoredPayload;
  } catch {
    payload = emptyPayload();
  }
  return {
    id: row.id,
    chapterId: row.chapter_id,
    status: row.status,
    errorMessage: row.error_message,
    costUsd: row.cost_usd,
    tokens: { input: row.input_tokens, output: row.output_tokens },
    createdAt: row.created_at,
    characters: payload.characters ?? [],
    locations: payload.locations ?? [],
    items: payload.items ?? [],
    hooks: payload.hooks ?? [],
    relationships: payload.relationships ?? [],
  };
}

function loadExistingCanon(
  sqlite: DatabaseType,
  bookId: number,
): ExistingCanon {
  const characters = sqlite
    .prepare(
      "SELECT id, canonical_name, profile_json FROM characters WHERE book_id = ?",
    )
    .all(bookId) as Array<{
    id: number;
    canonical_name: string;
    profile_json: string;
  }>;
  const locations = sqlite
    .prepare(
      "SELECT id, name, profile_json FROM locations WHERE book_id = ?",
    )
    .all(bookId) as Array<{
    id: number;
    name: string;
    profile_json: string;
  }>;
  const items = sqlite
    .prepare("SELECT id, name, profile_json FROM items WHERE book_id = ?")
    .all(bookId) as Array<{
    id: number;
    name: string;
    profile_json: string;
  }>;
  const hooks = sqlite
    .prepare(
      "SELECT id, description, status FROM hooks WHERE book_id = ? AND status != 'resolved'",
    )
    .all(bookId) as Array<{
    id: number;
    description: string;
    status: string;
  }>;

  const parseDesc = (json: string): string => {
    try {
      const obj = JSON.parse(json) as { description?: string };
      return obj.description ?? "";
    } catch {
      return "";
    }
  };

  return {
    characters: characters.map((c) => ({
      id: c.id,
      name: c.canonical_name,
      description: parseDesc(c.profile_json),
    })),
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      description: parseDesc(l.profile_json),
    })),
    items: items.map((it) => ({
      id: it.id,
      name: it.name,
      description: parseDesc(it.profile_json),
    })),
    hooks: hooks.map((h) => ({
      id: h.id,
      description: h.description,
      status: h.status,
    })),
  };
}

interface ChapterContext {
  id: number;
  bookId: number;
  title: string;
  versionId: number | null;
  text: string;
  language: string;
}

function loadChapterContext(
  sqlite: DatabaseType,
  chapterId: number,
): ChapterContext | null {
  const ch = sqlite
    .prepare(
      `SELECT c.id, c.book_id, c.title, c.current_version_id, b.language
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`,
    )
    .get(chapterId) as
    | {
        id: number;
        book_id: number;
        title: string;
        current_version_id: number | null;
        language: string;
      }
    | undefined;
  if (!ch) return null;
  let text = "";
  if (ch.current_version_id !== null) {
    const v = sqlite
      .prepare("SELECT content_text FROM chapter_versions WHERE id = ?")
      .get(ch.current_version_id) as
      | { content_text: string }
      | undefined;
    text = v?.content_text ?? "";
  }
  return {
    id: ch.id,
    bookId: ch.book_id,
    title: ch.title,
    versionId: ch.current_version_id,
    text,
    language: ch.language,
  };
}

interface BookModelContext {
  criticModel: "sonnet" | "opus";
}

function loadBookModelContext(
  sqlite: DatabaseType,
  bookId: number,
): BookModelContext {
  const row = sqlite
    .prepare("SELECT critic_model FROM books WHERE id = ?")
    .get(bookId) as { critic_model: "sonnet" | "opus" } | undefined;
  return { criticModel: row?.critic_model ?? "sonnet" };
}

function approxCostUsd(input: number, output: number): number {
  // Sonnet 4.6: $3/M input, $15/M output. Cheap heuristic — accurate logging
  // happens via logUsage which uses real pricing module.
  return (input * 3 + output * 15) / 1_000_000;
}

/**
 * Run canon extractor for a chapter and persist the snapshot.
 * Idempotent: replaces any prior extraction for the chapter.
 */
export async function runAndPersistExtraction(
  sqlite: DatabaseType,
  chapterId: number,
): Promise<ExtractionResponse> {
  const ctx = loadChapterContext(sqlite, chapterId);
  if (!ctx) throw new Error("chapter not found");
  if (!ctx.text || ctx.text.trim().length < 20) {
    throw new Error("chapter has no substantial text yet");
  }
  const existing = loadExistingCanon(sqlite, ctx.bookId);
  const models = loadBookModelContext(sqlite, ctx.bookId);

  const now = new Date().toISOString();
  // Replace strategy: drop any prior snapshot for this chapter, then create a
  // fresh "pending" row so the frontend can poll for "ready".
  sqlite
    .prepare("DELETE FROM chapter_canon_extractions WHERE chapter_id = ?")
    .run(chapterId);
  const insert = sqlite
    .prepare(
      `INSERT INTO chapter_canon_extractions
       (chapter_id, version_id, status, payload_json, cost_usd, input_tokens, output_tokens, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, 0, 0, 0, ?, ?)`,
    )
    .run(
      chapterId,
      ctx.versionId,
      JSON.stringify(emptyPayload()),
      now,
      now,
    );
  const id = Number(insert.lastInsertRowid);

  let modelId = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;

  try {
    const result = await extractCanon({
      chapterTitle: ctx.title,
      chapterText: ctx.text,
      existingCanon: existing,
      model: models.criticModel,
      onUsage: (usage) => {
        modelId = usage.modelId;
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
        cacheCreationTokens = usage.cacheCreationInputTokens;
        cacheReadTokens = usage.cacheReadInputTokens;
      },
    });

    const stored = toStored(result);
    const cost = approxCostUsd(inputTokens, outputTokens);
    const finishedAt = new Date().toISOString();
    sqlite
      .prepare(
        `UPDATE chapter_canon_extractions
         SET status='ready', payload_json=?, cost_usd=?, input_tokens=?, output_tokens=?, updated_at=?
         WHERE id=?`,
      )
      .run(
        JSON.stringify(stored),
        cost,
        inputTokens,
        outputTokens,
        finishedAt,
        id,
      );
    logUsage(sqlite, {
      route: "canon.extract",
      model: modelId,
      usage: {
        inputTokens,
        outputTokens,
        cacheCreationInputTokens: cacheCreationTokens,
        cacheReadInputTokens: cacheReadTokens,
      },
      bookId: ctx.bookId,
      chapterId: ctx.id,
      versionId: ctx.versionId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sqlite
      .prepare(
        `UPDATE chapter_canon_extractions
         SET status='error', error_message=?, updated_at=?
         WHERE id=?`,
      )
      .run(msg, new Date().toISOString(), id);
  }

  const row = sqlite
    .prepare("SELECT * FROM chapter_canon_extractions WHERE id = ?")
    .get(id) as ExtractionRow;
  return rowToResponse(row);
}

/**
 * Helper used by the writer route to fire-and-forget canon extraction.
 * Errors are caught and logged; never thrown.
 */
export async function triggerCanonExtractionAfterWriter(
  sqlite: DatabaseType,
  chapterId: number,
): Promise<void> {
  try {
    await runAndPersistExtraction(sqlite, chapterId);
  } catch (e) {
    console.warn(
      "[canon-extractor] background extraction failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

// ─────────────── helpers for accept/merge ───────────────

function findCandidate(
  payload: StoredPayload,
  candidateId: string,
):
  | { kind: EntityKind; candidate: StoredPayload[keyof StoredPayload] extends Array<infer U> ? U : never }
  | null {
  const [kind] = candidateId.split(":");
  if (!kind) return null;
  const arrMap: Record<string, unknown[]> = {
    character: payload.characters,
    location: payload.locations,
    item: payload.items,
    hook: payload.hooks,
    relationship: payload.relationships,
  };
  const arr = arrMap[kind];
  if (!arr) return null;
  const candidate = (arr as Array<{ id: string }>).find(
    (c) => c.id === candidateId,
  );
  if (!candidate) return null;
  return { kind: kind as EntityKind, candidate: candidate as never };
}

function recordMention(
  sqlite: DatabaseType,
  args: {
    entityType: EntityKind;
    entityId: number;
    bookId: number;
    chapterId: number;
    mentionCount: number;
    quote: string;
  },
): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO entity_chapter_mentions
       (entity_type, entity_id, book_id, chapter_id, mention_count, quote, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id, chapter_id) DO UPDATE SET
         mention_count = excluded.mention_count,
         quote = COALESCE(excluded.quote, entity_chapter_mentions.quote)`,
    )
    .run(
      args.entityType,
      args.entityId,
      args.bookId,
      args.chapterId,
      args.mentionCount,
      args.quote,
      now,
    );
}

function createCharacterFromCandidate(
  sqlite: DatabaseType,
  bookId: number,
  c: StoredCharacterCandidate,
): number {
  const now = new Date().toISOString();
  const profile = JSON.stringify({
    description: c.profile ?? c.name,
  });
  const tx = sqlite.transaction(() => {
    const info = sqlite
      .prepare(
        `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(bookId, c.name, profile, now, now);
    const characterId = Number(info.lastInsertRowid);
    recordProfileVersion(sqlite, {
      bookId,
      entityType: "character",
      entityId: characterId,
      revision: 0,
      profileJson: profile,
      origin: "llm",
    });
    return characterId;
  });
  return tx.immediate();
}

function createLocationFromCandidate(
  sqlite: DatabaseType,
  bookId: number,
  c: StoredLocationCandidate,
): number {
  const now = new Date().toISOString();
  const profile = JSON.stringify({ description: c.profile ?? c.name });
  const info = sqlite
    .prepare(
      `INSERT INTO locations (book_id, name, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bookId, c.name, profile, now, now);
  return Number(info.lastInsertRowid);
}

function createItemFromCandidate(
  sqlite: DatabaseType,
  bookId: number,
  c: StoredItemCandidate,
): number {
  const now = new Date().toISOString();
  const profile = JSON.stringify({ description: c.profile ?? c.name });
  const info = sqlite
    .prepare(
      `INSERT INTO items (book_id, name, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(bookId, c.name, profile, now, now);
  return Number(info.lastInsertRowid);
}

function createHookFromCandidate(
  sqlite: DatabaseType,
  bookId: number,
  chapterId: number,
  c: StoredHookCandidate,
): number {
  const now = new Date().toISOString();
  const status =
    c.type === "closed" ? "resolved" : c.type === "continued" ? "mentioned" : "open";
  const info = sqlite
    .prepare(
      `INSERT INTO hooks (book_id, seed_chapter_id, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(bookId, chapterId, c.description, status, now, now);
  return Number(info.lastInsertRowid);
}

function createRelationshipFromCandidate(
  sqlite: DatabaseType,
  bookId: number,
  c: StoredRelationshipCandidate,
): number {
  const lookup = sqlite.prepare(
    "SELECT id FROM characters WHERE book_id = ? AND canonical_name = ? LIMIT 1",
  );
  const fromRow = lookup.get(bookId, c.fromName) as { id: number } | undefined;
  const toRow = lookup.get(bookId, c.toName) as { id: number } | undefined;
  if (!fromRow) {
    throw new Error(
      `relationship accept: character "${c.fromName}" not found in book — accept the character candidate first`,
    );
  }
  if (!toRow) {
    throw new Error(
      `relationship accept: character "${c.toName}" not found in book — accept the character candidate first`,
    );
  }
  const now = new Date().toISOString();
  const profile = JSON.stringify({});
  const tx = sqlite.transaction(() => {
    const info = sqlite
      .prepare(
        `INSERT INTO relationships
         (book_id, from_character_id, to_character_id, type, tension, notes, profile_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(bookId, fromRow.id, toRow.id, c.type, c.tension, null, profile, now, now);
    const relationshipId = Number(info.lastInsertRowid);
    recordProfileVersion(sqlite, {
      bookId,
      entityType: "relationship",
      entityId: relationshipId,
      revision: 0,
      profileJson: profile,
      origin: "llm",
    });
    return relationshipId;
  });
  return tx.immediate();
}

function applyAcceptDecision(
  sqlite: DatabaseType,
  bookId: number,
  chapterId: number,
  payload: StoredPayload,
  candidateId: string,
  mergeTargetId?: number,
): { decision: Decision; entityId: number } {
  const found = findCandidate(payload, candidateId);
  if (!found) throw new Error("candidate not found in current snapshot");

  const { kind, candidate } = found;
  const c = candidate as StoredCharacterCandidate &
    StoredLocationCandidate &
    StoredItemCandidate &
    StoredHookCandidate &
    StoredRelationshipCandidate;

  let entityId: number;
  let decision: Decision;
  if (mergeTargetId !== undefined) {
    entityId = mergeTargetId;
    decision = "merged";
  } else if (
    c.status === "existing" &&
    c.existingId !== null
  ) {
    entityId = c.existingId;
    decision = "accepted";
  } else {
    decision = "accepted";
    if (kind === "character") {
      entityId = createCharacterFromCandidate(sqlite, bookId, c);
    } else if (kind === "location") {
      entityId = createLocationFromCandidate(sqlite, bookId, c);
    } else if (kind === "item") {
      entityId = createItemFromCandidate(sqlite, bookId, c);
    } else if (kind === "hook") {
      entityId = createHookFromCandidate(sqlite, bookId, chapterId, c);
    } else {
      entityId = createRelationshipFromCandidate(sqlite, bookId, c);
    }
  }

  recordMention(sqlite, {
    entityType: kind,
    entityId,
    bookId,
    chapterId,
    mentionCount: c.mentionCount,
    quote: c.quote,
  });

  c.decision = decision;
  c.decidedExistingId = mergeTargetId ?? null;

  return { decision, entityId };
}

// ─────────────── Route ───────────────

export function createCanonExtractionRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();

  r.post("/chapters/:id/extract-canon", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) return badRequest(c, "invalid chapter id");
    const ch = sqlite
      .prepare("SELECT id FROM chapters WHERE id = ?")
      .get(id) as { id: number } | undefined;
    if (!ch) return notFound(c, "chapter");
    try {
      const result = await runAndPersistExtraction(sqlite, id);
      return c.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: msg }, 400);
    }
  });

  r.get("/chapters/:id/canon-extractions", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) return badRequest(c, "invalid chapter id");
    const row = sqlite
      .prepare(
        "SELECT * FROM chapter_canon_extractions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(id) as ExtractionRow | undefined;
    if (!row) return c.json(null);
    return c.json(rowToResponse(row));
  });

  r.post(
    "/chapters/:id/canon-extractions/:candidateId/accept",
    async (c) => {
      const id = Number(c.req.param("id"));
      const candidateId = c.req.param("candidateId");
      if (Number.isNaN(id) || !candidateId) {
        return badRequest(c, "invalid params");
      }
      const ch = sqlite
        .prepare("SELECT id, book_id FROM chapters WHERE id = ?")
        .get(id) as { id: number; book_id: number } | undefined;
      if (!ch) return notFound(c, "chapter");
      const row = sqlite
        .prepare(
          "SELECT * FROM chapter_canon_extractions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(id) as ExtractionRow | undefined;
      if (!row) return notFound(c, "extraction");
      const payload = JSON.parse(row.payload_json) as StoredPayload;
      try {
        sqlite.transaction(() => {
          applyAcceptDecision(sqlite, ch.book_id, id, payload, candidateId);
        })();
      } catch (e) {
        return badRequest(c, e instanceof Error ? e.message : String(e));
      }
      sqlite
        .prepare(
          "UPDATE chapter_canon_extractions SET payload_json=?, updated_at=? WHERE id=?",
        )
        .run(JSON.stringify(payload), new Date().toISOString(), row.id);
      return c.json(
        rowToResponse({ ...row, payload_json: JSON.stringify(payload) }),
      );
    },
  );

  r.post(
    "/chapters/:id/canon-extractions/:candidateId/reject",
    async (c) => {
      const id = Number(c.req.param("id"));
      const candidateId = c.req.param("candidateId");
      if (Number.isNaN(id) || !candidateId) {
        return badRequest(c, "invalid params");
      }
      const row = sqlite
        .prepare(
          "SELECT * FROM chapter_canon_extractions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(id) as ExtractionRow | undefined;
      if (!row) return notFound(c, "extraction");
      const payload = JSON.parse(row.payload_json) as StoredPayload;
      const found = findCandidate(payload, candidateId);
      if (!found) return notFound(c, "candidate");
      const cand = found.candidate as { decision: Decision };
      cand.decision = "rejected";
      sqlite
        .prepare(
          "UPDATE chapter_canon_extractions SET payload_json=?, updated_at=? WHERE id=?",
        )
        .run(JSON.stringify(payload), new Date().toISOString(), row.id);
      return c.json(
        rowToResponse({ ...row, payload_json: JSON.stringify(payload) }),
      );
    },
  );

  r.post(
    "/chapters/:id/canon-extractions/:candidateId/merge",
    async (c) => {
      const id = Number(c.req.param("id"));
      const candidateId = c.req.param("candidateId");
      if (Number.isNaN(id) || !candidateId) {
        return badRequest(c, "invalid params");
      }
      const body = (await c.req.json().catch(() => null)) as
        | { targetId?: number }
        | null;
      const targetId = body?.targetId;
      if (typeof targetId !== "number") {
        return badRequest(c, "targetId required");
      }
      const ch = sqlite
        .prepare("SELECT id, book_id FROM chapters WHERE id = ?")
        .get(id) as { id: number; book_id: number } | undefined;
      if (!ch) return notFound(c, "chapter");
      const row = sqlite
        .prepare(
          "SELECT * FROM chapter_canon_extractions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(id) as ExtractionRow | undefined;
      if (!row) return notFound(c, "extraction");
      const payload = JSON.parse(row.payload_json) as StoredPayload;
      try {
        sqlite.transaction(() => {
          applyAcceptDecision(
            sqlite,
            ch.book_id,
            id,
            payload,
            candidateId,
            targetId,
          );
        })();
      } catch (e) {
        return badRequest(c, e instanceof Error ? e.message : String(e));
      }
      sqlite
        .prepare(
          "UPDATE chapter_canon_extractions SET payload_json=?, updated_at=? WHERE id=?",
        )
        .run(JSON.stringify(payload), new Date().toISOString(), row.id);
      return c.json(
        rowToResponse({ ...row, payload_json: JSON.stringify(payload) }),
      );
    },
  );

  r.post(
    "/chapters/:id/canon-extractions/:candidateId/undo",
    async (c) => {
      const id = Number(c.req.param("id"));
      const candidateId = c.req.param("candidateId");
      if (Number.isNaN(id) || !candidateId) {
        return badRequest(c, "invalid params");
      }
      const ch = sqlite
        .prepare("SELECT id, book_id FROM chapters WHERE id = ?")
        .get(id) as { id: number; book_id: number } | undefined;
      if (!ch) return notFound(c, "chapter");
      const row = sqlite
        .prepare(
          "SELECT * FROM chapter_canon_extractions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(id) as ExtractionRow | undefined;
      if (!row) return notFound(c, "extraction");
      const payload = JSON.parse(row.payload_json) as StoredPayload;
      const found = findCandidate(payload, candidateId);
      if (!found) return notFound(c, "candidate");
      const cand = found.candidate as {
        decision: Decision;
        decidedExistingId: number | null;
        status: "new" | "existing" | "ambiguous";
        existingId: number | null;
      };
      if (cand.decision === "pending") {
        // already pending — nothing to do
        return c.json(rowToResponse(row));
      }
      const wasNewCreate =
        cand.decision === "accepted" &&
        cand.status === "new" &&
        cand.existingId === null;
      const linkedExistingId =
        cand.decision === "merged"
          ? cand.decidedExistingId
          : cand.status === "existing"
            ? cand.existingId
            : null;
      try {
        sqlite.transaction(() => {
          // Find the linked entity for this candidate.
          // For "new" accept: entity was created; we need to find it via the
          // mention row (entity_id) since we didn't store it on the candidate.
          const mentionRow = sqlite
            .prepare(
              `SELECT entity_id FROM entity_chapter_mentions
               WHERE entity_type = ? AND chapter_id = ?
               ORDER BY first_seen_at DESC LIMIT 1`,
            )
            .all(found.kind, id) as Array<{ entity_id: number }>;
          // Remove every mention created by this candidate's accept/merge.
          // (We can't tell mentions apart per candidate-id; we use linkedId or
          // the most recent mention for new-creates.)
          let entityIdToConsiderDelete: number | null = null;
          if (linkedExistingId !== null) {
            sqlite
              .prepare(
                `DELETE FROM entity_chapter_mentions
                 WHERE entity_type = ? AND entity_id = ? AND chapter_id = ?`,
              )
              .run(found.kind, linkedExistingId, id);
          } else if (wasNewCreate && mentionRow[0]) {
            entityIdToConsiderDelete = mentionRow[0].entity_id;
            sqlite
              .prepare(
                `DELETE FROM entity_chapter_mentions
                 WHERE entity_type = ? AND entity_id = ? AND chapter_id = ?`,
              )
              .run(found.kind, entityIdToConsiderDelete, id);
          }
          // Garbage-collect orphaned entity if no other mentions remain.
          if (entityIdToConsiderDelete !== null) {
            const remaining = sqlite
              .prepare(
                `SELECT COUNT(*) AS c FROM entity_chapter_mentions
                 WHERE entity_type = ? AND entity_id = ?`,
              )
              .get(found.kind, entityIdToConsiderDelete) as { c: number };
            if (remaining.c === 0) {
              const table =
                found.kind === "character"
                  ? "characters"
                  : found.kind === "location"
                    ? "locations"
                    : found.kind === "item"
                      ? "items"
                      : found.kind === "hook"
                        ? "hooks"
                        : null;
              if (table) {
                sqlite
                  .prepare(`DELETE FROM ${table} WHERE id = ?`)
                  .run(entityIdToConsiderDelete);
              }
            }
          }
          cand.decision = "pending";
          cand.decidedExistingId = null;
        })();
      } catch (e) {
        return badRequest(c, e instanceof Error ? e.message : String(e));
      }
      sqlite
        .prepare(
          "UPDATE chapter_canon_extractions SET payload_json=?, updated_at=? WHERE id=?",
        )
        .run(JSON.stringify(payload), new Date().toISOString(), row.id);
      return c.json(
        rowToResponse({ ...row, payload_json: JSON.stringify(payload) }),
      );
    },
  );

  r.post("/chapters/:id/canon-extractions/accept-all", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) return badRequest(c, "invalid chapter id");
    const ch = sqlite
      .prepare("SELECT id, book_id FROM chapters WHERE id = ?")
      .get(id) as { id: number; book_id: number } | undefined;
    if (!ch) return notFound(c, "chapter");
    const row = sqlite
      .prepare(
        "SELECT * FROM chapter_canon_extractions WHERE chapter_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(id) as ExtractionRow | undefined;
    if (!row) return notFound(c, "extraction");
    const payload = JSON.parse(row.payload_json) as StoredPayload;
    sqlite.transaction(() => {
      const acceptKind = (
        list: Array<{
          id: string;
          decision: Decision;
        }>,
      ) => {
        for (const cand of list) {
          if (cand.decision !== "pending") continue;
          if (cand.id.startsWith("relationship:")) continue; // MVP skip
          try {
            applyAcceptDecision(sqlite, ch.book_id, id, payload, cand.id);
          } catch (e) {
            console.warn("[canon] accept-all failed for", cand.id, e);
          }
        }
      };
      acceptKind(payload.characters);
      acceptKind(payload.locations);
      acceptKind(payload.items);
      acceptKind(payload.hooks);
    })();
    sqlite
      .prepare(
        "UPDATE chapter_canon_extractions SET payload_json=?, updated_at=? WHERE id=?",
      )
      .run(JSON.stringify(payload), new Date().toISOString(), row.id);
    return c.json(
      rowToResponse({ ...row, payload_json: JSON.stringify(payload) }),
    );
  });

  r.get("/chapters/:id/canon", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) return badRequest(c, "invalid chapter id");
    const rows = sqlite
      .prepare(
        `SELECT entity_type, entity_id, mention_count, quote
         FROM entity_chapter_mentions
         WHERE chapter_id = ?
         ORDER BY first_seen_at ASC`,
      )
      .all(id) as Array<{
      entity_type: EntityKind;
      entity_id: number;
      mention_count: number;
      quote: string | null;
    }>;
    const out = rows.map((m) => {
      let name = "";
      if (m.entity_type === "character") {
        const r = sqlite
          .prepare("SELECT canonical_name FROM characters WHERE id = ?")
          .get(m.entity_id) as { canonical_name: string } | undefined;
        name = r?.canonical_name ?? "(удалён)";
      } else if (m.entity_type === "location") {
        const r = sqlite
          .prepare("SELECT name FROM locations WHERE id = ?")
          .get(m.entity_id) as { name: string } | undefined;
        name = r?.name ?? "(удалён)";
      } else if (m.entity_type === "item") {
        const r = sqlite
          .prepare("SELECT name FROM items WHERE id = ?")
          .get(m.entity_id) as { name: string } | undefined;
        name = r?.name ?? "(удалён)";
      } else if (m.entity_type === "hook") {
        const r = sqlite
          .prepare("SELECT description FROM hooks WHERE id = ?")
          .get(m.entity_id) as { description: string } | undefined;
        name = r?.description?.slice(0, 80) ?? "(удалён)";
      } else {
        name = "(связь)";
      }
      return {
        type: m.entity_type,
        entityId: m.entity_id,
        name,
        mentionCount: m.mention_count,
        quote: m.quote,
      };
    });
    return c.json(out);
  });

  return r;
}

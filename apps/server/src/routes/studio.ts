import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookConceptSchema,
  studioStateSchema,
  computeStudioWarnings,
  computeStudioProgress,
  type CanonSummary,
  type StageId,
} from "@book-forge/shared";
import { z } from "zod";
import {
  createStudioRepository,
  StudioBookNotFoundError,
  StudioConflictError,
} from "../db/studio.js";
import { notFound, validationFailed } from "../utils/errors.js";
import { runConceptRefiner } from "@book-forge/agents/concept/refiner";
import { runAspectPlaybook } from "@book-forge/agents/aspects/playbook";
import {
  runAspectVariants,
  toStoredVariants,
} from "@book-forge/agents/aspects/variants";
import {
  runAspectRefine,
  toStoredRefinedVariant,
} from "@book-forge/agents/aspects/refine";
import {
  runAspectEntityVariants,
  toStoredEntityVariants,
} from "@book-forge/agents/aspects/entity-variants";
import { stageIdSchema } from "@book-forge/shared";
import { buildContextRef } from "../services/studio/contextHash.js";

const patchStudioStateBodySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  next: studioStateSchema,
});

const refineFieldSchema = z.enum([
  "protagonist",
  "conflict",
  "stakes",
  "logline",
]);

const refineConceptBodySchema = z.object({
  field: refineFieldSchema,
  draft: z.string().max(2000).optional(),
});

const playbookBodySchema = z.object({
  existingAspectNames: z.array(z.string()).optional(),
});

const generateAspectBodySchema = z.object({
  aspect: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    payloadKind: z.enum(["markdown", "entity_set"]).optional(),
  }),
  accumulated: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      finalPayload: z.unknown(),
    }),
  ),
  draft: z.string().max(2000).optional(),
});

const refineAspectBodySchema = z.object({
  aspect: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  parentVariant: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    payload: z.string().min(1),
  }),
  instructions: z.string().min(1).max(2000),
  accumulated: z.array(
    z.object({
      name: z.string().min(1),
      finalPayload: z.string().min(1),
    }),
  ),
});

const ENTITY_STAGES = new Set(["characters", "items"] as const);

const entityProfileSchema = z.record(z.string(), z.unknown());

const materializeBodySchema = z.object({
  stageId: z.enum(["characters", "items"]),
  aspectName: z.string().min(1).max(120),
  candidates: z
    .array(
      z.object({
        tempId: z.string().min(1),
        decision: z.enum(["accept", "reject"]),
        profile: entityProfileSchema,
        mergedIntoId: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

function loadCanonSummary(sqlite: DatabaseType, bookId: number): CanonSummary {
  const row = sqlite
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM characters WHERE book_id = ?) as cc,
         (SELECT COUNT(*) FROM locations WHERE book_id = ?) as lc,
         (SELECT COUNT(*) FROM items WHERE book_id = ?) as ic`,
    )
    .get(bookId, bookId, bookId) as { cc: number; lc: number; ic: number };
  return {
    characterCount: row.cc,
    locationCount: row.lc,
    itemCount: row.ic,
  };
}

export function createStudioRoute(sqlite: DatabaseType): Hono {
  const r = new Hono();
  const repo = createStudioRepository(sqlite);

  r.get("/books/recommended", (c) => {
    const rows = sqlite
      .prepare("SELECT id FROM books")
      .all() as { id: number }[];
    const out: Record<number, StageId> = {};
    for (const { id } of rows) {
      const concept = repo.loadConcept(id);
      const studioState = repo.loadStudioState(id);
      const progress = computeStudioProgress(concept, studioState);
      out[id] = progress.recommended ?? "chapters";
    }
    return c.json(out);
  });

  r.get("/books/:id/concept", (c) => {
    const id = Number(c.req.param("id"));
    try {
      return c.json(repo.loadConcept(id));
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  });

  r.patch("/books/:id/concept", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = bookConceptSchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    try {
      return c.json(repo.patchConcept(id, parsed.data));
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  });

  r.get("/books/:id/studio-state", (c) => {
    const id = Number(c.req.param("id"));
    try {
      return c.json(repo.loadStudioState(id));
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  });

  r.patch("/books/:id/studio-state", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = patchStudioStateBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    try {
      const next = repo.patchStudioState(id, {
        expectedRevision: parsed.data.expectedRevision,
        next: parsed.data.next,
      });
      return c.json(next);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      if (e instanceof StudioConflictError) {
        return c.json(
          {
            error: "revision_conflict",
            details: { expected: e.expected, actual: e.actual },
          },
          409,
        );
      }
      if (e instanceof Error && e.message.startsWith("StudioState invariant")) {
        return c.json({ error: "invariant_violation", details: { message: e.message } }, 400);
      }
      throw e;
    }
  });

  r.get("/books/:id/studio-warnings", (c) => {
    const id = Number(c.req.param("id"));
    try {
      const concept = repo.loadConcept(id);
      const studioState = repo.loadStudioState(id);
      const canon = loadCanonSummary(sqlite, id);
      return c.json(computeStudioWarnings({ concept, studioState, canon }));
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  });

  r.post("/books/:id/concept/refine", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = refineConceptBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const accumulated: {
      protagonist?: string;
      conflict?: string;
      stakes?: string;
    } = {};
    if (parsed.data.field !== "protagonist" && concept.premise.protagonist) {
      accumulated.protagonist = concept.premise.protagonist;
    }
    if (
      (parsed.data.field === "stakes" || parsed.data.field === "logline") &&
      concept.premise.conflict
    ) {
      accumulated.conflict = concept.premise.conflict;
    }
    if (parsed.data.field === "logline" && concept.premise.stakes) {
      accumulated.stakes = concept.premise.stakes;
    }

    try {
      const result = await runConceptRefiner({
        field: parsed.data.field,
        concept,
        accumulated,
        ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
      });
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "concept_refine_failed", details: { message } },
        500,
      );
    }
  });

  r.post("/books/:id/stages/:stageId/playbook", async (c) => {
    const id = Number(c.req.param("id"));
    const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
    if (!stageParse.success) return validationFailed(c, stageParse.error);
    const body = await c.req.json().catch(() => ({}));
    const parsed = playbookBodySchema.safeParse(body ?? {});
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const contextRef = buildContextRef({
      stageId: stageParse.data,
      concept,
      accumulated: [],
      extra: { kind: "playbook" },
    });
    try {
      const result = await runAspectPlaybook({
        stageId: stageParse.data,
        concept,
        existingAspectNames: parsed.data.existingAspectNames ?? [],
        contextRef,
      });
      const isEntity = ENTITY_STAGES.has(
        stageParse.data as "characters" | "items",
      );
      const aspects = isEntity
        ? result.aspects.map((a) => ({
            ...a,
            payloadKind: "entity_set" as const,
          }))
        : result.aspects;
      return c.json({ aspects, contextRef });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "aspect_playbook_failed", details: { message } },
        500,
      );
    }
  });

  r.post("/books/:id/stages/:stageId/aspects/:aspectId/generate", async (c) => {
    const id = Number(c.req.param("id"));
    const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
    if (!stageParse.success) return validationFailed(c, stageParse.error);
    const body = await c.req.json().catch(() => null);
    const parsed = generateAspectBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const stageId = stageParse.data;
    const payloadKind = parsed.data.aspect.payloadKind ?? "markdown";

    if (payloadKind === "entity_set") {
      if (stageId !== "characters" && stageId !== "items") {
        return c.json(
          { error: "stage_not_entity", details: { stageId } },
          400,
        );
      }
      const accumulatedEntities = parsed.data.accumulated
        .map((a) => {
          const fp = a.finalPayload;
          if (!fp || typeof fp !== "object") return null;
          const candidates = (fp as { candidates?: unknown }).candidates;
          if (!Array.isArray(candidates)) return null;
          const finalEntities = (
            candidates as Array<{
              kind?: "character" | "location" | "item";
              profile?: unknown;
              status?: string;
            }>
          )
            .filter((c) => c.status === "accepted" || c.status === "merged")
            .map((c) => ({
              kind: c.kind ?? "character",
              profile: c.profile,
            }));
          return { name: a.name, finalEntities };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      const contextRefEntity = buildContextRef({
        stageId,
        concept,
        accumulated: parsed.data.accumulated.map((a) => ({
          id: a.id,
          name: a.name,
          finalPayload: JSON.stringify(a.finalPayload),
        })),
        extra: { kind: "entity_variants", aspectId: parsed.data.aspect.id },
      });
      try {
        const result = await runAspectEntityVariants({
          stageId,
          concept,
          aspect: parsed.data.aspect,
          accumulated: accumulatedEntities,
          contextRef: contextRefEntity,
        });
        const variants = toStoredEntityVariants(result, {
          contextRef: contextRefEntity,
          modelId: "subscription:claude-sonnet-4-6",
        });
        return c.json({ variants, contextRef: contextRefEntity });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return c.json(
          { error: "aspect_entity_variants_failed", details: { message } },
          500,
        );
      }
    }

    const contextRef = buildContextRef({
      stageId,
      concept,
      accumulated: parsed.data.accumulated.map((a) => ({
        id: a.id,
        name: a.name,
        finalPayload:
          typeof a.finalPayload === "string"
            ? a.finalPayload
            : JSON.stringify(a.finalPayload),
      })),
      extra: {
        kind: "variants",
        aspectId: parsed.data.aspect.id,
        ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
      },
    });
    try {
      const result = await runAspectVariants({
        stageId,
        concept,
        aspect: parsed.data.aspect,
        accumulated: parsed.data.accumulated.map((a) => ({
          name: a.name,
          finalPayload:
            typeof a.finalPayload === "string"
              ? a.finalPayload
              : JSON.stringify(a.finalPayload),
        })),
        ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
        contextRef,
      });
      const variants = toStoredVariants(result, {
        contextRef,
        modelId: "subscription:claude-sonnet-4-6",
      });
      return c.json({ variants, contextRef });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "aspect_variants_failed", details: { message } },
        500,
      );
    }
  });

  r.post("/books/:id/stages/:stageId/aspects/:aspectId/refine", async (c) => {
    const id = Number(c.req.param("id"));
    const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
    if (!stageParse.success) return validationFailed(c, stageParse.error);
    const body = await c.req.json().catch(() => null);
    const parsed = refineAspectBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    let concept;
    try {
      concept = repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }

    const contextRef = buildContextRef({
      stageId: stageParse.data,
      concept,
      accumulated: parsed.data.accumulated.map((a, i) => ({
        id: `acc${i}`,
        name: a.name,
        finalPayload: a.finalPayload,
      })),
      extra: {
        kind: "refine",
        aspectId: parsed.data.aspect.id,
        parentVariantId: parsed.data.parentVariant.id,
        instructions: parsed.data.instructions,
      },
    });
    try {
      const result = await runAspectRefine({
        stageId: stageParse.data,
        concept,
        aspect: parsed.data.aspect,
        parentVariant: parsed.data.parentVariant,
        instructions: parsed.data.instructions,
        accumulated: parsed.data.accumulated,
        contextRef,
      });
      const variant = toStoredRefinedVariant(result, {
        parentVariantId: parsed.data.parentVariant.id,
        contextRef,
        modelId: "subscription:claude-sonnet-4-6",
      });
      return c.json({ variant, contextRef });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json(
        { error: "aspect_refine_failed", details: { message } },
        500,
      );
    }
  });

  r.post("/books/:id/aspects/:aspectId/materialize", async (c) => {
    const id = Number(c.req.param("id"));
    const aspectId = c.req.param("aspectId");
    const body = await c.req.json().catch(() => null);
    const parsed = materializeBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const bookRow = sqlite
      .prepare("SELECT id, studio_state FROM books WHERE id = ?")
      .get(id) as { id: number; studio_state: string | null } | undefined;
    if (!bookRow) return notFound(c, "book");

    // ADR 0002 (Step 7) — idempotency: a network retry replays the SAME
    // request (same aspect, same tempId set) instead of inserting duplicate
    // entities. The materialize event journaled in the same transaction
    // below is the dedup key.
    const requestKey = parsed.data.candidates
      .map((cand) => cand.tempId)
      .sort()
      .join("|");
    const prior = sqlite
      .prepare(
        `SELECT payload FROM studio_events
         WHERE book_id = ? AND aspect_id = ? AND event_type = 'materialize_entity_set'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(id, aspectId) as { payload: string } | undefined;
    if (prior) {
      try {
        const p = JSON.parse(prior.payload) as {
          requestKey?: string;
          response?: unknown;
        };
        if (p.requestKey === requestKey && p.response) {
          return c.json(p.response);
        }
      } catch {
        /* malformed legacy event — fall through to a fresh materialization */
      }
    }

    const now = new Date().toISOString();

    const insertChar = sqlite.prepare(
      `INSERT INTO characters (book_id, canonical_name, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertItem = sqlite.prepare(
      `INSERT INTO items (book_id, name, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    let revision = 0;
    try {
      revision = bookRow.studio_state
        ? ((JSON.parse(bookRow.studio_state) as { revision?: number })
            .revision ?? 0)
        : 0;
    } catch {
      revision = 0;
    }

    // ADR 0002 (Step 7) — atomicity: all entity inserts + the audit event
    // land in ONE immediate transaction; a mid-loop failure leaves nothing.
    const tx = sqlite.transaction(() => {
      const createdEntityIds: number[] = [];
      const candidatesAfter: Array<{
        tempId: string;
        decision: "accept" | "reject";
        materializedEntityId?: number;
        mergedIntoId?: number;
      }> = [];

      for (const cand of parsed.data.candidates) {
        if (cand.decision === "reject") {
          candidatesAfter.push({ tempId: cand.tempId, decision: "reject" });
          continue;
        }
        if (cand.mergedIntoId !== undefined) {
          candidatesAfter.push({
            tempId: cand.tempId,
            decision: "accept",
            mergedIntoId: cand.mergedIntoId,
          });
          continue;
        }
        const profileJson = JSON.stringify(cand.profile);
        const profile = cand.profile as { name?: unknown };
        const name =
          typeof profile.name === "string" ? profile.name : "Без имени";
        let entityId: number;
        if (parsed.data.stageId === "characters") {
          const info = insertChar.run(id, name, profileJson, now, now);
          entityId = Number(info.lastInsertRowid);
        } else {
          const info = insertItem.run(id, name, profileJson, now, now);
          entityId = Number(info.lastInsertRowid);
        }
        createdEntityIds.push(entityId);
        candidatesAfter.push({
          tempId: cand.tempId,
          decision: "accept",
          materializedEntityId: entityId,
        });
      }

      const response = {
        aspectId,
        createdEntityIds,
        candidates: candidatesAfter,
      };
      sqlite
        .prepare(
          `INSERT INTO studio_events
             (book_id, event_type, stage_id, aspect_id, payload, revision_before, revision_after, created_at)
           VALUES (?, 'materialize_entity_set', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          parsed.data.stageId,
          aspectId,
          JSON.stringify({ requestKey, response }),
          revision,
          revision,
          now,
        );
      return response;
    });

    return c.json(tx.immediate());
  });

  return r;
}

import { Hono } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookConceptSchema,
  studioStateSchema,
  computeStudioWarnings,
  type CanonSummary,
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
  }),
  accumulated: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      finalPayload: z.string().min(1),
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
      return c.json({ aspects: result.aspects, contextRef });
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

    const contextRef = buildContextRef({
      stageId: stageParse.data,
      concept,
      accumulated: parsed.data.accumulated,
      extra: {
        kind: "variants",
        aspectId: parsed.data.aspect.id,
        ...(parsed.data.draft !== undefined ? { draft: parsed.data.draft } : {}),
      },
    });
    try {
      const result = await runAspectVariants({
        stageId: stageParse.data,
        concept,
        aspect: parsed.data.aspect,
        accumulated: parsed.data.accumulated.map((a) => ({
          name: a.name,
          finalPayload: a.finalPayload,
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

  return r;
}

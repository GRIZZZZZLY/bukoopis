import { Hono, type Context } from "hono";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  bookConceptSchema,
  studioStateSchema,
  computeStudioWarnings,
  computeStudioProgress,
  lockConceptToPitch,
  unlockConcept,
  PITCH_MIX_FIELDS,
  type BookConcept,
  type CanonSummary,
  type ChapterProgress,
  type StageId,
} from "@book-forge/shared";
import { z } from "zod";
import {
  createStudioRepository,
  StudioBookNotFoundError,
  StudioConflictError,
} from "../db/studio.js";
import { notFound, validationFailed, badRequest } from "../utils/errors.js";
import { runConceptRefiner } from "@book-forge/agents/concept/refiner";
import { runPitchGenerator, toPitches } from "@book-forge/agents/concept/pitches";
import { runPitchBlender } from "@book-forge/agents/concept/pitch-blend";
import { randomUUID } from "node:crypto";
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
import { ESTIMATE_MS } from "../utils/generation-progress.js";
import { streamAgentProgress } from "../utils/sse-progress.js";
import { streamSSE } from "hono/streaming";
import { runIntake, IntakeBookNotFoundError } from "../utils/intake-run.js";
import { createIntakeCancelRegistry } from "../utils/intake-cancel.js";

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

const generatePitchesBodySchema = z.object({
  direction: z.string().trim().max(1000).optional(),
  count: z.number().int().min(3).max(5).optional(),
});

const blendPitchBodySchema = z.object({
  picks: z
    .partialRecord(z.enum(PITCH_MIX_FIELDS), z.string().min(1))
    .refine((p) => Object.keys(p).length > 0, { message: "at least one pick" }),
  note: z.string().trim().max(1000).optional(),
});

const lockConceptBodySchema = z.object({
  pitchId: z.string().min(1).optional(),
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

const intakeFileSchema = z
  .object({
    filename: z.string().trim().min(1).max(400),
    content: z.string().min(1).max(400_000).optional(),
    /** .docx приходит байтами — сервер сам достанет из него текст. */
    contentBase64: z.string().min(1).max(8_000_000).optional(),
  })
  .refine((f) => f.content !== undefined || f.contentBase64 !== undefined, {
    message: "content or contentBase64 required",
  });

const intakeBodySchema = z.object({
  files: z.array(intakeFileSchema).min(1).max(50),
});

const intakeCancelBodySchema = z.object({
  requestKey: z.string().min(1),
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

/** Принятые сущности предыдущих аспектов entity-стадии → вход агента.
 *  Аспекты без валидного entity_set-payload отбрасываются. */
function toAccumulatedEntities(
  accumulated: Array<{ id: string; name: string; finalPayload: unknown }>,
): Array<{
  name: string;
  finalEntities: Array<{ kind: "character" | "location" | "item"; profile: unknown }>;
}> {
  return accumulated
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
        .map((c) => ({ kind: c.kind ?? "character", profile: c.profile }));
      return { name: a.name, finalEntities };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

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

/** The chapters stage has no aspects — the chapters table is what says whether
 *  the book is being written and whether it is finished. */
function loadChapterProgress(
  sqlite: DatabaseType,
  bookId: number,
): ChapterProgress {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'final' THEN 1 ELSE 0 END) AS finalized
         FROM chapters WHERE book_id = ?`,
    )
    .get(bookId) as { total: number; finalized: number | null };
  return { total: row.total, finalized: row.finalized ?? 0 };
}

export function createStudioRoute(sqlite: DatabaseType, hasVec: boolean): Hono {
  const r = new Hono();
  const repo = createStudioRepository(sqlite);
  const intakeCancels = createIntakeCancelRegistry();
  // Ключ разбора, идущего сейчас для книги — для GET .../intake/inflight.
  // Отдельно от intakeCancels: тот хранит только «остановить или нет», не
  // «какой ключ сейчас активен для этой книги».
  const intakeInFlight = new Map<number, string>();

  r.get("/books/recommended", (c) => {
    const rows = sqlite
      .prepare("SELECT id FROM books")
      .all() as { id: number }[];
    const out: Record<number, StageId> = {};
    for (const { id } of rows) {
      const concept = repo.loadConcept(id);
      const studioState = repo.loadStudioState(id);
      const progress = computeStudioProgress(
        concept,
        studioState,
        loadChapterProgress(sqlite, id),
      );
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
      if (e instanceof Error && e.message.startsWith("Concept invariant")) {
        return c.json({ error: "invariant_violation", details: { message: e.message } }, 400);
      }
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
      const chapters = loadChapterProgress(sqlite, id);
      return c.json(
        computeStudioWarnings({ concept, studioState, canon, chapters }),
      );
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

  function loadConceptOr404(c: Context, id: number): BookConcept | Response {
    try {
      return repo.loadConcept(id);
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  }

  r.post("/books/:id/concept/pitches", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    const parsed = generatePitchesBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    const idea = (concept.idea ?? "").trim();
    if (idea.length < 10) {
      return badRequest(c, "idea is too short: write what the book is about first");
    }
    let out;
    try {
      out = await runPitchGenerator({
        idea,
        ...(parsed.data.direction ? { direction: parsed.data.direction } : {}),
        ...(parsed.data.count !== undefined ? { count: parsed.data.count } : {}),
        avoid: concept.pitches.map((p) => ({ workingTitle: p.workingTitle, logline: p.logline })),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: "pitch_generation_failed", details: { message } }, 500);
    }
    const fresh = toPitches(out.pitches, () => randomUUID());
    try {
      const next = repo.patchConcept(id, { ...concept, pitches: [...concept.pitches, ...fresh] });
      return c.json({
        concept: next,
        questions: out.questions,
        newPitchIds: fresh.map((p) => p.id),
      });
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  });

  r.post("/books/:id/concept/pitches/blend", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = blendPitchBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    const byId = new Map(concept.pitches.map((p) => [p.id, p] as const));
    const pickIds = [...new Set(Object.values(parsed.data.picks))];
    const missing = pickIds.filter((pid) => !byId.has(pid));
    if (missing.length > 0) return badRequest(c, `unknown pitch id: ${missing.join(", ")}`);
    const sources = pickIds.flatMap((pid) => {
      const p = byId.get(pid);
      return p ? [p] : [];
    });
    let draft;
    try {
      draft = await runPitchBlender({
        idea: (concept.idea ?? "").trim(),
        sources,
        picks: parsed.data.picks,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: "pitch_blend_failed", details: { message } }, 500);
    }
    const blended = toPitches([draft], () => randomUUID())[0];
    if (!blended) {
      return c.json(
        { error: "pitch_blend_failed", details: { message: "blender returned no pitch" } },
        500,
      );
    }
    try {
      const next = repo.patchConcept(id, { ...concept, pitches: [...concept.pitches, blended] });
      return c.json({ concept: next, pitchId: blended.id });
    } catch (e) {
      if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
      throw e;
    }
  });

  r.post("/books/:id/concept/lock", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    const parsed = lockConceptBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    const now = new Date().toISOString();
    try {
      if (parsed.data.pitchId === undefined) {
        // Legacy concepts have a premise but no pitches: one click confirms them.
        if ((concept.premise.logline ?? "").trim().length === 0) {
          return badRequest(c, "nothing to lock: pick a pitch or fill the premise first");
        }
        return c.json(repo.patchConcept(id, { ...concept, lockedAt: now }));
      }
      const pitch = concept.pitches.find((p) => p.id === parsed.data.pitchId);
      if (!pitch) return badRequest(c, `unknown pitch id: ${parsed.data.pitchId}`);
      // Both writes must land together — a concept locked to a pitch whose
      // working title never reached the book is a half-applied lock.
      const lockTx = sqlite.transaction(() => {
        const next = repo.patchConcept(id, lockConceptToPitch(concept, pitch.id, now));
        sqlite
          .prepare("UPDATE books SET title = ?, updated_at = ? WHERE id = ?")
          .run(pitch.workingTitle, now, id);
        return next;
      });
      return c.json(lockTx());
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Concept invariant")) {
        return c.json({ error: "invariant_violation", details: { message: e.message } }, 400);
      }
      throw e;
    }
  });

  r.post("/books/:id/concept/unlock", (c) => {
    const id = Number(c.req.param("id"));
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;
    return c.json(repo.patchConcept(id, unlockConcept(concept)));
  });

  r.post("/books/:id/intake", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = intakeBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    try {
      const { summary, ideaSet, chapters, failures, revision } = await runIntake(
        { sqlite, hasVec, repo, bookId: id },
        { files: parsed.data.files },
      );
      return c.json({ summary, ideaSet, chapters, failures, revision });
    } catch (e) {
      if (e instanceof IntakeBookNotFoundError) return notFound(c, "book");
      if (e instanceof StudioConflictError) {
        return c.json(
          { error: "revision_conflict", details: { expected: e.expected } },
          409,
        );
      }
      throw e;
    }
  });

  r.post("/books/:id/intake-stream", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = intakeBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    // Книгу проверяем до открытия потока: неизвестный id должен остаться
    // обычным 404, а не событием `error` внутри уже открытого 200-потока.
    const concept = loadConceptOr404(c, id);
    if (concept instanceof Response) return concept;

    return streamSSE(c, async (stream) => {
      // onFile синхронный, а stream.writeSSE — асинхронный запись; без
      // цепочки промисов события файлов и begin/done перемешались бы.
      let pending: Promise<void> = Promise.resolve();
      const queue = (event: string, data: unknown): void => {
        pending = pending
          .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
          .catch(() => {});
      };

      // requestKey нужен и реестру отмены, и событию `begin`. Он приходит
      // из onBegin раннера — единственного места, где ключ вычисляется, —
      // чтобы маршрут никогда не считал его заново и не мог разойтись с тем,
      // что видит `runIntake`.
      let currentKey: string | undefined;
      try {
        const result = await runIntake(
          { sqlite, hasVec, repo, bookId: id },
          {
            files: parsed.data.files,
            onBegin: (e) => {
              currentKey = e.requestKey;
              intakeCancels.begin(id, e.requestKey);
              intakeInFlight.set(id, e.requestKey);
              queue("begin", e);
            },
            onFile: (e) => queue("file", e),
            shouldStop: () => (currentKey !== undefined ? intakeCancels.shouldStop(id, currentKey) : false),
          },
        );
        await pending;
        const { summary, ideaSet, chapters, failures, revision, cancelled } = result;
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ summary, ideaSet, chapters, failures, revision, cancelled }),
        });
      } catch (e) {
        await pending;
        if (e instanceof IntakeBookNotFoundError) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: "not_found", details: { resource: "book" } }),
          });
        } else if (e instanceof StudioConflictError) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: "revision_conflict", details: { expected: e.expected } }),
          });
        } else {
          const message = e instanceof Error ? e.message : String(e);
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: "intake_failed", details: { message } }),
          });
        }
      } finally {
        // Снимаем регистрацию на любом исходе — успех, ошибка или отмена —
        // иначе упавший или уже завершившийся разбор остаётся в реестре и
        // более поздний запрос на остановку того же ключа находит призрак.
        if (currentKey !== undefined) {
          intakeCancels.end(id, currentKey);
          intakeInFlight.delete(id);
        }
      }
    });
  });

  r.get("/books/:id/intake/inflight", (c) => {
    const id = Number(c.req.param("id"));
    const requestKey = intakeInFlight.get(id);
    if (requestKey === undefined) return notFound(c, "intake_run");
    return c.json({ requestKey });
  });

  r.post("/books/:id/intake/cancel", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => null);
    const parsed = intakeCancelBodySchema.safeParse(body);
    if (!parsed.success) return validationFailed(c, parsed.error);

    const stopped = intakeCancels.requestStop(id, parsed.data.requestKey);
    if (!stopped) return notFound(c, "intake_run");
    return c.json({ stopping: true });
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
      const accumulatedEntities = toAccumulatedEntities(parsed.data.accumulated);
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

  /** Тот же результат, что у `/generate`, но потоком: события `progress`
   *  (реальные вехи вызова + heartbeat раз в секунду), затем `done` с
   *  вариантами или `error`. Работает для обоих видов payload — markdown
   *  (мир/лор) и entity_set (персонажи/предметы). Нужен потому, что вызов идёт
   *  десятки секунд и молчащая кнопка выглядела как зависание. */
  r.post(
    "/books/:id/stages/:stageId/aspects/:aspectId/generate-stream",
    async (c) => {
      const id = Number(c.req.param("id"));
      const stageParse = stageIdSchema.safeParse(c.req.param("stageId"));
      if (!stageParse.success) return validationFailed(c, stageParse.error);
      const stageId = stageParse.data;
      const body = await c.req.json().catch(() => null);
      const parsed = generateAspectBodySchema.safeParse(body);
      if (!parsed.success) return validationFailed(c, parsed.error);
      const payload = parsed.data;
      const payloadKind = payload.aspect.payloadKind ?? "markdown";
      const isEntityStage = stageId === "characters" || stageId === "items";
      if (payloadKind === "entity_set" && !isEntityStage) {
        return c.json({ error: "stage_not_entity", details: { stageId } }, 400);
      }

      let concept;
      try {
        concept = repo.loadConcept(id);
      } catch (e) {
        if (e instanceof StudioBookNotFoundError) return notFound(c, "book");
        throw e;
      }

      if (payloadKind === "entity_set") {
        const entityStageId = stageId as "characters" | "items";
        const contextRef = buildContextRef({
          stageId: entityStageId,
          concept,
          accumulated: payload.accumulated.map((a) => ({
            id: a.id,
            name: a.name,
            finalPayload: JSON.stringify(a.finalPayload),
          })),
          extra: { kind: "entity_variants", aspectId: payload.aspect.id },
        });
        const accumulatedEntities = toAccumulatedEntities(payload.accumulated);
        return streamAgentProgress(c, {
          errorCode: "aspect_entity_variants_failed",
          estimateMs: ESTIMATE_MS.entityVariants,
          run: (onProgress) =>
            runAspectEntityVariants(
              {
                stageId: entityStageId,
                concept,
                aspect: payload.aspect,
                accumulated: accumulatedEntities,
                contextRef,
              },
              { onProgress },
            ),
          buildDone: (result) => ({
            variants: toStoredEntityVariants(result, {
              contextRef,
              modelId: "subscription:claude-sonnet-4-6",
            }),
            contextRef,
          }),
        });
      }

      const accumulatedMarkdown = payload.accumulated.map((a) => ({
        id: a.id,
        name: a.name,
        finalPayload:
          typeof a.finalPayload === "string"
            ? a.finalPayload
            : JSON.stringify(a.finalPayload),
      }));
      const contextRef = buildContextRef({
        stageId,
        concept,
        accumulated: accumulatedMarkdown,
        extra: {
          kind: "variants",
          aspectId: payload.aspect.id,
          ...(payload.draft !== undefined ? { draft: payload.draft } : {}),
        },
      });
      return streamAgentProgress(c, {
        errorCode: "aspect_variants_failed",
        estimateMs: ESTIMATE_MS.markdownVariants,
        run: (onProgress) =>
          runAspectVariants(
            {
              stageId,
              concept,
              aspect: payload.aspect,
              accumulated: accumulatedMarkdown.map((a) => ({
                name: a.name,
                finalPayload: a.finalPayload,
              })),
              ...(payload.draft !== undefined ? { draft: payload.draft } : {}),
              contextRef,
            },
            { onProgress },
          ),
        buildDone: (result) => ({
          variants: toStoredVariants(result, {
            contextRef,
            modelId: "subscription:claude-sonnet-4-6",
          }),
          contextRef,
        }),
      });
    },
  );

  /** Стрим-вариант `/refine` — уточнение одного markdown-варианта. */
  r.post(
    "/books/:id/stages/:stageId/aspects/:aspectId/refine-stream",
    async (c) => {
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

      const stageId = stageParse.data;
      const payload = parsed.data;
      const contextRef = buildContextRef({
        stageId,
        concept,
        accumulated: payload.accumulated.map((a, i) => ({
          id: `acc${i}`,
          name: a.name,
          finalPayload: a.finalPayload,
        })),
        extra: {
          kind: "refine",
          aspectId: payload.aspect.id,
          parentVariantId: payload.parentVariant.id,
          instructions: payload.instructions,
        },
      });
      return streamAgentProgress(c, {
        errorCode: "aspect_refine_failed",
        estimateMs: ESTIMATE_MS.refine,
        run: (onProgress) =>
          runAspectRefine(
            {
              stageId,
              concept,
              aspect: payload.aspect,
              parentVariant: payload.parentVariant,
              instructions: payload.instructions,
              accumulated: payload.accumulated,
              contextRef,
            },
            { onProgress },
          ),
        buildDone: (result) => ({
          variant: toStoredRefinedVariant(result, {
            parentVariantId: payload.parentVariant.id,
            contextRef,
            modelId: "subscription:claude-sonnet-4-6",
          }),
          contextRef,
        }),
      });
    },
  );

  /** Стрим-вариант `/playbook` — список аспектов стадии. */
  r.post("/books/:id/stages/:stageId/playbook-stream", async (c) => {
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

    const stageId = stageParse.data;
    const existingAspectNames = parsed.data.existingAspectNames ?? [];
    const contextRef = buildContextRef({
      stageId,
      concept,
      accumulated: [],
      extra: { kind: "playbook", existingAspectNames },
    });
    const isEntity = ENTITY_STAGES.has(stageId as "characters" | "items");
    return streamAgentProgress(c, {
      errorCode: "aspect_playbook_failed",
      estimateMs: ESTIMATE_MS.playbook,
      run: (onProgress) =>
        runAspectPlaybook(
          { stageId, concept, existingAspectNames, contextRef },
          { onProgress },
        ),
      // Для entity-стадий сервер сам проставляет payloadKind — фронт больше не
      // угадывает (иначе аспект уходил в state как markdown, см. инвариант
      // variant_payload_kind_mismatch).
      buildDone: (result) => ({
        aspects: isEntity
          ? result.aspects.map((a) => ({
              ...a,
              payloadKind: "entity_set" as const,
            }))
          : result.aspects,
        contextRef,
      }),
    });
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

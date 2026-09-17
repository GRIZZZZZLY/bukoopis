import { z } from "zod";

// ─────────────── enums ───────────────

export const STAGE_IDS = [
  "concept",
  "world",
  "lore",
  "characters",
  "items",
  "plot",
  "chapters",
] as const;
export const stageIdSchema = z.enum(STAGE_IDS);
export type StageId = z.infer<typeof stageIdSchema>;

/** Stages a novel can be finished without. Worldbuilding and lore matter for
 *  some books and not others, and no established method treats a props catalogue
 *  as a step — so the UI must say out loud that these are branches, not gates. */
export const OPTIONAL_STAGE_IDS = ["world", "lore", "items"] as const;

export function isOptionalStage(id: StageId): boolean {
  return (OPTIONAL_STAGE_IDS as readonly string[]).includes(id);
}

export const ASPECT_STATUSES = [
  "pending",
  "generating",
  "reviewing",
  "accepted",
  "skipped",
] as const;
export const aspectStatusSchema = z.enum(ASPECT_STATUSES);
export type AspectStatus = z.infer<typeof aspectStatusSchema>;

export const VARIANT_STATUSES = [
  "generated",
  "edited",
  "accepted",
  "rejected",
  "superseded",
] as const;
export const variantStatusSchema = z.enum(VARIANT_STATUSES);
export type VariantStatus = z.infer<typeof variantStatusSchema>;

export const ASPECT_SOURCES = [
  "llm",
  "user",
  "import",
  "cross_book",
  "system",
] as const;
export const aspectSourceSchema = z.enum(ASPECT_SOURCES);
export type AspectSource = z.infer<typeof aspectSourceSchema>;

export const EDIT_SOURCES = ["llm", "manual", "refine"] as const;
export const editSourceSchema = z.enum(EDIT_SOURCES);
export type EditSource = z.infer<typeof editSourceSchema>;

export const PAYLOAD_KINDS = [
  "markdown",
  "premise_field",
  "entity_set",
  "import_candidate",
] as const;
export const payloadKindSchema = z.enum(PAYLOAD_KINDS);
export type PayloadKind = z.infer<typeof payloadKindSchema>;

export const STAGE_STATUSES = [
  "not_started",
  "in_progress",
  "complete",
  "skipped",
] as const;
export const stageStatusSchema = z.enum(STAGE_STATUSES);
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const ENTITY_KINDS = ["character", "location", "item"] as const;
export const entityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof entityKindSchema>;

export const ENTITY_CANDIDATE_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
  "merged",
] as const;
export const entityCandidateStatusSchema = z.enum(ENTITY_CANDIDATE_STATUSES);
export type EntityCandidateStatus = z.infer<typeof entityCandidateStatusSchema>;

// ─────────────── leaf schemas ───────────────

export const contextRefSchema = z.object({
  hash: z.string().min(1),
  summary: z.string().min(1),
  includedAspectIds: z.array(z.string()),
  includedEntityIds: z.array(z.string()),
});
export type ContextRef = z.infer<typeof contextRefSchema>;

export const aspectVariantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  payloadKind: payloadKindSchema,
  // Storage layer accepts unknown — consumers MUST validate via payloadKind
  // before reading. See studio-invariants.ts.
  payload: z.unknown(),
  status: variantStatusSchema,
  parentVariantId: z.string().min(1).optional(),
  editSource: editSourceSchema,
  generatedAt: z.string().min(1),
  modelId: z.string().min(1).optional(),
  promptHash: z.string().optional(),
  contextRef: contextRefSchema.optional(),
});
export type AspectVariant = z.infer<typeof aspectVariantSchema>;

/** Профиль кандидата Мастерской. Поля перечислены (раздел 5.1 ТЗ требует
 *  типизированной схемы вместо `z.unknown()`), но `catchall` оставляет
 *  неизвестные ключи на месте: генератор сущностей волен вернуть больше,
 *  и терять это на границе схемы нельзя. */
export const entityCandidateProfileSchema = z
  .object({
    name: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    age: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    background: z.string().nullable().optional(),
    origin: z.string().nullable().optional(),
    significance: z.string().nullable().optional(),
    properties: z.string().nullable().optional(),
  })
  .catchall(z.unknown());
export type EntityCandidateProfile = z.infer<typeof entityCandidateProfileSchema>;

export const entityCandidateSchema = z.object({
  tempId: z.string().min(1),
  kind: entityKindSchema,
  profile: entityCandidateProfileSchema,
  status: entityCandidateStatusSchema,
  materializedEntityId: z.number().int().positive().optional(),
  mergedIntoEntityId: z.number().int().positive().optional(),
});
export type EntityCandidate = z.infer<typeof entityCandidateSchema>;

export const entitySetPayloadSchema = z.object({
  candidates: z.array(entityCandidateSchema),
});
export type EntitySetPayload = z.infer<typeof entitySetPayloadSchema>;

export const stageAspectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: aspectStatusSchema,
  order: z.number().int().nonnegative(),
  required: z.boolean(),
  source: aspectSourceSchema,
  payloadKind: payloadKindSchema,
  variants: z.array(aspectVariantSchema),
  selectedVariantId: z.string().min(1).optional(),
  finalPayload: z.unknown().optional(),
  emits: z
    .object({
      kind: entityKindSchema,
      entityIds: z.array(z.number().int().positive()),
    })
    .optional(),
  notes: z.string().optional(),
  contextRef: contextRefSchema.optional(),
});
export type StageAspect = z.infer<typeof stageAspectSchema>;

export const stageStateSchema = z.object({
  status: stageStatusSchema,
  skippedReason: z.string().optional(),
  playbookGenerated: z.boolean(),
  aspects: z.array(stageAspectSchema),
  updatedAt: z.string().optional(),
});
export type StageState = z.infer<typeof stageStateSchema>;

export const studioStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  stages: z
    .record(z.string(), stageStateSchema)
    .refine(
      (stages) => Object.keys(stages).every((key) => STAGE_IDS.includes(key as StageId)),
      "stages must only contain valid STAGE_IDS"
    ),
});
export type StudioState = z.infer<typeof studioStateSchema>;

// ─────────────── audit payload ───────────────

export const STUDIO_EVENT_TYPES = [
  "accept_variant",
  "reject_variant",
  "refine_variant",
  "regen_variant",
  "materialize_entity_set",
  "entity_review_decision",
  "import_merge",
  "cross_book_copy",
  "stage_skip",
  "playbook_generate",
  "aspect_create_manual",
  "aspect_delete",
] as const;
export const studioEventTypeSchema = z.enum(STUDIO_EVENT_TYPES);
export type StudioEventType = z.infer<typeof studioEventTypeSchema>;

export const studioEventPayloadSchema = z.object({
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  patch: z.unknown().optional(),
  entityRefs: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type StudioEventPayload = z.infer<typeof studioEventPayloadSchema>;

// ─────────────── factories ───────────────

export function emptyStudioState(): StudioState {
  return { schemaVersion: 1, revision: 0, stages: {} };
}

// ─────────────── derived stage status ───────────────

/** Stage status is derived from its aspects rather than set by the caller — the
 *  UI patches aspects one at a time and would otherwise never close a stage.
 *  A stage the author skipped explicitly keeps that status: only they can
 *  reopen it. The "complete" rule mirrors the `stage_complete_with_pending_required`
 *  invariant, so a derived status can never violate it. */
export function deriveStageStatus(stage: StageState): StageStatus {
  if (stage.status === "skipped") return "skipped";
  if (stage.aspects.length === 0) {
    // concept and chapters carry no aspects, and an import may have marked a
    // stage complete outright — nothing here to derive from, so keep the record.
    if (stage.status === "not_started" && stage.playbookGenerated) {
      return "in_progress";
    }
    return stage.status;
  }
  const settled = (a: StageAspect) =>
    a.status === "accepted" || a.status === "skipped";
  const requiredSettled = stage.aspects.every((a) => !a.required || settled(a));
  if (!requiredSettled) return "in_progress";
  // Optional aspects never gate completion: a playbook happily proposes sections
  // the author is free to leave pending forever, and holding the stage open for
  // them would mean no stage ever closes.
  if (stage.aspects.some((a) => a.status === "accepted")) return "complete";
  // Nothing accepted. Two different situations wear that shape, and the old rule
  // collapsed them into one:
  //   · every aspect is settled and none was accepted — the author walked past
  //     the whole stage, so "skipped" is the honest word;
  //   · aspects are still waiting for a decision — which is where every draft
  //     from the author's own material lands (optional, `reviewing`, unaccepted).
  // Calling the second one "skipped" made the stage pages refuse to render it,
  // so imported material was in the database and unreachable from the interface.
  if (stage.aspects.some((a) => !settled(a))) return "in_progress";
  return "skipped";
}

/** Applies {@link deriveStageStatus} to every stage. Called on the write path so
 *  stored status can never drift from the aspects it describes. */
export function withDerivedStageStatuses(state: StudioState): StudioState {
  const stages: Record<string, StageState> = {};
  for (const [id, stage] of Object.entries(state.stages)) {
    if (!stage) continue;
    stages[id] = { ...stage, status: deriveStageStatus(stage) };
  }
  return { ...state, stages };
}

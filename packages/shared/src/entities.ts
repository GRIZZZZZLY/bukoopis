import { z } from "zod";
import { characterProfileV2Schema } from "./character-profile.js";
import { directedRelationshipSchema } from "./relationship-profile.js";
import { acquisitionModeSchema } from "./character-events.js";

// ─────────────── Profiles (nested JSON documents) ───────────────

/** Профиль на входе — сырой объект, а не `characterProfileWriteSchema`.
 *  У схемы записи `schemaVersion: z.literal(2)` обязателен, и клиент,
 *  присылающий `{ description: "…" }`, получал бы 400 на пустом месте.
 *  Порядок один во всех маршрутах записи: сырое тело → нормализация →
 *  проверка пределов схемой записи. */
const rawProfileSchema = z.record(z.string(), z.unknown());

/** V1, только для чтения старых данных и для входа create/update, который
 *  этап 2 ещё не переписал. Новый код использует `characterProfileV2Schema`:
 *  он сохраняет все поля V1 под теми же именами. */
export const characterProfileSchema = z.object({
  description: z.string().min(1),
  want: z.string().nullable().optional(),
  need: z.string().nullable().optional(),
  lie: z.string().nullable().optional(),
  voice: z.string().nullable().optional(),
  appearance: z.string().nullable().optional(),
  arc: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CharacterProfile = z.infer<typeof characterProfileSchema>;

export const locationProfileSchema = z.object({
  description: z.string().min(1),
  history: z.string().nullable().optional(),
  atmosphere: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type LocationProfile = z.infer<typeof locationProfileSchema>;

export const itemProfileSchema = z.object({
  description: z.string().min(1),
  origin: z.string().nullable().optional(),
  significance: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type ItemProfile = z.infer<typeof itemProfileSchema>;

// ─────────────── Character ───────────────

export const characterSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  canonicalName: z.string().min(1),
  profile: characterProfileV2Schema,
  /** Счётчик правок профиля: 0 у строк, которых этап 2 ещё не касался. */
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Character = z.infer<typeof characterSchema>;

export const createCharacterInputSchema = z.object({
  canonicalName: z.string().min(1).max(200),
  profile: rawProfileSchema,
});
export type CreateCharacterInput = z.infer<typeof createCharacterInputSchema>;

export const updateCharacterInputSchema = z
  .object({
    // Обязателен с первого коммита: единственный клиент едет в том же
    // репозитории, а необязательный режим ломает AC-02 (раздел 5.1 ТЗ).
    expectedRevision: z.number().int().nonnegative(),
    canonicalName: z.string().min(1).max(200).optional(),
    profile: rawProfileSchema.optional(),
  })
  .refine((v) => v.canonicalName !== undefined || v.profile !== undefined, {
    message: "at least one field required",
  });
export type UpdateCharacterInput = z.infer<typeof updateCharacterInputSchema>;

// ─────────────── Location ───────────────

export const locationSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  name: z.string().min(1),
  profile: locationProfileSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Location = z.infer<typeof locationSchema>;

export const createLocationInputSchema = z.object({
  name: z.string().min(1).max(200),
  profile: locationProfileSchema,
});
export type CreateLocationInput = z.infer<typeof createLocationInputSchema>;

export const updateLocationInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    profile: locationProfileSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });
export type UpdateLocationInput = z.infer<typeof updateLocationInputSchema>;

// ─────────────── Item ───────────────

export const itemSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  name: z.string().min(1),
  profile: itemProfileSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Item = z.infer<typeof itemSchema>;

export const createItemInputSchema = z.object({
  name: z.string().min(1).max(200),
  profile: itemProfileSchema,
});
export type CreateItemInput = z.infer<typeof createItemInputSchema>;

export const updateItemInputSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    profile: itemProfileSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });
export type UpdateItemInput = z.infer<typeof updateItemInputSchema>;

// ─────────────── Hook ───────────────

export const hookStatusSchema = z.enum([
  "open",
  "mentioned",
  "resolved",
  "deferred",
]);
export type HookStatus = z.infer<typeof hookStatusSchema>;

export const hookSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  seedChapterId: z.number().int().positive().nullable(),
  description: z.string().min(1),
  status: hookStatusSchema,
  expectedResolutionChapterOrder: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Hook = z.infer<typeof hookSchema>;

export const createHookInputSchema = z.object({
  description: z.string().min(1).max(2000),
  seedChapterId: z.number().int().positive().nullable().optional(),
  status: hookStatusSchema.optional(),
  expectedResolutionChapterOrder: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional(),
});
export type CreateHookInput = z.infer<typeof createHookInputSchema>;

export const updateHookInputSchema = z
  .object({
    description: z.string().min(1).max(2000).optional(),
    seedChapterId: z.number().int().positive().nullable().optional(),
    status: hookStatusSchema.optional(),
    expectedResolutionChapterOrder: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field required",
  });
export type UpdateHookInput = z.infer<typeof updateHookInputSchema>;

// ─────────────── Relationship (character ↔ character) ───────────────

export const relationshipSchema = z.object({
  id: z.number().int().positive(),
  bookId: z.number().int().positive(),
  fromCharacterId: z.number().int().positive(),
  toCharacterId: z.number().int().positive(),
  type: z.string().min(1),
  tension: z.number().min(-1).max(1),
  notes: z.string().nullable(),
  /** Направленный профиль A→B. У строк до этапа 2 — пустой: колонка была
   *  NULL, а нормализация на чтении ничего не выдумывает. */
  profile: directedRelationshipSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const createRelationshipInputSchema = z.object({
  fromCharacterId: z.number().int().positive(),
  toCharacterId: z.number().int().positive(),
  type: z.string().min(1).max(100),
  tension: z.number().min(-1).max(1).default(0),
  notes: z.string().max(2000).nullable().optional(),
});
export type CreateRelationshipInput = z.infer<
  typeof createRelationshipInputSchema
>;

export const updateRelationshipInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    type: z.string().min(1).max(100).optional(),
    tension: z.number().min(-1).max(1).optional(),
    notes: z.string().max(2000).nullable().optional(),
    profile: rawProfileSchema.optional(),
  })
  .refine(
    (v) =>
      v.type !== undefined ||
      v.tension !== undefined ||
      v.notes !== undefined ||
      v.profile !== undefined,
    { message: "at least one field required" },
  );
export type UpdateRelationshipInput = z.infer<
  typeof updateRelationshipInputSchema
>;

// ─────────────── Character knowledge ───────────────

export const characterKnowledgeSchema = z.object({
  id: z.number().int().positive(),
  characterId: z.number().int().positive(),
  fact: z.string().min(1),
  learnedInChapterId: z.number().int().positive().nullable(),
  createdAt: z.string(),
});
export type CharacterKnowledge = z.infer<typeof characterKnowledgeSchema>;

export const createCharacterKnowledgeInputSchema = z.object({
  fact: z.string().min(1).max(2000),
  learnedInChapterId: z.number().int().positive().nullable().optional(),
  /** Как герой узнал. Умолчание `observed` — то, что было зашито в маршрут
   *  до этапа 3; теперь автор может сказать «ему сказали», и Писатель
   *  увидит разницу вместо выдуманного «видел сам». */
  acquisition: acquisitionModeSchema.optional(),
});
export type CreateCharacterKnowledgeInput = z.infer<
  typeof createCharacterKnowledgeInputSchema
>;
